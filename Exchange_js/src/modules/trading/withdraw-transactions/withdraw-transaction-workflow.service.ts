import { BadRequestException, Injectable, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
  buildStateTransitionAction,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditTriggerType } from '../../audit-logging/dto/audit-log.dto';
import {
  isLegacyReadOnlyReviewStage,
  normalizeComplianceReviewStage,
  TRANSACTION_REVIEW_STAGES,
} from '../../risk-engine/constants/onboarding-compliance-workflow.constant';
import {
  WithdrawTransactionAction,
  WithdrawTransactionStatus,
} from './dto/withdraw-transaction.dto';
import { WithdrawTransactionsService } from './withdraw-transactions.service';

export type WithdrawWorkflowAction = 'FLAG' | 'CLEAR' | 'REJECT' | 'FREEZE';
export type WithdrawWorkflowProducerType = 'ALERT' | 'CASE' | 'SYSTEM' | 'ADMIN';

export interface WithdrawWorkflowTransitionActorContext {
  actorType: string;
  actorId: string;
  actorNo?: string | null;
  actorRole?: string | null;
  sourcePlatform?: string | null;
}

export interface WithdrawWorkflowTransitionInput {
  withdrawId: string;
  source: WithdrawWorkflowProducerType;
  sourceId: string;
  workflowAction: WithdrawWorkflowAction;
  reason?: string | null;
  reasonCode?: string | null;
  actor?: WithdrawWorkflowTransitionActorContext | null;
  decisionRecordId?: string | null;
  alertId?: string | null;
  caseId?: string | null;
  triggerStage?: string | null;
  triggerStatus?: string | null;
}

export interface WithdrawWorkflowTransitionResult {
  applied: boolean;
  blocked: boolean;
  blockedReason: string | null;
  withdrawId: string;
  withdrawNo: string | null;
  workflowAction: WithdrawWorkflowAction;
  transitionCode: string;
  withdrawStatusBefore: string;
  withdrawStatusAfter: string;
  auditMetadata: Record<string, unknown>;
}

type WithdrawWriteClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class WithdrawTransactionWorkflowService {
  private readonly logger = new Logger(WithdrawTransactionWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => WithdrawTransactionsService))
    private readonly withdrawTransactionsService: WithdrawTransactionsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private getDb(tx?: Prisma.TransactionClient): WithdrawWriteClient {
    return tx ?? this.prisma;
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  }

  private async getWithdraw(id: string, tx?: Prisma.TransactionClient) {
    const withdraw = await (this.getDb(tx) as any).withdrawTransaction.findUnique({
      where: { id },
      select: {
        id: true,
        withdrawNo: true,
        status: true,
        ownerType: true,
        ownerId: true,
        payoutId: true,
        payoutNo: true,
        statusHistory: true,
      },
    });

    if (!withdraw) {
      throw new NotFoundException(`Withdraw transaction not found: ${id}`);
    }

    return withdraw;
  }

  private getTraceContext(withdraw: { id: string; withdrawNo?: string | null }) {
    return {
      traceId: `${AuditWorkflowTypes.WITHDRAW}:${withdraw.id}`,
      workflowType: AuditWorkflowTypes.WITHDRAW,
    };
  }

  private resolveStage(
    requestedStage?: string | null,
  ): string {
    const normalizedStage = normalizeComplianceReviewStage(requestedStage);
    if (normalizedStage) {
      return normalizedStage;
    }
    return TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_FINAL;
  }

  private buildAuditMetadata(
    input: WithdrawWorkflowTransitionInput,
    withdraw: { id: string; ownerId?: string | null; payoutId?: string | null; payoutNo?: string | null },
    stage: string,
    extra?: Record<string, unknown>,
  ) {
    return {
      withdrawId: withdraw.id,
      payoutId: withdraw.payoutId || null,
      payoutNo: withdraw.payoutNo || null,
      customerId: withdraw.ownerId || null,
      sourceType: 'WITHDRAW',
      workflow: 'TRANSACTION',
      triggerSource: input.source,
      triggerSourceId: input.sourceId,
      decisionRecordId: input.decisionRecordId || null,
      alertId: input.alertId || null,
      caseId: input.caseId || null,
      reasonCode: input.reasonCode || null,
      triggerStage: stage,
      triggerStatus: input.triggerStatus || null,
      ...extra,
    };
  }

  private shouldSkip(status: string, workflowAction: WithdrawWorkflowAction, stage: string) {
    const current = String(status || '').trim().toUpperCase();
    if (
      current === WithdrawTransactionStatus.SUCCESS ||
      current === WithdrawTransactionStatus.FAILED ||
      current === WithdrawTransactionStatus.RETURNED ||
      current === WithdrawTransactionStatus.REJECTED ||
      current === WithdrawTransactionStatus.CANCELLED
    ) {
      return true;
    }

    if (
      workflowAction === 'FLAG' &&
      current === WithdrawTransactionStatus.UNDER_REVIEW
    ) {
      return true;
    }

    if (
      workflowAction === 'CLEAR' &&
      stage === TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_FINAL &&
      current === WithdrawTransactionStatus.PAYOUT_PENDING
    ) {
      return true;
    }

    return false;
  }

  private assertActionAllowed(currentStatus: string, stage: string) {
    if (isLegacyReadOnlyReviewStage(stage)) {
      throw new BadRequestException(
        `Withdraw legacy review stage is read-only: ${stage}`,
      );
    }

    const current = String(currentStatus || '').trim().toUpperCase();

    if (
      current !== WithdrawTransactionStatus.PENDING_COMPLIANCE &&
      current !== WithdrawTransactionStatus.PAYOUT_PENDING &&
      current !== WithdrawTransactionStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException(
        `Withdraw final workflow is not allowed from ${currentStatus}`,
      );
    }
  }

  private mapAuditAction(workflowAction: WithdrawWorkflowAction): string {
    if (workflowAction === 'FLAG' || workflowAction === 'FREEZE') {
      return AuditActions.TX_WITHDRAW_FLAGGED;
    }
    if (workflowAction === 'CLEAR') {
      return AuditActions.TX_WITHDRAW_RELEASED;
    }
    return AuditActions.TX_WITHDRAW_REJECTED;
  }

  private mapTransitionCode(stage: string, workflowAction: WithdrawWorkflowAction): string {
    if (workflowAction === 'FLAG') {
      return 'TX_WITHDRAW_FLAG_TO_UNDER_REVIEW';
    }
    if (workflowAction === 'FREEZE') {
      return 'TX_WITHDRAW_FREEZE_TO_UNDER_REVIEW';
    }
    if (workflowAction === 'REJECT') {
      return 'TX_WITHDRAW_REJECT_TO_REJECTED';
    }
    return 'TX_WITHDRAW_CLEAR_TO_PAYOUT_PENDING';
  }

  private appendStatusHistory(
    statusHistory: string | null | undefined,
    nextStatus: string,
    input: WithdrawWorkflowTransitionInput,
    stage: string,
  ) {
    let history: Array<Record<string, unknown>> = [];
    try {
      if (statusHistory) {
        const parsed = JSON.parse(statusHistory);
        if (Array.isArray(parsed)) {
          history = parsed;
        }
      }
    } catch {
      history = [];
    }

    history.push({
      status: nextStatus,
      timestamp: new Date().toISOString(),
      operator: input.actor?.actorId || input.sourceId,
      source: input.source,
      note: input.reason || null,
      reasonCode: input.reasonCode || null,
      decisionRecordId: input.decisionRecordId || null,
      alertId: input.alertId || null,
      caseId: input.caseId || null,
      triggerStage: stage,
    });

    return JSON.stringify(history);
  }

  private async recordWorkflowAudit(
    tx: Prisma.TransactionClient | undefined,
    withdraw: {
      id: string;
      withdrawNo?: string | null;
      ownerType?: string | null;
      ownerId?: string | null;
    },
    input: WithdrawWorkflowTransitionInput,
    reason: string,
    metadata?: Record<string, unknown>,
  ) {
    const trace = this.getTraceContext(withdraw);
    const payload = {
      triggerType: AuditTriggerType.DATA_UPDATE,
      action: this.mapAuditAction(input.workflowAction),
      module: AuditModules.WITHDRAW_TRANSACTIONS,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: withdraw.id,
      entityNo: withdraw.withdrawNo || undefined,
      entityOwnerType: withdraw.ownerType || 'CUSTOMER',
      entityOwnerId: withdraw.ownerId || undefined,
      traceId: trace.traceId,
      workflowType: trace.workflowType,
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
          actorNo: input.actor.actorNo || undefined,
          actorRole: input.actor.actorRole || undefined,
        },
        tx,
      );
      return;
    }

    await this.auditLogsService.recordSystem(payload as any, tx);
  }

  private async transitionDirectToPendingCompliance(
    tx: Prisma.TransactionClient | undefined,
    withdraw: Awaited<ReturnType<WithdrawTransactionWorkflowService['getWithdraw']>>,
    input: WithdrawWorkflowTransitionInput,
    stage: string,
  ) {
    const reason =
      this.normalizeOptionalString(input.reason) ||
      `${input.source} cleared withdraw precheck review`;
    const trace = this.getTraceContext(withdraw);
    const nextStatus = WithdrawTransactionStatus.PENDING_COMPLIANCE;
    const metadata = this.buildAuditMetadata(input, withdraw, stage, {
      withdrawStatusBefore: withdraw.status,
      withdrawStatusAfter: nextStatus,
      transitionCode: this.mapTransitionCode(stage, input.workflowAction),
    });
    const db = this.getDb(tx) as any;
    const updated = await db.withdrawTransaction.update({
      where: { id: withdraw.id },
      data: {
        status: nextStatus,
        completedAt: null,
        statusHistory: this.appendStatusHistory(
          withdraw.statusHistory,
          nextStatus,
          input,
          stage,
        ),
      },
    });

    if (input.actor) {
      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.STATE_TRANSITION,
          action: buildStateTransitionAction('WITHDRAW', String(withdraw.status), nextStatus),
          module: AuditModules.WITHDRAW_TRANSACTIONS,
          entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
          entityId: updated.id,
          entityNo: updated.withdrawNo,
          entityOwnerType: updated.ownerType,
          entityOwnerId: updated.ownerId,
          traceId: trace.traceId,
          workflowType: trace.workflowType,
          statusFrom: String(withdraw.status),
          statusTo: nextStatus,
          reason,
          beforeData: { status: withdraw.status },
          afterData: { status: nextStatus },
          metadata,
          sourcePlatform: input.actor.sourcePlatform || 'SYSTEM',
        },
        {
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          actorNo: input.actor.actorNo || undefined,
          actorRole: input.actor.actorRole || undefined,
        },
        tx,
      );
    } else {
      await this.auditLogsService.recordSystem(
        {
          triggerType: AuditTriggerType.STATE_TRANSITION,
          action: buildStateTransitionAction('WITHDRAW', String(withdraw.status), nextStatus),
          module: AuditModules.WITHDRAW_TRANSACTIONS,
          entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
          entityId: updated.id,
          entityNo: updated.withdrawNo,
          entityOwnerType: updated.ownerType,
          entityOwnerId: updated.ownerId,
          traceId: trace.traceId,
          workflowType: trace.workflowType,
          statusFrom: String(withdraw.status),
          statusTo: nextStatus,
          reason,
          beforeData: { status: withdraw.status },
          afterData: { status: nextStatus },
          metadata,
          sourcePlatform: 'SYSTEM',
        },
        tx,
      );
    }

    await this.recordWorkflowAudit(tx, updated, input, reason, metadata);
    return updated;
  }

  async execute(
    tx: Prisma.TransactionClient | undefined,
    input: WithdrawWorkflowTransitionInput,
  ): Promise<WithdrawWorkflowTransitionResult> {
    const withdraw = await this.getWithdraw(input.withdrawId, tx);
    const beforeStatus = String(withdraw.status || '');
    const stage = this.resolveStage(input.triggerStage);
    const auditMetadata = this.buildAuditMetadata(input, withdraw, stage);

    if (this.shouldSkip(beforeStatus, input.workflowAction, stage)) {
      return {
        applied: false,
        blocked: false,
        blockedReason: null,
        withdrawId: withdraw.id,
        withdrawNo: withdraw.withdrawNo || null,
        workflowAction: input.workflowAction,
        transitionCode: 'NO_TRANSITION',
        withdrawStatusBefore: beforeStatus,
        withdrawStatusAfter: beforeStatus,
        auditMetadata,
      };
    }

    this.assertActionAllowed(beforeStatus, stage);

    let updatedStatus = beforeStatus;
    const action =
      input.workflowAction === 'FLAG' || input.workflowAction === 'FREEZE'
        ? WithdrawTransactionAction.FLAG
        : input.workflowAction === 'CLEAR'
          ? WithdrawTransactionAction.APPROVE
          : WithdrawTransactionAction.REJECT;

    const reason =
      this.normalizeOptionalString(input.reason) ||
      `${input.source} ${input.workflowAction.toLowerCase()} withdraw`;

    const updated = await this.withdrawTransactionsService.updateStatus(
      withdraw.id,
      {
        action,
        reason,
      },
      {
        source: 'WORKFLOW',
        actorType: input.actor?.actorType || 'SYSTEM',
        actorId: input.actor?.actorId || input.sourceId,
        actorRole: input.actor?.actorRole || input.actor?.actorType || 'SYSTEM',
        sourcePlatform: input.actor?.sourcePlatform || 'SYSTEM',
      },
      tx,
    );

    updatedStatus = String(updated.status || beforeStatus);
    const metadata = this.buildAuditMetadata(input, withdraw, stage, {
      withdrawStatusBefore: beforeStatus,
      withdrawStatusAfter: updatedStatus,
      transitionCode: this.mapTransitionCode(stage, input.workflowAction),
    });
    await this.recordWorkflowAudit(tx, withdraw, input, reason, metadata);

    return {
      applied: true,
      blocked: false,
      blockedReason: null,
      withdrawId: withdraw.id,
      withdrawNo: withdraw.withdrawNo || null,
      workflowAction: input.workflowAction,
      transitionCode: this.mapTransitionCode(stage, input.workflowAction),
      withdrawStatusBefore: beforeStatus,
      withdrawStatusAfter: updatedStatus,
      auditMetadata: metadata,
    };
  }
}
