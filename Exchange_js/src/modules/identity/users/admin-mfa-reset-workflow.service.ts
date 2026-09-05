import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { UsersDomainService } from './users.domain.service';

const SECONDARY_EVENT = 'workflow.admin-mfa-reset.decided';

@Injectable()
export class AdminMfaResetWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersDomainService: UsersDomainService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private toAuditActor(
    actor: ApprovalActorContext,
    onBehalfOf?: { type: string; no: string },
  ) {
    return {
      actorType: actor.actorType,
      actorNo: actor.userNo || 'UNKNOWN',

      actorDisplayName: actor.userNo || 'UNKNOWN',
      actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
      ...(onBehalfOf ? { onBehalfOfType: onBehalfOf.type, onBehalfOfNo: onBehalfOf.no } : {}),
    };
  }

  async initiateAdminMfaReset(targetUserId: string, actor: ApprovalActorContext) {
    // START：本次 MFA 重置旅程的 correlationId，同事务写进 ApprovalCase.traceId，
    // 供下游 executeReset/recordCancellation 经 ApprovalDecidedEvent.traceId INHERIT 读回。
    const correlationId = randomUUID();

    if (actor.userId === targetUserId) {
      throw new ForbiddenException('Cannot reset your own MFA via admin path');
    }

    const targetUser = await this.usersDomainService.findById(targetUserId);
    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    if (targetUser.status !== 'ACTIVE') {
      throw new ConflictException(`Cannot reset MFA for user in status: ${targetUser.status}`);
    }

    const targetRoles = await this.prisma.userRole.findMany({
      where: { userId: targetUserId },
      select: { role: { select: { code: true } } },
    });
    if (targetRoles.some((ur: any) => ur.role.code === 'SUPER_ADMIN')) {
      throw new ForbiddenException('Cannot reset SUPER_ADMIN MFA via admin path');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      select: { mfaEnabledAt: true },
    });
    if (!user?.mfaEnabledAt) {
      throw new ConflictException('Target user has no MFA binding to reset');
    }

    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ADMIN_MFA_RESET,
        entityRef: targetUser.userNo,
        status: 'PENDING',
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending MFA reset approval already exists: ${existingPending.approvalNo}`,
      );
    }

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ADMIN_MFA_RESET,
        entityRef: targetUser.userNo,
        traceId: correlationId,
        objectSnapshot: {
          targetUserId,
          targetUserNo: targetUser.userNo,
          targetEmail: targetUser.email,
          targetStatus: targetUser.status,
        },
      },
      {
        reason: `Admin MFA reset request for ${targetUser.email}`,
        traceId: correlationId,
      },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: 'ADMIN_MFA_RESET_REQUESTED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: targetUser.userNo,
        correlationId,
        onBehalfOfNo: targetUser.userNo,
        outcome: AuditOutcome.SUCCESS,
        metadata: {
          targetEmail: targetUser.email,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor, { type: AuditEntityTypes.ADMIN_USER, no: targetUser.userNo }),
    );

    return {
      approvalNo: approvalCase.approvalNo,
      traceId: correlationId,
      targetUserNo: targetUser.userNo,
      status: 'PENDING_APPROVAL',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    switch (event.decision) {
      case 'APPROVED':
        return this.executeReset(event);
      case 'DECLINED':
      case 'CANCELLED':
      case 'EXPIRED':
        return this.recordCancellation(event);
    }
  }

  private async executeReset(event: ApprovalDecidedEvent) {
    // fromStatus 取的是 firstLoginStatus（不是 user.status——MFA 重置不改那一列）：
    // resetMfa 把它拨回 PENDING_IDENTITY_CONFIRM，逼这个 admin 重走一遍首登绑定。
    // entityRef 现在存 userNo（铁律⑥），先按号查出内部 id 再喂给域方法（签名不动）。
    const target = await this.usersDomainService.findByUserNo(event.entityRef);
    const before = target
      ? await this.usersDomainService.findFirstLoginState(target.id)
      : null;

    try {
      const result = await this.usersDomainService.resetMfa(target?.id ?? event.entityRef);

      await this.auditLogsService.recordSystem({
        action: 'ADMIN_MFA_RESET_APPLIED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: result.userNo,
        // INHERIT：读 ApprovalDecidedEvent.traceId——就是 initiateAdminMfaReset 铸造的
        // correlationId 原样传播过来的（经 ApprovalCase.traceId）。
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.SUCCESS,
        fromStatus: before?.firstLoginStatus ?? 'UNKNOWN',
        toStatus: 'PENDING_IDENTITY_CONFIRM',
        approvalNo: event.approvalNo,
        onBehalfOfNo: result.userNo,
        metadata: {
          approvalId: event.approvalId,
          resetByUserId: event.decisionByUserId,
          resetByUserNo: event.decisionByUserNo,
        },
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      });

    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: 'ADMIN_MFA_RESET_APPLIED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: before?.userNo ?? event.entityRef,
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.FAILED,
        // 同 suspension/reactivation：fromStatus/toStatus 表达"本该达成的转移意图"。
        fromStatus: before?.firstLoginStatus ?? 'UNKNOWN',
        toStatus: 'PENDING_IDENTITY_CONFIRM',
        approvalNo: event.approvalNo,
        onBehalfOfNo: before?.userNo ?? event.entityRef,
        reason: error instanceof Error ? error.message : 'MFA reset execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      });

      throw error;
    }
  }

  private async recordCancellation(event: ApprovalDecidedEvent) {
    const target = await this.usersDomainService.findByUserNo(event.entityRef);

    await this.auditLogsService.recordSystem({
      action: 'ADMIN_MFA_RESET_CANCELLED',
      actionDomain: 'IAM',
      category: AuditCategory.GOVERNANCE,
      primarySubjectType: AuditEntityTypes.ADMIN_USER,
      primarySubjectNo: target?.userNo ?? event.entityRef,
      correlationId: event.traceId,
      causationId: event.approvalId,
      outcome: AuditOutcome.SUCCESS,
      reason: event.decisionReason || `MFA reset request ${event.decision.toLowerCase()}`,
      metadata: {
        approvalId: event.approvalId,
        approvalNo: event.approvalNo,
        decision: event.decision,
      },
      requestId: randomUUID(),
      sourcePlatform: 'ADMIN_API',
    });
  }
}
