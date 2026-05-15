import {
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApprovalDecidedEvent } from '../approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../approvals/constants/approval.constants';
import { TransactionLimitsService } from './transaction-limits.service';

const SECONDARY_EVENT = 'workflow.transaction-limit-change.decided';

@Injectable()
export class TransactionLimitChangeWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limitsService: TransactionLimitsService,
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

  async requestChange(
    policyNo: string,
    newAmount: number,
    changeReason: string,
    actor: ApprovalActorContext,
  ) {
    const traceId = randomUUID();

    const policy = await this.limitsService.findByPolicyNo(policyNo);

    if (policy.status === 'PENDING_APPROVAL') {
      throw new ConflictException(
        `Policy ${policyNo} already has a pending change. Wait for the current approval to complete.`,
      );
    }

    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE,
        entityRef: policy.id,
        status: 'PENDING',
        deletedAt: null,
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending limit change approval already exists: ${existingPending.approvalNo}`,
      );
    }

    const oldAmount = policy.limitAmount;

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE,
        entityRef: policy.id,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
        workflowId: policy.id,
        workflowNo: policyNo,
        traceId,
        objectSnapshot: {
          policyId: policy.id,
          policyNo,
          tradingTier: policy.tradingTier,
          operationType: policy.operationType,
          period: policy.period,
          oldAmount: oldAmount.toString(),
          newAmount: String(newAmount),
          changeReason,
        },
      },
      {
        reason: changeReason,
        traceId,
      },
      actor,
    );

    try {
      await this.limitsService.setStatus(policyNo, 'PENDING_APPROVAL');
    } catch (statusErr) {
      console.warn(
        `[TransactionLimitChangeWorkflow] Failed to set PENDING_APPROVAL status for ${policyNo} after approval creation (${approvalCase.approvalNo}):`,
        statusErr instanceof Error ? statusErr.message : statusErr,
      );
    }

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_REQUESTED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: policy.id,
        entityNo: policyNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          tradingTier: policy.tradingTier,
          operationType: policy.operationType,
          period: policy.period,
          oldAmount: oldAmount.toString(),
          newAmount: String(newAmount),
          changeReason,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `TRANSACTION_LIMIT_CHANGE_REQUESTED_${policyNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      approvalNo: approvalCase.approvalNo,
      traceId,
      policyNo,
      status: 'PENDING_APPROVAL',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    if (event.decision === 'APPROVED') {
      return this.executeChange(event);
    }
    return this.cancelChange(event);
  }

  private async executeChange(event: ApprovalDecidedEvent) {
    try {
      const approvalCase = await this.prisma.approvalCase.findUnique({
        where: { id: event.approvalId },
      });
      const snapshot = approvalCase?.objectSnapshot
        ? JSON.parse(approvalCase.objectSnapshot as string)
        : {};
      const policyNo = snapshot.policyNo;
      const newAmount = snapshot.newAmount;
      const oldAmount = snapshot.oldAmount;

      if (!policyNo || !newAmount) {
        throw new Error(`Missing policyNo or newAmount in approval snapshot`);
      }

      await this.limitsService.updateLimitAmount(
        policyNo,
        new Prisma.Decimal(newAmount),
      );

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_APPLIED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: event.entityRef,
        entityNo: policyNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          oldAmount,
          newAmount,
          approvalId: event.approvalId,
          approvalNo: event.approvalNo,
          appliedByUserId: event.decisionByUserId,
          appliedByUserNo: event.decisionByUserNo,
        },
        requestId: `TRANSACTION_LIMIT_CHANGE_APPLIED_${policyNo}`,
        sourcePlatform: 'SYSTEM',
      });

      await this.approvalsService.markExecutionResult(
        event.approvalId,
        true,
        {
          actorType: 'ADMIN',
          userId: event.decisionByUserId || 'SYSTEM',
          userNo: event.decisionByUserNo || undefined,
          role: event.decisionByRole || 'SYSTEM',
          roleCodes: event.decisionByRole ? [event.decisionByRole] : [],
        },
        'Transaction limit updated successfully',
      );
    } catch (error) {
      let policyNo: string | undefined;
      try {
        const approvalCase = await this.prisma.approvalCase.findUnique({
          where: { id: event.approvalId },
        });
        const snapshot = approvalCase?.objectSnapshot
          ? JSON.parse(approvalCase.objectSnapshot as string)
          : {};
        policyNo = snapshot.policyNo;
      } catch {
        // Ignore snapshot parse errors in error path
      }

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_APPLY_FAILED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: event.entityRef,
        entityNo: policyNo || undefined,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
        traceId: event.traceId,
        result: AuditResult.FAILED,
        reason: error instanceof Error ? error.message : 'Limit change execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: `TRANSACTION_LIMIT_CHANGE_APPLY_FAILED_${event.entityRef}`,
        sourcePlatform: 'SYSTEM',
      });

      await this.approvalsService
        .markExecutionResult(
          event.approvalId,
          false,
          {
            actorType: 'ADMIN',
            userId: event.decisionByUserId || 'SYSTEM',
            userNo: event.decisionByUserNo || undefined,
            role: event.decisionByRole || 'SYSTEM',
            roleCodes: event.decisionByRole ? [event.decisionByRole] : [],
          },
          error instanceof Error ? error.message : 'Limit change execution failed',
        )
        .catch(() => undefined);

      throw error;
    }
  }

  private async cancelChange(event: ApprovalDecidedEvent) {
    const approvalCase = await this.prisma.approvalCase.findUnique({
      where: { id: event.approvalId },
    });
    const snapshot = approvalCase?.objectSnapshot
      ? JSON.parse(approvalCase.objectSnapshot as string)
      : {};
    const policyNo = snapshot.policyNo as string | undefined;

    if (policyNo) {
      try {
        await this.limitsService.setStatus(policyNo, 'ACTIVE');
      } catch {
        // Policy may have been deleted; ignore
      }
    }

    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_CANCELLED,
      entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
      entityId: event.entityRef,
      entityNo: policyNo || undefined,
      workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
      traceId: event.traceId,
      result: AuditResult.SUCCESS,
      metadata: {
        decision: event.decision,
        approvalId: event.approvalId,
        approvalNo: event.approvalNo,
      },
      requestId: `TRANSACTION_LIMIT_CHANGE_CANCELLED_${event.entityRef}`,
      sourcePlatform: 'SYSTEM',
    });
  }
}
