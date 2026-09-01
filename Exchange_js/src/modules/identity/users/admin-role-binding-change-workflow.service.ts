import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditOutcome, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { AccessControlService } from '../access-control/access-control.service';
import { CreateRoleChangeRequestDto, RoleChangeRequestQueryDto } from './dto/create-role-change-request.dto';

const SECONDARY_EVENT = 'workflow.admin-role-binding-change.decided';

@Injectable()
export class AdminRoleBindingChangeWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
    private readonly approvalsService: ApprovalsService,
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
   * 本流程 PRIMARY 主体是 requestNo（申请单号），被这次绑定变更牵连的每个角色码
   * 都降级为 RELATED——一次绑定变更可能同时涉及多个角色，逐个落一行，同
   * approvalSubjects 的形状（PRIMARY 已经在主表 primarySubjectType/No 两列上，
   * 这里只补 RELATED 行，不重复传 PRIMARY）。
   */
  private roleRelatedSubjects(roleCodes: string[]): AuditSubjectInput[] {
    return roleCodes.map((code) => ({
      subjectType: AuditEntityTypes.ACCESS_CONTROL,
      subjectNo: code,
      subjectRole: AuditSubjectRole.RELATED,
    }));
  }

  async createRoleChangeRequest(
    dto: CreateRoleChangeRequestDto,
    actor: ApprovalActorContext,
  ) {
    if (dto.targetUserId === actor.userId) {
      throw new BadRequestException('Cannot change your own role bindings');
    }

    const targetUser = await this.prisma.user.findFirst({
      where: { id: dto.targetUserId, deletedAt: null },
      select: { id: true, userNo: true, email: true },
    });
    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    const currentRoleCodes = await this.accessControlService.getUserRoleCodes(
      dto.targetUserId,
    );

    this.accessControlService.validateHardMutex(dto.roleCodes);

    // START：不再采信调用方传入的 dto.traceId——铁律要求 START 永远铸造新值，且这个值要
    // 和写进 ApprovalCase.traceId 的那份保持同一个，否则 APPLIED/CANCELLED 的 INHERIT
    // 读到的 event.traceId 会跟这条 REQUESTED 记录的 correlationId 对不上，断链。
    const correlationId = randomUUID();
    const requestNo = generateReferenceNo('RCR-');

    const request = await (this.prisma as any).adminRoleChangeRequest.create({
      data: {
        requestNo,
        targetUserId: dto.targetUserId,
        currentRoleCodes: JSON.stringify(currentRoleCodes),
        proposedRoleCodes: JSON.stringify(dto.roleCodes),
        changeReason: dto.changeReason,
        status: 'PENDING_APPROVAL',
        requestedByUserId: actor.userId,
      },
    });

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ADMIN_ROLE_BINDING_CHANGE_APPROVAL,
        entityRef: request.id,
        traceId: correlationId,
        objectSnapshot: {
          requestNo: request.requestNo,
          targetUserId: request.targetUserId,
          targetUserNo: targetUser.userNo,
          targetEmail: targetUser.email,
          currentRoleCodes: JSON.parse(request.currentRoleCodes),
          proposedRoleCodes: JSON.parse(request.proposedRoleCodes),
          changeReason: request.changeReason,
          status: request.status,
          createdAt: request.createdAt,
        },
      },
      { reason: dto.changeReason, traceId: correlationId },
      actor,
    );

    const updated = await (this.prisma as any).adminRoleChangeRequest.update({
      where: { id: request.id },
      data: {
        approvalCaseId: approvalCase.id,
        approvalCaseNo: approvalCase.approvalNo,
      },
    });

    await this.auditLogsService.recordByActor(
      {
        action: 'ADMIN_ROLE_CHANGE_REQUESTED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
        primarySubjectNo: requestNo,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        subjects: this.roleRelatedSubjects(dto.roleCodes),
        metadata: {
          targetUserId: targetUser.id,
          targetUserNo: targetUser.userNo,
          currentRoleCodes,
          proposedRoleCodes: dto.roleCodes,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return updated;
  }

  async findRoleChangeRequests(query: RoleChangeRequestQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const where: any = { deletedAt: null };
    if (query.targetUserId) where.targetUserId = query.targetUserId;
    if (query.status) where.status = query.status;

    const [items, total] = await Promise.all([
      (this.prisma as any).adminRoleChangeRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { targetUser: { select: { id: true, userNo: true, email: true } } },
      }),
      (this.prisma as any).adminRoleChangeRequest.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findRoleChangeRequest(id: string) {
    const request = await (this.prisma as any).adminRoleChangeRequest.findFirst({
      where: { id, deletedAt: null },
      include: { targetUser: { select: { id: true, userNo: true, email: true } } },
    });
    if (!request) {
      throw new NotFoundException('Role change request not found');
    }
    return request;
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    switch (event.decision) {
      case 'APPROVED':
        return this.executeRoleChange(event);
      case 'DECLINED':
        return this.executeTermination(event, 'REJECTED');
      case 'CANCELLED':
        return this.executeTermination(event, 'CANCELLED');
      case 'EXPIRED':
        return this.executeTermination(event, 'EXPIRED');
    }
  }

  private async executeRoleChange(event: ApprovalDecidedEvent) {
    const request = await (this.prisma as any).adminRoleChangeRequest.findFirst({
      where: { id: event.entityRef },
    });
    if (!request) return;

    const targetUser = await this.prisma.user.findFirst({
      where: { id: request.targetUserId, deletedAt: null },
      select: { id: true, userNo: true },
    });
    if (!targetUser) return;

    const proposedRoleCodes: string[] = JSON.parse(request.proposedRoleCodes);
    const beforeData = { roleCodes: JSON.parse(request.currentRoleCodes) };
    const afterData = { roleCodes: proposedRoleCodes };
    const systemActor = {
      actorId: event.decisionByUserId || 'SYSTEM',
      actorNo: event.decisionByUserNo || undefined,
      actorRole: event.decisionByRole || 'SYSTEM',
    };

    try {
      await this.accessControlService.replaceUserRoles(
        request.targetUserId,
        proposedRoleCodes,
        systemActor,
      );

      await (this.prisma as any).adminRoleChangeRequest.update({
        where: { id: request.id },
        data: { status: 'APPROVED', executedAt: new Date() },
      });

      await this.auditLogsService.recordByActor(
        {
          action: 'ADMIN_ROLE_CHANGE_APPLIED',
          actionDomain: 'IAM',
          category: AuditCategory.GOVERNANCE,
          primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
          primarySubjectNo: request.requestNo,
          // INHERIT：读 ApprovalDecidedEvent.traceId——它就是 createRoleChangeRequest
          // 铸造的 correlationId 原样传播过来的（经 ApprovalCase.traceId）。
          correlationId: event.traceId,
          // 异步驱动：这条记录是被"审批已批准"这个决定触发的，causationId 指向那条审批单。
          causationId: event.approvalId,
          outcome: AuditOutcome.SUCCESS,
          beforeData,
          afterData,
          subjects: this.roleRelatedSubjects(proposedRoleCodes),
          approvalNo: event.approvalNo,
          metadata: {
            targetUserId: targetUser.id,
            targetUserNo: targetUser.userNo,
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
      const failureReason =
        error instanceof Error ? error.message : 'Unknown execution error';

      await (this.prisma as any).adminRoleChangeRequest.update({
        where: { id: request.id },
        data: { status: 'FAILED', failureReason },
      });

      // 退役码 CHANGE_APPLY_FAILED 收编进来——同一动作码 ADMIN_ROLE_CHANGE_APPLIED，
      // 靠 outcome=FAILED 区分，不另起一个 _FAILED 后缀码（该退役词还被三个非 V1 域复用，
      // inV1Domain 网关会直接拒绝在 IAM 域写它，见 audit-actions.constant.ts 顶部注释）。
      await this.auditLogsService.recordByActor(
        {
          action: 'ADMIN_ROLE_CHANGE_APPLIED',
          actionDomain: 'IAM',
          category: AuditCategory.GOVERNANCE,
          primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
          primarySubjectNo: request.requestNo,
          correlationId: event.traceId,
          causationId: event.approvalId,
          outcome: AuditOutcome.FAILED,
          reasonCode: 'EXECUTION_FAILED',
          reason: failureReason,
          beforeData,
          afterData,
          subjects: this.roleRelatedSubjects(proposedRoleCodes),
          approvalNo: event.approvalNo,
          metadata: {
            targetUserId: request.targetUserId,
            failureReason,
          },
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

    }
  }

  private async executeTermination(
    event: ApprovalDecidedEvent,
    status: 'REJECTED' | 'CANCELLED' | 'EXPIRED',
  ) {
    const request = await (this.prisma as any).adminRoleChangeRequest.findFirst({
      where: { id: event.entityRef },
    });
    if (!request) return;

    await (this.prisma as any).adminRoleChangeRequest.update({
      where: { id: request.id },
      data: { status },
    });

    // ADMIN_ROLE_CHANGE_CANCELLED：本轮新增码，之前这条路径（驳回/撤销/超时）完全没有
    // 审计留痕。三种终止原因合成一条码，用 reason/metadata.decision 区分是哪一种——
    // 与 ADMIN_INVITE_CANCELLED 同款处理（拆条两判据都不触发：同事务、同 PRIMARY）。
    await this.auditLogsService
      .recordByActor(
        {
          action: 'ADMIN_ROLE_CHANGE_CANCELLED',
          actionDomain: 'IAM',
          category: AuditCategory.GOVERNANCE,
          primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
          primarySubjectNo: request.requestNo,
          correlationId: event.traceId,
          causationId: event.approvalId,
          outcome: AuditOutcome.SUCCESS,
          reason:
            event.decisionReason || `Role change request ${status.toLowerCase()}`,
          subjects: this.roleRelatedSubjects(JSON.parse(request.proposedRoleCodes)),
          metadata: {
            approvalId: event.approvalId,
            approvalNo: event.approvalNo,
            decision: event.decision,
            terminalStatus: status,
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
}
