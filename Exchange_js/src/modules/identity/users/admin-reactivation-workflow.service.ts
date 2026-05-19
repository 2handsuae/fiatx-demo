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

const SECONDARY_EVENT = 'workflow.admin-reactivation.decided';

export interface InitiateReactivationDto {
  targetUserId: string;
  reason: string;
}

@Injectable()
export class AdminReactivationWorkflowService {
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

  async initiateReactivation(dto: InitiateReactivationDto, actor: ApprovalActorContext) {
    const traceId = randomUUID();

    if (actor.userId === dto.targetUserId) {
      throw new ForbiddenException('Cannot reactivate your own account');
    }

    const targetUser = await this.usersDomainService.findById(dto.targetUserId);
    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    if (targetUser.status !== 'SUSPENDED') {
      throw new ConflictException(`User is not suspended (current status: ${targetUser.status})`);
    }

    const targetRoles = await this.prisma.userRole.findMany({
      where: { userId: dto.targetUserId },
      select: { role: { select: { code: true } } },
    });
    if (targetRoles.some((ur: any) => ur.role.code === 'SUPER_ADMIN')) {
      throw new ForbiddenException('SUPER_ADMIN account cannot be managed via this workflow');
    }

    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ADMIN_REACTIVATION_APPROVAL,
        entityRef: dto.targetUserId,
        status: 'PENDING',
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending reactivation approval already exists: ${existingPending.approvalNo}`,
      );
    }

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ADMIN_REACTIVATION_APPROVAL,
        entityRef: dto.targetUserId,
        traceId,
        objectSnapshot: {
          targetUserId: dto.targetUserId,
          targetUserNo: targetUser.userNo,
          targetEmail: targetUser.email,
          targetStatus: targetUser.status,
          reason: dto.reason,
        },
      },
      {
        reason: dto.reason,
        traceId,
      },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_REACTIVATION.REACTIVATION_REQUESTED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: dto.targetUserId,
        entityNo: targetUser.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_REACTIVATION,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          targetEmail: targetUser.email,
          reason: dto.reason,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `ADMIN_REACTIVATION_REQUESTED_${targetUser.userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      approvalNo: approvalCase.approvalNo,
      traceId,
      targetUserNo: targetUser.userNo,
      status: 'PENDING',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    if (event.decision === 'APPROVED') {
      return this.executeReactivation(event);
    }
  }

  private async executeReactivation(event: ApprovalDecidedEvent) {
    try {
      const result = await this.usersDomainService.reactivateUser(event.entityRef);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_REACTIVATION.ACCOUNT_REACTIVATED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: event.entityRef,
        entityNo: result.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_REACTIVATION,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          approvalId: event.approvalId,
          approvalNo: event.approvalNo,
          reactivatedByUserId: event.decisionByUserId,
          reactivatedByUserNo: event.decisionByUserNo,
        },
        requestId: `ADMIN_REACTIVATION_EXECUTED_${result.userNo}`,
        sourcePlatform: 'ADMIN_API',
      });

    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_REACTIVATION.ACCOUNT_REACTIVATED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: event.entityRef,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_REACTIVATION,
        traceId: event.traceId,
        result: AuditResult.FAILED,
        reason: error instanceof Error ? error.message : 'Reactivation execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: `ADMIN_REACTIVATION_EXEC_FAILED_${event.entityRef}`,
        sourcePlatform: 'ADMIN_API',
      });

      throw error;
    }
  }
}
