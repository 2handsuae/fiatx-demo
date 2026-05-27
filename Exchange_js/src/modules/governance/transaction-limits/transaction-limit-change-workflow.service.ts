import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
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
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../approvals/constants/approval.constants';
import { TransactionLimitsService } from './transaction-limits.service';

const SECONDARY_EVENT = 'workflow.transaction-limit-change.decided';

const SYSTEM_ACTOR: ApprovalActorContext = {
  actorType: 'ADMIN',
  userId: 'SYSTEM',
  userNo: 'SYSTEM',
  role: 'SYSTEM',
  roleCodes: ['SYSTEM'],
};

@Injectable()
export class TransactionLimitChangeWorkflowService {
  private readonly logger = new Logger(TransactionLimitChangeWorkflowService.name);

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
    limitAmount: number,
    changeReason: string,
    actor: ApprovalActorContext,
  ) {
    // 1. Find policy, verify it exists and is ACTIVE
    const policy = await this.limitsService.findByPolicyNo(policyNo);

    if (policy.status !== 'ACTIVE') {
      throw new ConflictException(
        `Policy ${policyNo} is not ACTIVE (current status: ${policy.status}). Cannot submit a change request.`,
      );
    }

    // 2. Validate input
    if (limitAmount <= 0) {
      throw new BadRequestException('limitAmount must be greater than 0');
    }
    if (!changeReason?.trim()) {
      throw new BadRequestException('changeReason is required');
    }
    if (new Prisma.Decimal(limitAmount).equals(policy.limitAmount)) {
      throw new BadRequestException('New amount is the same as current amount');
    }

    // 3. Check no pending request for same policyId
    const existingPending = await this.prisma.transactionLimitChangeRequest.findFirst({
      where: {
        policyId: policy.id,
        status: 'PENDING_APPROVAL',
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending change request already exists for ${policyNo}: ${existingPending.requestNo}`,
      );
    }

    // 5. INSERT TransactionLimitChangeRequest via L1
    const request = (await this.limitsService.createChangeRequest({
      policyId: policy.id,
      policyNo: policy.policyNo,
      proposedAmount: new Prisma.Decimal(limitAmount),
      changeReason: changeReason.trim(),
      requestedByUserId: actor.userId,
    }))!;
    const requestNo = request.requestNo;

    // 6. Create approval case (entityRef = request.id)
    const traceId = crypto.randomUUID();
    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE,
          entityRef: request.id,
          traceId,
          objectSnapshot: {
            requestId: request.id,
            requestNo,
            policyId: policy.id,
            policyNo: policy.policyNo,
            tradingTier: policy.tradingTier,
            operationType: policy.operationType,
            period: policy.period,
            currentAmount: policy.limitAmount.toString(),
            proposedAmount: String(limitAmount),
            changeReason: changeReason.trim(),
          },
        },
        {
          reason: changeReason.trim(),
          traceId,
        },
        actor,
      );
    } catch (err) {
      // Rollback: delete the request row
      await this.limitsService.cancelChangeRequest(request.requestNo);
      throw err;
    }

    // 7. Link approval case to request
    await this.limitsService.linkApprovalCaseToRequest(request.requestNo, approvalCase.id, approvalCase.approvalNo);

    // 8. Audit CHANGE_REQUESTED
    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_REQUESTED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: request.id,
        entityNo: requestNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          policyId: policy.id,
          policyNo: policy.policyNo,
          tradingTier: policy.tradingTier,
          operationType: policy.operationType,
          period: policy.period,
          currentAmount: policy.limitAmount.toString(),
          proposedAmount: String(limitAmount),
          changeReason: changeReason.trim(),
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `TRANSACTION_LIMIT_CHANGE_REQUESTED_${requestNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      requestNo,
      policyNo: policy.policyNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: any) {
    const decision = event?.decision;
    const approvalId = event?.approvalId;
    const entityRef = event?.entityRef;

    if (!approvalId || !entityRef) {
      this.logger.warn('Transaction limit change decided event missing approvalId or entityRef');
      return;
    }

    if (decision === 'APPROVED') {
      await this.executeChange(approvalId, entityRef, event);
    } else {
      await this.cancelChange(approvalId, entityRef, decision, event);
    }
  }

  private async executeChange(approvalId: string, requestId: string, event: any) {
    let request: Awaited<ReturnType<typeof this.prisma.transactionLimitChangeRequest.findUnique>> | null = null;
    try {
      // 1. Load request, verify PENDING_APPROVAL
      request = await this.prisma.transactionLimitChangeRequest.findUnique({
        where: { id: requestId },
      });
      if (!request || request.status !== 'PENDING_APPROVAL') {
        this.logger.warn(`Change request ${requestId} not found or not PENDING_APPROVAL`);
        return;
      }

      // 2. Load policy
      const policy = await this.prisma.transactionLimitPolicy.findUnique({
        where: { id: request.policyId },
      });
      if (!policy) {
        await this.limitsService.markRequestExecutionFailed(request.requestNo, 'Policy no longer exists');
        return;
      }

      // 3. Conflict check: currentAmount snapshot vs actual
      if (!request.currentAmount.equals(policy.limitAmount)) {
        const reason = `Conflict: policy limit was changed since request submission (expected ${request.currentAmount}, actual ${policy.limitAmount})`;
        await this.limitsService.markRequestExecutionFailed(request.requestNo, reason);
        await this.auditLogsService.recordSystem({
          action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_APPLY_FAILED,
          entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
          entityId: request.id,
          entityNo: request.requestNo,
          workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
          traceId: event?.traceId,
          result: AuditResult.FAILED,
          reason,
          metadata: {
            policyId: request.policyId,
            policyNo: request.policyNo,
            expectedAmount: request.currentAmount.toString(),
            actualAmount: policy.limitAmount.toString(),
          },
          requestId: `TRANSACTION_LIMIT_CHANGE_APPLY_FAILED_${request.requestNo}`,
          sourcePlatform: 'SYSTEM',
        });
        this.logger.warn(`Change request ${request.requestNo} failed: ${reason}`);
        return;
      }

      // 4+5. Apply change and mark request as executed (L1 does both)
      await this.limitsService.executeChange(request.requestNo);

      // 7. Audit CHANGE_APPLIED
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_APPLIED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: request.id,
        entityNo: request.requestNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
        traceId: event?.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          policyId: request.policyId,
          policyNo: request.policyNo,
          oldAmount: request.currentAmount.toString(),
          newAmount: request.proposedAmount.toString(),
          approvalId,
          approvalNo: event?.approvalNo,
        },
        requestId: `TRANSACTION_LIMIT_CHANGE_APPLIED_${request.requestNo}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Change request ${request.requestNo} executed: ${request.policyNo} limit → ${request.proposedAmount}`);
    } catch (err: any) {
      this.logger.error(`Failed to execute change request ${requestId}: ${err.message}`);

      // Try to mark as failed
      if (request) {
        try {
          await this.limitsService.markRequestExecutionFailed(request.requestNo, err.message);
        } catch { /* ignore */ }
      }

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_APPLY_FAILED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: requestId,
        entityNo: request?.requestNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
        traceId: event?.traceId,
        result: AuditResult.FAILED,
        reason: err.message,
        metadata: { approvalId },
        requestId: `TRANSACTION_LIMIT_CHANGE_APPLY_FAILED_${requestId}`,
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async cancelChange(
    approvalId: string,
    requestId: string,
    decision: string,
    event: any,
  ) {
    try {
      const request = await this.prisma.transactionLimitChangeRequest.findUnique({
        where: { id: requestId },
      });
      if (!request) {
        this.logger.warn(`Change request ${requestId} not found for cancellation`);
        return;
      }

      // Update request status
      if (decision === 'REJECTED') {
        await this.limitsService.rejectChangeRequest(request.requestNo);
      } else {
        await this.limitsService.cancelChangeRequest(request.requestNo);
      }

      // Audit
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_CANCELLED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: request.id,
        entityNo: request.requestNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
        traceId: event?.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          decision,
          policyId: request.policyId,
          policyNo: request.policyNo,
          approvalId,
          approvalNo: event?.approvalNo,
        },
        requestId: `TRANSACTION_LIMIT_CHANGE_CANCELLED_${request.requestNo}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Change request ${request.requestNo} cancelled (${decision})`);
    } catch (err: any) {
      this.logger.error(`Failed to cancel change request ${requestId}: ${err.message}`);
    }
  }
}
