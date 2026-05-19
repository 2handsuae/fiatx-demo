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
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
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

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  async initiateAdminMfaReset(targetUserId: string, actor: ApprovalActorContext) {
    const traceId = randomUUID();

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
        entityRef: targetUserId,
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
        entityRef: targetUserId,
        traceId,
        objectSnapshot: {
          targetUserId,
          targetUserNo: targetUser.userNo,
          targetEmail: targetUser.email,
          targetStatus: targetUser.status,
        },
      },
      {
        reason: `Admin MFA reset request for ${targetUser.email}`,
        traceId,
      },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_MFA_RESET.RESET_REQUESTED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: targetUserId,
        entityNo: targetUser.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_MFA_RESET,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          targetEmail: targetUser.email,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `ADMIN_MFA_RESET_REQUESTED_${targetUser.userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      approvalNo: approvalCase.approvalNo,
      traceId,
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
    try {
      const result = await this.usersDomainService.resetMfa(event.entityRef);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_MFA_RESET.RESET_EXECUTED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: event.entityRef,
        entityNo: result.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_MFA_RESET,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          approvalId: event.approvalId,
          approvalNo: event.approvalNo,
          resetByUserId: event.decisionByUserId,
          resetByUserNo: event.decisionByUserNo,
        },
        requestId: `ADMIN_MFA_RESET_EXECUTED_${result.userNo}`,
        sourcePlatform: 'ADMIN_API',
      });

    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_MFA_RESET.RESET_FAILED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: event.entityRef,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_MFA_RESET,
        traceId: event.traceId,
        result: AuditResult.FAILED,
        reason: error instanceof Error ? error.message : 'MFA reset execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: `ADMIN_MFA_RESET_FAILED_${event.entityRef}`,
        sourcePlatform: 'ADMIN_API',
      });

      throw error;
    }
  }

  private async recordCancellation(event: ApprovalDecidedEvent) {
    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.ADMIN_MFA_RESET.RESET_CANCELLED,
      entityType: AuditEntityTypes.ADMIN_USER,
      entityId: event.entityRef,
      workflowType: AuditBusinessWorkflowTypes.ADMIN_MFA_RESET,
      traceId: event.traceId,
      result: AuditResult.SUCCESS,
      metadata: {
        approvalId: event.approvalId,
        approvalNo: event.approvalNo,
        decision: event.decision,
      },
      requestId: `ADMIN_MFA_RESET_CANCELLED_${event.entityRef}`,
      sourcePlatform: 'ADMIN_API',
    });
  }
}
