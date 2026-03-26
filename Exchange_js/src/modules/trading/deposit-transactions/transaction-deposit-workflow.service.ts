import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import { AuditTriggerType } from '../../risk-engine/audit-logs/dto/audit-log.dto';
import {
  DepositTransactionAction,
  DepositTransactionStatus,
} from './dto/deposit-transaction.dto';
import {
  DepositStatusUpdateActorContext,
  DepositStatusUpdateOptions,
  DepositTransactionsService,
} from './deposit-transactions.service';

export type TransactionWorkflowAction = 'FLAG' | 'CLEAR' | 'REJECT' | 'FREEZE';
export type TransactionWorkflowProducerType = 'ALERT' | 'CASE' | 'SYSTEM';

export interface TransactionWorkflowTransitionInput {
  depositId: string;
  source: TransactionWorkflowProducerType;
  sourceId: string;
  workflowAction: TransactionWorkflowAction;
  reason?: string | null;
  reasonCode?: string | null;
  actor?: DepositStatusUpdateActorContext;
  decisionRecordId?: string | null;
  alertId?: string | null;
  caseId?: string | null;
  triggerStage?: string | null;
  triggerStatus?: string | null;
}

export interface TransactionWorkflowTransitionResult {
  applied: boolean;
  blocked: boolean;
  blockedReason: string | null;
  depositId: string;
  depositNo: string | null;
  workflowAction: TransactionWorkflowAction;
  transitionCode: string;
  depositStatusBefore: string;
  depositStatusAfter: string;
  auditMetadata: Record<string, unknown>;
}

type DepositWriteClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class TransactionDepositWorkflowService {
  private readonly logger = new Logger(TransactionDepositWorkflowService.name);
  private readonly auditLogsService: AuditLogsService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly depositTransactionsService: DepositTransactionsService,
  ) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

  private getDb(tx?: Prisma.TransactionClient): DepositWriteClient {
    return tx ?? this.prisma;
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  }

  private async getDeposit(id: string, tx?: Prisma.TransactionClient) {
    const deposit = await (this.getDb(tx) as any).depositTransaction.findUnique({
      where: { id },
      select: {
        id: true,
        depositNo: true,
        status: true,
        ownerType: true,
        ownerId: true,
      },
    });

    if (!deposit) {
      throw new NotFoundException(`Deposit transaction not found: ${id}`);
    }

    return deposit;
  }

  private getTraceContext(deposit: { id: string; depositNo?: string | null }) {
    return {
      traceId: `TRANSACTION:${deposit.id}`,
      workflowType: 'TRANSACTION',
      workflowId: deposit.id,
      workflowNo: deposit.depositNo || deposit.id,
    };
  }

  private buildAuditMetadata(
    input: TransactionWorkflowTransitionInput,
    deposit: { id: string; depositNo?: string | null; ownerId?: string | null },
    extra?: Record<string, unknown>,
  ) {
    return {
      depositId: deposit.id,
      customerId: deposit.ownerId || null,
      sourceType: 'DEPOSIT',
      workflow: 'TRANSACTION',
      triggerSource: input.source,
      triggerSourceId: input.sourceId,
      decisionRecordId: input.decisionRecordId || null,
      alertId: input.alertId || null,
      caseId: input.caseId || null,
      reasonCode: input.reasonCode || null,
      triggerStage: input.triggerStage || null,
      triggerStatus: input.triggerStatus || null,
      ...extra,
    };
  }

  private async recordActionAudit(
    action: string,
    deposit: { id: string; depositNo?: string | null; ownerType?: string | null; ownerId?: string | null },
    input: TransactionWorkflowTransitionInput,
    tx: Prisma.TransactionClient | undefined,
    reason: string,
    metadata?: Record<string, unknown>,
  ) {
    const trace = this.getTraceContext(deposit);
    const payload = {
      triggerType: AuditTriggerType.DATA_UPDATE,
      action,
      module: AuditModules.DEPOSIT_TRANSACTIONS,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo || undefined,
      entityOwnerType: deposit.ownerType || 'CUSTOMER',
      entityOwnerId: deposit.ownerId || undefined,
      traceId: trace.traceId,
      workflowType: trace.workflowType,
      workflowId: trace.workflowId,
      workflowNo: trace.workflowNo,
      reason,
      metadata,
      sourcePlatform: input.actor?.sourcePlatform || 'SYSTEM',
    };

    if (input.actor) {
      await this.auditLogsService.recordByActor(
        payload as any,
        {
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          actorNo: input.actor.actorNo,
          actorRole: input.actor.actorRole,
        },
        tx,
      );
      return;
    }

    await this.auditLogsService.recordSystem(payload as any, tx);
  }

  private mapDepositAction(
    workflowAction: TransactionWorkflowAction,
  ): DepositTransactionAction {
    if (workflowAction === 'FLAG') return DepositTransactionAction.FLAG;
    if (workflowAction === 'CLEAR') return DepositTransactionAction.SUCCESS;
    if (workflowAction === 'FREEZE') return DepositTransactionAction.FREEZE;
    return DepositTransactionAction.REJECT;
  }

  private mapAuditAction(workflowAction: TransactionWorkflowAction): string {
    if (workflowAction === 'FLAG') return AuditActions.TX_DEPOSIT_FLAGGED;
    if (workflowAction === 'CLEAR') return AuditActions.TX_DEPOSIT_RELEASED;
    if (workflowAction === 'FREEZE') return AuditActions.TX_DEPOSIT_FROZEN;
    return AuditActions.TX_DEPOSIT_REJECTED;
  }

  private mapTransitionCode(
    workflowAction: TransactionWorkflowAction,
    blocked: boolean,
  ): string {
    if (blocked) return 'TX_DEPOSIT_RELEASE_BLOCKED';
    if (workflowAction === 'FLAG') return 'TX_DEPOSIT_FLAG_TO_UNDER_REVIEW';
    if (workflowAction === 'CLEAR') return 'TX_DEPOSIT_CLEAR_TO_SUCCESS';
    if (workflowAction === 'FREEZE') return 'TX_DEPOSIT_FREEZE_TO_FROZEN';
    return 'TX_DEPOSIT_REJECT_TO_REJECTED';
  }

  private shouldSkip(
    status: string,
    workflowAction: TransactionWorkflowAction,
  ) {
    const current = String(status || '').trim().toUpperCase();
    if (
      current === DepositTransactionStatus.SUCCESS ||
      current === DepositTransactionStatus.FROZEN ||
      current === DepositTransactionStatus.REJECTED ||
      current === DepositTransactionStatus.FAILED
    ) {
      return true;
    }

    if (workflowAction === 'FLAG') {
      return current === DepositTransactionStatus.UNDER_REVIEW;
    }

    return false;
  }

  async execute(
    tx: Prisma.TransactionClient | undefined,
    input: TransactionWorkflowTransitionInput,
  ): Promise<TransactionWorkflowTransitionResult> {
    const deposit = await this.getDeposit(input.depositId, tx);
    const beforeStatus = String(deposit.status || '');
    const auditMetadata = this.buildAuditMetadata(input, deposit);

    if (this.shouldSkip(beforeStatus, input.workflowAction)) {
      return {
        applied: false,
        blocked: false,
        blockedReason: null,
        depositId: deposit.id,
        depositNo: deposit.depositNo || null,
        workflowAction: input.workflowAction,
        transitionCode: 'NO_TRANSITION',
        depositStatusBefore: beforeStatus,
        depositStatusAfter: beforeStatus,
        auditMetadata,
      };
    }

    const isEligibleForReviewAction =
      beforeStatus === DepositTransactionStatus.COMPLIANCE_PENDING ||
      beforeStatus === DepositTransactionStatus.UNDER_REVIEW;
    if (!isEligibleForReviewAction) {
      return {
        applied: false,
        blocked: false,
        blockedReason: null,
        depositId: deposit.id,
        depositNo: deposit.depositNo || null,
        workflowAction: input.workflowAction,
        transitionCode: 'NO_TRANSITION',
        depositStatusBefore: beforeStatus,
        depositStatusAfter: beforeStatus,
        auditMetadata,
      };
    }

    const trace = this.getTraceContext(deposit);
    const updateOptions: DepositStatusUpdateOptions = {
      tx,
      actor: input.actor,
      traceId: trace.traceId,
      workflowType: trace.workflowType,
      workflowId: trace.workflowId,
      workflowNo: trace.workflowNo,
      reason:
        this.normalizeOptionalString(input.reason) ||
        `${input.source} ${input.workflowAction.toLowerCase()} transaction deposit`,
      statusHistoryContext: {
        workflow: 'TRANSACTION',
        workflowAction: input.workflowAction,
        triggerSource: input.source,
        triggerSourceId: input.sourceId,
        alertId: input.alertId || null,
        caseId: input.caseId || null,
        decisionRecordId: input.decisionRecordId || null,
        reasonCode: input.reasonCode || null,
      },
      metadata: {
        ...auditMetadata,
        ...(input.workflowAction === 'CLEAR'
          ? { transactionWorkflowClearanceApproved: true }
          : null),
      },
      sourcePlatform: input.actor?.sourcePlatform || 'SYSTEM',
    };

    try {
      const updated = await this.depositTransactionsService.updateStatus(
        deposit.id,
        {
          action: this.mapDepositAction(input.workflowAction),
          reason: this.normalizeOptionalString(input.reason) || undefined,
        },
        updateOptions,
      );

      const afterStatus = String(updated.status || beforeStatus);
      await this.recordActionAudit(
        this.mapAuditAction(input.workflowAction),
        deposit,
        input,
        tx,
        updateOptions.reason || `${input.workflowAction} applied`,
        this.buildAuditMetadata(input, deposit, {
          depositStatusBefore: beforeStatus,
          depositStatusAfter: afterStatus,
          transitionCode: this.mapTransitionCode(input.workflowAction, false),
        }),
      );

      return {
        applied: true,
        blocked: false,
        blockedReason: null,
        depositId: deposit.id,
        depositNo: deposit.depositNo || null,
        workflowAction: input.workflowAction,
        transitionCode: this.mapTransitionCode(input.workflowAction, false),
        depositStatusBefore: beforeStatus,
        depositStatusAfter: afterStatus,
        auditMetadata: this.buildAuditMetadata(input, deposit, {
          depositStatusBefore: beforeStatus,
          depositStatusAfter: afterStatus,
        }),
      };
    } catch (error) {
      if (
        input.workflowAction === 'CLEAR' &&
        error instanceof BadRequestException
      ) {
        const response = error.getResponse() as
          | { code?: string; blockedReason?: string; message?: string }
          | string;
        const code =
          typeof response === 'string' ? null : this.normalizeOptionalString(response.code);
        if (code === 'DEPOSIT_RELEASE_BLOCKED') {
          const blockedReason =
            typeof response === 'string'
              ? response
              : this.normalizeOptionalString(response.blockedReason) ||
                this.normalizeOptionalString(response.message) ||
                'Deposit release blocked';
          this.logger.debug(
            `Transaction deposit release blocked for ${deposit.id}: ${blockedReason}`,
          );
          return {
            applied: false,
            blocked: true,
            blockedReason,
            depositId: deposit.id,
            depositNo: deposit.depositNo || null,
            workflowAction: input.workflowAction,
            transitionCode: this.mapTransitionCode(input.workflowAction, true),
            depositStatusBefore: beforeStatus,
            depositStatusAfter: beforeStatus,
            auditMetadata: this.buildAuditMetadata(input, deposit, {
              blockedReason,
              depositStatusBefore: beforeStatus,
              depositStatusAfter: beforeStatus,
            }),
          };
        }
      }

      throw error;
    }
  }
}
