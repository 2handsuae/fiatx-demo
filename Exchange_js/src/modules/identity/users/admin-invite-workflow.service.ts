import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
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
        { workflowType: AuditBusinessWorkflowTypes.ADMIN_INVITE, traceId: correlationId },
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
      await this.usersDomainService.updateStatus(user.id, 'INVITE_SENT');

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
      )
      .catch(() => undefined);
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
    return this.adminInvitationsService.resendInvitationForUser({
      userId: user.id,
      actor: {
        actorId: actor.userId,
        actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
        actorNo: actor.userNo,
      },
    });
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
