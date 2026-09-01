import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { AccessControlService } from '../access-control/access-control.service';
import { AdminInvitationsService } from './admin-invitations.service';
import { UsersDomainService } from './users.domain.service';
import { UserStatusAction } from './constants/user-status-transitions.constant';

const SECONDARY_EVENT = 'workflow.admin-invite.decided';

export interface InitiateAdminInviteDto {
  email: string;
  roleCodes: string[];
  changeReason?: string;
}

@Injectable()
export class AdminInviteWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersDomainService: UsersDomainService,
    private readonly accessControlService: AccessControlService,
    private readonly approvalsService: ApprovalsService,
    private readonly adminInvitationsService: AdminInvitationsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorNo: actor.userNo || 'UNKNOWN',

      actorDisplayName: actor.userNo || 'UNKNOWN',
      actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
    };
  }

  /**
   * SoD 硬互斥冲突（AccessControlService.validateHardMutex 抛出）是 ADMIN_INVITE_REQUESTED
   * 唯一声明会产出 DENIED 的路径——邀请时给新账号指派了互斥角色对，系统主动挡下。
   * 靠消息内容识别（validateHardMutex 的消息按角色对模板拼，不是固定字面量，故用包含匹配，
   * 不能像 Task 5 SOD_SELF_APPROVE_MESSAGE 那样做全等）。
   */
  private isHardMutexConflict(error: unknown): boolean {
    return (
      error instanceof BadRequestException &&
      typeof (error as Error).message === 'string' &&
      (error as Error).message.includes('cannot be assigned to one user')
    );
  }

  /**
   * 接受邀请失败时定位主体号：不依赖 AdminInvitationsService.acceptInvitation
   * 内部的校验顺序（PASSWORD_TOO_SHORT 在查邀请行之前就先抛了）——独立按 token
   * 哈希回查邀请行本身，只看行是否存在，不复核 revoked/consumed/expired 等状态
   * （那是域服务自己的事）。查到就是「token 能解析出邀请行」，用目标 userNo；
   * token 为空或压根没有匹配行（TOKEN_REQUIRED/INVITATION_NOT_FOUND）时确实无法
   * 识别身份，回落 undefined 交给调用方处理——不编造一个 userNo。
   */
  private async resolveAcceptInvitationTargetUserNo(token: string): Promise<string | undefined> {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) return undefined;

    const tokenHash = createHash('sha256').update(normalizedToken).digest('hex');
    const invitation = await (this.prisma as any).adminUserInvitation.findUnique({
      where: { tokenHash },
      include: { user: { select: { userNo: true } } },
    });
    return invitation?.user?.userNo ?? undefined;
  }

  async initiateInvite(dto: InitiateAdminInviteDto, actor: ApprovalActorContext) {
    // START：本旅程的 correlationId 在此一次性铸造。AdminUserInvitation 记录此刻还不存在
    // （要等审批通过才建），User 表也没有承载列——写回点是 approvalsService.createAndSubmit
    // 落的 ApprovalCase.traceId（同 Task 5 的过渡期承载方案）；executeInviteDispatch 建
    // 邀请记录时再把同一个值写进 AdminUserInvitation.traceId，供 ACCEPTED/EXPIRED 读回。
    const correlationId = randomUUID();
    const roleCodes = dto.roleCodes;

    const user = await this.usersDomainService.createProvisionalUser({
      email: dto.email,
      roleCodes,
    });

    const afterData = {
      userNo: user.userNo,
      email: user.email,
      roleCodes,
      changeReason: dto.changeReason || null,
      status: user.status,
    };

    let approvalCase: any = null;
    try {
      await this.accessControlService.replaceUserRoles(
        user.id,
        roleCodes,
        { actorId: actor.userId, actorNo: actor.userNo, actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN' },
      );

      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.ADMIN_INVITE_APPROVAL,
          entityRef: user.id,
          traceId: correlationId,
          objectSnapshot: { ...afterData },
        },
        {
          reason: dto.changeReason || `Admin invite request for ${user.email}`,
          traceId: correlationId,
        },
        actor,
      );
    } catch (error) {
      await this.usersDomainService.physicalDelete(user.id);

      if (this.isHardMutexConflict(error)) {
        await this.auditLogsService.recordByActor(
          {
            action: 'ADMIN_INVITE_REQUESTED',
            actionDomain: 'IAM',
            category: AuditCategory.GOVERNANCE,
            primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
            primarySubjectNo: user.userNo,
            correlationId,
            outcome: AuditOutcome.DENIED,
            reasonCode: 'SOD_CONFLICT',
            reason: (error as Error).message,
            afterData,
            requestId: randomUUID(),
            sourcePlatform: 'ADMIN_API',
          },
          this.toAuditActor(actor),
        );
      }

      throw error;
    }

    await this.auditLogsService.recordByActor(
      {
        action: 'ADMIN_INVITE_REQUESTED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
        primarySubjectNo: user.userNo,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        afterData,
        approvalNo: approvalCase.approvalNo,
        metadata: {
          userEmail: user.email,
          roleCodes,
          approvalNo: approvalCase.approvalNo,
          changeReason: dto.changeReason || null,
        },
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      userId: user.id,
      userNo: user.userNo,
      email: user.email,
      status: 'PENDING_INVITE_APPROVAL',
      approvalNo: approvalCase.approvalNo,
      approvalStatus: approvalCase.status,
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    switch (event.decision) {
      case 'APPROVED':
        return this.executeInviteDispatch(event);
      case 'DECLINED':
      case 'CANCELLED':
      case 'EXPIRED':
        return this.executeInviteCancellation(event);
    }
  }

  private async executeInviteDispatch(event: ApprovalDecidedEvent) {
    const user = await this.usersDomainService.findById(event.entityRef);
    if (!user) return;

    try {
      await this.usersDomainService.applyUserTransition(user.id, UserStatusAction.INVITE_APPROVE);

      const invitation = await this.adminInvitationsService.createInvitationForUser({
        userId: user.id,
        actor: {
          actorId: event.decisionByUserId || 'SYSTEM',
          actorRole: event.decisionByRole || 'SYSTEM',
          actorNo: event.decisionByUserNo || undefined,
        },
        auditContext: {
          workflowType: AuditBusinessWorkflowTypes.ADMIN_INVITE,
          traceId: event.traceId,
        },
      });

      await this.auditLogsService.recordByActor(
        {
          action: 'ADMIN_INVITE_DISPATCHED',
          actionDomain: 'IAM',
          category: AuditCategory.GOVERNANCE,
          primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
          primarySubjectNo: user.userNo,
          // INHERIT：读 ApprovalDecidedEvent.traceId——它就是 initiateInvite 铸造的
          // correlationId 原样传播过来的（经 ApprovalCase.traceId），不是另起一份。
          correlationId: event.traceId,
          outcome: AuditOutcome.SUCCESS,
          metadata: {
            approvalId: event.approvalId,
            approvalNo: event.approvalNo,
            inviteExpiresAt: invitation.inviteExpiresAt,
          },
          requestId: randomUUID(),
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorNo: event.decisionByUserNo || 'UNKNOWN',
          actorDisplayName: event.decisionByUserNo || 'UNKNOWN',
          actorRolesAtTime: [event.decisionByRole || 'SYSTEM'],
        },
      );

    } catch (error) {
      await this.auditLogsService.recordByActor(
        {
          action: 'ADMIN_INVITE_DISPATCHED',
          actionDomain: 'IAM',
          category: AuditCategory.GOVERNANCE,
          primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
          primarySubjectNo: user.userNo,
          correlationId: event.traceId,
          outcome: AuditOutcome.FAILED,
          reason: error instanceof Error ? error.message : 'Failed to dispatch invite',
          metadata: { approvalId: event.approvalId },
          requestId: randomUUID(),
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorNo: event.decisionByUserId || 'SYSTEM',
          actorDisplayName: event.decisionByUserId || 'SYSTEM',
          actorRolesAtTime: [event.decisionByRole || 'SYSTEM'],
        },
      );

      throw error;
    }
  }

  private async executeInviteCancellation(event: ApprovalDecidedEvent) {
    const user = await this.usersDomainService.findById(event.entityRef);
    if (!user) return;

    await this.usersDomainService.physicalDelete(user.id);

    await this.auditLogsService
      .recordByActor(
        {
          action: 'ADMIN_INVITE_CANCELLED',
          actionDomain: 'IAM',
          category: AuditCategory.GOVERNANCE,
          primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
          primarySubjectNo: user.userNo,
          correlationId: event.traceId,
          outcome: AuditOutcome.SUCCESS,
          reason: event.decisionReason || `Admin invite ${event.decision.toLowerCase()}`,
          metadata: {
            approvalId: event.approvalId,
            approvalNo: event.approvalNo,
            decision: event.decision,
          },
          requestId: randomUUID(),
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorNo: event.decisionByUserNo || 'UNKNOWN',
          actorDisplayName: event.decisionByUserNo || 'UNKNOWN',
          actorRolesAtTime: [event.decisionByRole || 'SYSTEM'],
        },
      );
  }

  /**
   * 同 AdminInvitationsService.findLatestInvitationAuditContext 的「回查最近一条
   * 邀请记录取 traceId」模式——该方法私有，不跨服务边界拿，这里按同款查询独立
   * 实现一份。resendInvitationForUser 内部（issueInvitation）没收到 auditContext，
   * 会自己从这个用户最近一条邀请记录里把 traceId 继承写进新建的邀请行；调用完成
   * 后回查同一个 userId 的最新一条，取回的就是同一段旅程的 correlationId。
   */
  private async findLatestInvitationCorrelationId(userId: string): Promise<string | undefined> {
    const latest = await (this.prisma as any).adminUserInvitation.findFirst({
      where: { userId, traceId: { not: null } },
      orderBy: [{ createdAt: 'desc' }],
      select: { traceId: true },
    });
    return latest?.traceId ?? undefined;
  }

  async resendInvitation(userId: string, actor: ApprovalActorContext) {
    const user = await this.usersDomainService.findById(userId);
    if (!user) throw new InternalServerErrorException('User not found');

    // 不再传只带 workflowType、不带 traceId 的半截 auditContext——那会短路
    // AdminInvitationsService.issueInvitation 里"补全上一份完整上下文"的兜底查询
    // （resolvePersistableAuditContext 只要 workflowType 非空就不再 fallthrough 到
    // findLatestInvitationAuditContext），导致新发的邀请记录 traceId 列写成 NULL，
    // 断了 ADMIN_INVITE_EXPIRED 之后 INHERIT 读 correlationId 的链路。留空交给该方法
    // 自己从这个用户最近一条邀请记录里把 workflowType+traceId 一起找回来。
    const result = await this.adminInvitationsService.resendInvitationForUser({
      userId: user.id,
      actor: {
        actorId: actor.userId,
        actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
        actorNo: actor.userNo,
      },
    });

    // 重发邀请此前从未真正留痕（issueInvitation 上收审计后，resendInvitation 这侧
    // 一直没有等价补写——见 admin-invitations.service.ts issueInvitation 顶部注释）。
    // INHERIT：读刚继承写入的同一段旅程 correlationId，不是另起一段。
    const correlationId = await this.findLatestInvitationCorrelationId(user.id);

    await this.auditLogsService.recordByActor(
      {
        action: 'ADMIN_INVITE_DISPATCHED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
        primarySubjectNo: user.userNo,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        metadata: {
          inviteExpiresAt: result.inviteExpiresAt,
          resend: true,
        },
        requestId: `ADMIN_INVITE_DISPATCHED_${user.userNo}_${randomUUID()}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return result;
  }

  /**
   * 从捕获的异常里取出 AdminInvitationsService 抛出的 reasonCode（结构化异常体
   * {message, reasonCode}）。取不到（非本文件约定的异常形状）就回落 'UNKNOWN'——
   * 断言最终必填的是"有 reasonCode"，不是"reasonCode 必须命中已知枚举"。
   */
  private extractReasonCode(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (response && typeof response === 'object' && 'reasonCode' in response) {
        const code = (response as { reasonCode?: unknown }).reasonCode;
        if (typeof code === 'string' && code) return code;
      }
    }
    return 'UNKNOWN';
  }

  /**
   * ADMIN_INVITE_ACCEPTED 唯一写入点——Task 9 从 AdminInvitationsService 上收。
   * 域服务只返回结果（成功）或抛带 reasonCode 的结构化异常（拒绝），这里拿到后
   * 落审计：成功 outcome=SUCCESS 带 fromStatus/toStatus/correlationId（INHERIT
   * 自邀请记录自己的 traceId 列）；拒绝 outcome=DENIED 带 reasonCode，不強求
   * fromStatus/toStatus（判据②：非成功路径只强制 reasonCode）。
   *
   * actor：接受邀请这一步的"操作者"就是被邀请人本人（自助激活账号，此刻还未登录、
   * 没有其它身份可用）——成功时用刚激活的账号自身身份记；失败时（token 不存在/
   * 已用/已过期等）身份未知，记 UNKNOWN，同旧实现一致。
   */
  async acceptInvitation(
    token: string,
    password: string,
    ctx: { requestId?: string; sourceIp?: string; sourcePlatform?: string } = {},
  ): Promise<{ userId: string; userNo: string; email: string; status: string }> {
    try {
      const accepted = await this.adminInvitationsService.acceptInvitation(token, password);

      await this.auditLogsService.recordByActor(
        {
          action: 'ADMIN_INVITE_ACCEPTED',
          actionDomain: 'IAM',
          category: AuditCategory.GOVERNANCE,
          // 对齐同一旅程其余 4 码的 primarySubjectType（REQUESTED/DISPATCHED/
          // CANCELLED 都用 ACCESS_CONTROL）。
          primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
          primarySubjectNo: accepted.userNo,
          outcome: AuditOutcome.SUCCESS,
          correlationId: accepted.correlationId,
          fromStatus: accepted.fromStatus,
          toStatus: accepted.status,
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'ADMIN_INVITATION_API',
        },
        {
          actorType: 'ADMIN',
          actorNo: accepted.userNo,
          actorDisplayName: accepted.userNo,
          actorRolesAtTime: [accepted.role || 'ADMIN'],
        },
      );

      return {
        userId: accepted.userId,
        userNo: accepted.userNo,
        email: accepted.email,
        status: accepted.status,
      };
    } catch (error) {
      // token 能查到邀请行就用目标 userNo 顶上 PRIMARY 主体号；查不到（token 为空/
      // 无匹配行）才回落 UNKNOWN——不再对所有失败分支一律写死。actorNo 同源：失败时
      // 唯一能自证身份的就是这个被操作的账号本身，与 PRIMARY 用同一个值。
      const targetUserNo = await this.resolveAcceptInvitationTargetUserNo(token);
      await this.auditLogsService
        .recordByActor(
          {
            action: 'ADMIN_INVITE_ACCEPTED',
            actionDomain: 'IAM',
            category: AuditCategory.GOVERNANCE,
            primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
            primarySubjectNo: targetUserNo || 'UNKNOWN',
            outcome: AuditOutcome.DENIED,
            reasonCode: this.extractReasonCode(error),
            reason: error instanceof Error ? error.message : 'Admin invitation accept failed',
            requestId: ctx.requestId,
            sourceIp: ctx.sourceIp,
            sourcePlatform: ctx.sourcePlatform || 'ADMIN_INVITATION_API',
          },
          {
            actorType: 'ADMIN',
            actorNo: targetUserNo || 'UNKNOWN',
            actorDisplayName: targetUserNo || 'UNKNOWN',
            actorRolesAtTime: ['UNKNOWN'],
          },
        );
      throw error;
    }
  }

  /**
   * ADMIN_INVITE_EXPIRED 唯一写入点。定期扫描已派发但过期未被接受/取消的邀请链接，
   * 逐条打 revokedAt（防止下次扫描重复处理、重复写审计）+ recordSystem 留痕。
   *
   * 未接 @Cron——与 approvals.service.ts 的 expirePendingApprovals() 同款差距
   * （该方法本身也没有 @Cron 调用方，是已登记的既有 BACKLOG 项）。是否要在这批把
   * 两处一起接上定时触发器不在本任务范围内，留给运维/BACKLOG 决定。
   */
  async sweepExpiredInvites(): Promise<{ expiredCount: number }> {
    const now = new Date();
    const expired = await (this.prisma as any).adminUserInvitation.findMany({
      where: {
        consumedAt: null,
        revokedAt: null,
        expiresAt: { lte: now },
      },
      include: {
        user: { select: { userNo: true } },
      },
      take: 200,
    });

    for (const invitation of expired) {
      await (this.prisma as any).adminUserInvitation.update({
        where: { id: invitation.id },
        data: { revokedAt: now },
      });

      if (!invitation.user) continue;

      await this.auditLogsService.recordSystem({
        action: 'ADMIN_INVITE_EXPIRED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
        primarySubjectNo: invitation.user.userNo,
        // INHERIT：读邀请记录自己的 traceId——executeInviteDispatch 建邀请记录时写入的
        // 那份 correlationId。读不到就是有问题（没走 dispatch 就不该有过期链接），不兜底。
        correlationId: invitation.traceId ?? undefined,
        outcome: AuditOutcome.SUCCESS,
        requestId: randomUUID(),
        sourcePlatform: 'CRON',
      });
    }

    return { expiredCount: expired.length };
  }
}
