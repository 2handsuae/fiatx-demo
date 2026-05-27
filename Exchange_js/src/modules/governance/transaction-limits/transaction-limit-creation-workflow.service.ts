import { Injectable, BadRequestException, Logger } from '@nestjs/common';
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
import {
  OPERATION_TYPES,
  LIMIT_PERIODS,
} from './constants/limit-policy.constants';

const SECONDARY_EVENT = 'workflow.transaction-limit-creation.decided';

const SYSTEM_ACTOR: ApprovalActorContext = {
  actorType: 'ADMIN',
  userId: 'SYSTEM',
  userNo: 'SYSTEM',
  role: 'SYSTEM',
  roleCodes: ['SYSTEM'],
};

@Injectable()
export class TransactionLimitCreationWorkflowService {
  private readonly logger = new Logger(TransactionLimitCreationWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly limitsService: TransactionLimitsService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async initiateCreate(
    dto: {
      tradingTier: string;
      operationType: string;
      period: string;
      limitAmount: number;
      reason: string;
    },
    actor: ApprovalActorContext,
  ) {
    const { tradingTier, operationType, period, limitAmount, reason } = dto;

    // Validate enum fields
    if (!tradingTier || !tradingTier.trim()) {
      throw new BadRequestException('tradingTier is required');
    }
    if (!OPERATION_TYPES.includes(operationType as any)) {
      throw new BadRequestException(`Invalid operationType: ${operationType}. Must be one of: ${OPERATION_TYPES.join(', ')}`);
    }
    if (!LIMIT_PERIODS.includes(period as any)) {
      throw new BadRequestException(`Invalid period: ${period}. Must be one of: ${LIMIT_PERIODS.join(', ')}`);
    }
    if (limitAmount <= 0) {
      throw new BadRequestException('limitAmount must be greater than 0');
    }
    if (!reason?.trim()) {
      throw new BadRequestException('reason is required');
    }

    // Check uniqueness: no existing row (ACTIVE or PENDING_APPROVAL) for this combo
    const existing = await this.prisma.transactionLimitPolicy.findFirst({
      where: { tradingTier, operationType, period },
    });
    if (existing) {
      throw new BadRequestException(
        `A policy for [${tradingTier}, ${operationType}, ${period}] already exists (${existing.policyNo}, status: ${existing.status})`,
      );
    }

    // INSERT with PENDING_APPROVAL (retry-safe policyNo generation)
    const policy = await this.limitsService.createPolicy({
      tradingTier,
      operationType,
      period,
      limitAmount: new Prisma.Decimal(limitAmount),
    });

    // Create approval case
    const traceId = crypto.randomUUID();
    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.TRANSACTION_LIMIT_CREATION,
          entityRef: policy.id,
          traceId,
          objectSnapshot: {
            policyId: policy.id,
            policyNo: policy.policyNo,
            tradingTier,
            operationType,
            period,
            limitAmount: String(limitAmount),
            reason,
          },
        },
        {
          reason,
          traceId,
        },
        actor,
      );
    } catch (err) {
      // Rollback: delete the inserted row
      await this.limitsService.deleteById(policy.id);
      throw err;
    }

    // Link approval case to policy
    await this.limitsService.linkApprovalCaseToPolicy(policy.policyNo, approvalCase.id);

    // Audit
    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.CREATION_REQUESTED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: policy.id,
        entityNo: policy.policyNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          tradingTier,
          operationType,
          period,
          limitAmount: String(limitAmount),
          reason,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `TRANSACTION_LIMIT_CREATION_REQUESTED_${policy.policyNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.userId,
        actorNo: actor.userNo,
        actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
      },
    );

    return {
      policyNo: policy.policyNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async onDecided(payload: any) {
    const decision = payload?.decision;
    const approvalId = payload?.approvalId;
    const entityRef = payload?.entityRef;

    if (!approvalId || !entityRef) {
      this.logger.warn('Transaction limit creation decided event missing approvalId or entityRef');
      return;
    }

    if (decision === 'APPROVED') {
      await this.executeActivation(approvalId, entityRef, payload);
    } else {
      await this.executeCancellation(approvalId, entityRef, decision, payload);
    }
  }

  private async executeActivation(approvalId: string, policyId: string, event: any) {
    let policy: any;
    try {
      policy = await this.prisma.transactionLimitPolicy.findUnique({
        where: { id: policyId },
      });
      if (!policy || policy.status !== 'PENDING_APPROVAL') {
        this.logger.warn(`Policy ${policyId} not found or not in PENDING_APPROVAL status`);
        return;
      }

      // Activate
      await this.limitsService.activatePolicy(policy.policyNo);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.CREATION_APPLIED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: policy.id,
        entityNo: policy.policyNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION,
        traceId: event?.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          tradingTier: policy.tradingTier,
          operationType: policy.operationType,
          period: policy.period,
          limitAmount: policy.limitAmount.toString(),
        },
        requestId: `TRANSACTION_LIMIT_CREATION_APPLIED_${policy.policyNo}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Policy ${policy.policyNo} activated`);
    } catch (err: any) {
      this.logger.error(`Failed to activate policy ${policyId}: ${err.message}`);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.CREATION_APPLY_FAILED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: policyId,
        entityNo: policy?.policyNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION,
        traceId: event?.traceId,
        result: AuditResult.FAILED,
        metadata: { error: err.message },
        requestId: `TRANSACTION_LIMIT_CREATION_APPLY_FAILED_${policyId}`,
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async executeCancellation(
    approvalId: string,
    policyId: string,
    decision: string,
    event: any,
  ) {
    try {
      const policy = await this.prisma.transactionLimitPolicy.findUnique({
        where: { id: policyId },
      });
      if (!policy) {
        this.logger.warn(`Policy ${policyId} not found for cancellation`);
        return;
      }

      // Physical delete
      await this.limitsService.deleteRejectedPolicy(policy.policyNo);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.CREATION_CANCELLED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: policy.id,
        entityNo: policy.policyNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION,
        traceId: event?.traceId,
        result: AuditResult.SUCCESS,
        metadata: { decision },
        requestId: `TRANSACTION_LIMIT_CREATION_CANCELLED_${policy.policyNo}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Policy ${policy.policyNo} creation cancelled (${decision}), row deleted`);
    } catch (err: any) {
      this.logger.error(`Failed to cancel policy creation ${policyId}: ${err.message}`);
    }
  }
}
