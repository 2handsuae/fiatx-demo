import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditEntityTypes,
  AuditModules,
  buildStateTransitionAction,
} from '../../audit-logging/constants/audit-actions.constant';
import { JournalsService } from '../../accounting/journals/journals.service';
import { OutstandingsService } from '../../clearing-settle/outstandings/outstandings.service';
import { SwapTransactionStatus } from './dto/swap-transaction.dto';

export type SwapWorkflowAction = 'FLAG' | 'CLEAR' | 'REJECT' | 'FAIL';
export type SwapWorkflowProducerType = 'ALERT' | 'CASE' | 'SYSTEM' | 'ADMIN';

export interface SwapWorkflowTransitionActorContext {
  actorType: string;
  actorId: string;
  actorNo?: string | null;
  actorRole?: string | null;
  sourcePlatform?: string | null;
}

export interface SwapWorkflowTransitionInput {
  swapId: string;
  source: SwapWorkflowProducerType;
  sourceId: string;
  workflowAction: SwapWorkflowAction;
  reason?: string | null;
  reasonCode?: string | null;
  actor?: SwapWorkflowTransitionActorContext | null;
  decisionRecordId?: string | null;
  riskDecisionRef?: string | null;
  alertId?: string | null;
  caseId?: string | null;
  triggerStage?: string | null;
  triggerStatus?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
}

export interface SwapWorkflowTransitionResult {
  applied: boolean;
  blocked: boolean;
  blockedReason: string | null;
  swapId: string;
  swapNo: string | null;
  workflowAction: SwapWorkflowAction;
  transitionCode: string;
  swapStatusBefore: string;
  swapStatusAfter: string;
  auditMetadata: Record<string, unknown>;
}

type SwapWriteClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class SwapTransactionWorkflowService {
  private readonly logger = new Logger(SwapTransactionWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journalsService: JournalsService,
    private readonly outstandingsService: OutstandingsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private getDb(tx?: Prisma.TransactionClient): SwapWriteClient {
    return tx ?? this.prisma;
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  }

  private async getSwap(id: string, tx?: Prisma.TransactionClient) {
    const swap = await (this.getDb(tx) as any).swapTransaction.findUnique({
      where: { id },
      select: {
        id: true,
        swapNo: true,
        quoteId: true,
        quoteNo: true,
        ownerType: true,
        ownerId: true,
        ownerNo: true,
        status: true,
        fromAssetId: true,
        fromAssetCode: true,
        fromAmount: true,
        toAssetId: true,
        toAssetCode: true,
        toAmount: true,
        netToAmount: true,
        feeAmount: true,
        feeCurrency: true,
        exchangeRate: true,
        statusHistory: true,
      },
    });

    if (!swap) {
      throw new NotFoundException(`Swap transaction not found: ${id}`);
    }

    return swap;
  }

  private buildTraceContext(swap: { id: string; quoteId?: string | null; swapNo?: string | null; quoteNo?: string | null }) {
    const workflowId = swap.id;
    const workflowNo =
      this.normalizeOptionalString(swap.swapNo) ||
      workflowId;
    return {
      traceId: `SWAP:${workflowId}`,
      workflowType: 'SWAP',
      workflowId,
      workflowNo,
    };
  }

  private buildAccountingContext(swap: {
    id: string;
    swapNo?: string | null;
    ownerId: string;
    ownerType: string;
    quoteId?: string | null;
    quoteNo?: string | null;
    fromAssetId: string;
    toAssetId: string;
    fromAmount: Prisma.Decimal | string | number;
    toAmount: Prisma.Decimal | string | number;
    netToAmount?: Prisma.Decimal | string | number | null;
    feeAmount?: Prisma.Decimal | string | number | null;
    feeCurrency?: string | null;
    exchangeRate: Prisma.Decimal | string | number;
  }) {
    return {
      src: {
        id: swap.id,
        swapNo: swap.swapNo,
        quoteId: swap.quoteId || null,
        quoteNo: swap.quoteNo || null,
        ownerId: swap.ownerId,
        ownerType: swap.ownerType,
        fromAssetId: swap.fromAssetId,
        toAssetId: swap.toAssetId,
        amount: String(swap.fromAmount),
        fromAmount: String(swap.fromAmount),
        toAmount: String(swap.toAmount),
        netAmount: String(swap.netToAmount ?? swap.toAmount),
        feeAmount: String(swap.feeAmount ?? 0),
        feeAssetId: swap.toAssetId,
        feeCurrency: swap.feeCurrency || null,
        exchangeRate: String(swap.exchangeRate),
      },
    };
  }

  private buildAuditMetadata(
    input: SwapWorkflowTransitionInput,
    swap: { id: string; ownerId?: string | null; quoteId?: string | null; quoteNo?: string | null },
    extra?: Record<string, unknown>,
  ) {
    return {
      swapId: swap.id,
      quoteId: swap.quoteId || null,
      quoteNo: swap.quoteNo || null,
      customerId: swap.ownerId || null,
      sourceType: 'SWAP',
      workflow: 'TRANSACTION',
      triggerSource: input.source,
      triggerSourceId: input.sourceId,
      decisionRecordId: input.decisionRecordId || null,
      riskDecisionRef: input.riskDecisionRef || null,
      alertId: input.alertId || null,
      caseId: input.caseId || null,
      reasonCode: input.reasonCode || null,
      triggerStage: input.triggerStage || null,
      triggerStatus: input.triggerStatus || null,
      failureCode: input.failureCode || null,
      failureReason: input.failureReason || null,
      ...extra,
    };
  }

  private buildAuditAction(
    beforeStatus: string,
    nextStatus: SwapTransactionStatus,
  ): string {
    return buildStateTransitionAction('SWAP', beforeStatus, nextStatus);
  }

  private mapTransitionCode(workflowAction: SwapWorkflowAction): string {
    if (workflowAction === 'FLAG') return 'TX_SWAP_FLAG_TO_UNDER_REVIEW';
    if (workflowAction === 'CLEAR') return 'TX_SWAP_CLEAR_TO_SUCCESS';
    if (workflowAction === 'FAIL') return 'TX_SWAP_FAIL_TO_FAILED';
    return 'TX_SWAP_REJECT_TO_REJECTED';
  }

  private mapStatus(workflowAction: SwapWorkflowAction): SwapTransactionStatus {
    if (workflowAction === 'FLAG') return SwapTransactionStatus.UNDER_REVIEW;
    if (workflowAction === 'CLEAR') return SwapTransactionStatus.SUCCESS;
    if (workflowAction === 'FAIL') return SwapTransactionStatus.FAILED;
    return SwapTransactionStatus.REJECTED;
  }

  private shouldSkip(status: string, workflowAction: SwapWorkflowAction) {
    const current = String(status || '').trim().toUpperCase();
    if (
      current === SwapTransactionStatus.SUCCESS ||
      current === SwapTransactionStatus.REJECTED ||
      current === SwapTransactionStatus.FAILED
    ) {
      return true;
    }

    if (workflowAction === 'FLAG') {
      return current === SwapTransactionStatus.UNDER_REVIEW;
    }

    return false;
  }

  private assertActionAllowed(currentStatus: string, workflowAction: SwapWorkflowAction) {
    const current = String(currentStatus || '').trim().toUpperCase();
    if (
      current !== SwapTransactionStatus.PENDING_COMPLIANCE &&
      current !== SwapTransactionStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException(
        `Swap workflow action ${workflowAction} is not allowed from ${currentStatus}`,
      );
    }
  }

  private appendStatusHistory(statusHistory: string | null | undefined, nextStatus: string, input: SwapWorkflowTransitionInput) {
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
      failureCode: input.failureCode || null,
    });

    return JSON.stringify(history);
  }

  async execute(
    tx: Prisma.TransactionClient | undefined,
    input: SwapWorkflowTransitionInput,
  ): Promise<SwapWorkflowTransitionResult> {
    const swap = await this.getSwap(input.swapId, tx);
    const beforeStatus = String(swap.status || '');
    const auditMetadata = this.buildAuditMetadata(input, swap);

    if (this.shouldSkip(beforeStatus, input.workflowAction)) {
      return {
        applied: false,
        blocked: false,
        blockedReason: null,
        swapId: swap.id,
        swapNo: swap.swapNo || null,
        workflowAction: input.workflowAction,
        transitionCode: 'NO_TRANSITION',
        swapStatusBefore: beforeStatus,
        swapStatusAfter: beforeStatus,
        auditMetadata,
      };
    }

    this.assertActionAllowed(beforeStatus, input.workflowAction);
    const nextStatus = this.mapStatus(input.workflowAction);
    const trace = this.buildTraceContext(swap);

    if (tx) {
      return this.executeWithClient(
        tx,
        swap,
        beforeStatus,
        nextStatus,
        input,
        trace,
        auditMetadata,
      );
    }

    return this.prisma.$transaction(async (innerTx) =>
      this.executeWithClient(
        innerTx,
        swap,
        beforeStatus,
        nextStatus,
        input,
        trace,
        auditMetadata,
      ),
    );
  }

  private async executeWithClient(
    tx: Prisma.TransactionClient,
    swap: any,
    beforeStatus: string,
    nextStatus: SwapTransactionStatus,
    input: SwapWorkflowTransitionInput,
    trace: { traceId: string; workflowType: string; workflowId: string; workflowNo: string },
    auditMetadata: Record<string, unknown>,
  ): Promise<SwapWorkflowTransitionResult> {
    const updated = await (tx as any).swapTransaction.update({
      where: { id: swap.id },
      data: {
        status: nextStatus,
        completedAt:
          nextStatus === SwapTransactionStatus.SUCCESS ||
          nextStatus === SwapTransactionStatus.REJECTED ||
          nextStatus === SwapTransactionStatus.FAILED
            ? new Date()
            : null,
        riskDecisionRef:
          this.normalizeOptionalString(input.riskDecisionRef) || undefined,
        alertId: this.normalizeOptionalString(input.alertId) || undefined,
        caseId: this.normalizeOptionalString(input.caseId) || undefined,
        failureCode:
          nextStatus === SwapTransactionStatus.FAILED
            ? this.normalizeOptionalString(input.failureCode)
            : undefined,
        failureReason:
          nextStatus === SwapTransactionStatus.FAILED
            ? this.normalizeOptionalString(input.failureReason || input.reason)
            : undefined,
        statusHistory: this.appendStatusHistory(
          swap.statusHistory,
          nextStatus,
          input,
        ),
      },
      include: {
        fromAsset: true,
        toAsset: true,
      },
    });

    if (input.actor) {
      await this.auditLogsService.recordByActor(
        {

          action: this.buildAuditAction(beforeStatus, nextStatus),
          entityType: AuditEntityTypes.SWAP_TRANSACTION,
          entityId: updated.id,
          entityNo: updated.swapNo || undefined,
          traceId: trace.traceId,
          workflowType: trace.workflowType,
          entityOwnerType: updated.ownerType,
          entityOwnerId: updated.ownerId,
          entityOwnerNo: updated.ownerNo || undefined,
          reason: input.reason || `Swap workflow action ${input.workflowAction}`,
          metadata: auditMetadata,
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

          action: this.buildAuditAction(beforeStatus, nextStatus),
          entityType: AuditEntityTypes.SWAP_TRANSACTION,
          entityId: updated.id,
          entityNo: updated.swapNo || undefined,
          traceId: trace.traceId,
          workflowType: trace.workflowType,
          entityOwnerType: updated.ownerType,
          entityOwnerId: updated.ownerId,
          entityOwnerNo: updated.ownerNo || undefined,
          reason: input.reason || `Swap workflow action ${input.workflowAction}`,
          metadata: auditMetadata,
          sourcePlatform: 'SYSTEM',
        },
        tx,
      );
    }

    if (
      nextStatus === SwapTransactionStatus.SUCCESS ||
      nextStatus === SwapTransactionStatus.REJECTED ||
      nextStatus === SwapTransactionStatus.FAILED
    ) {
      await this.journalsService.triggerEvent(
        {
          entityType: 'SWAP',
          triggerKey: 'status',
          fromStatus: beforeStatus,
          toStatus: nextStatus,
          assetType: 'ALL',
          context: this.buildAccountingContext(updated),
          sourceId: updated.id,
        },
        tx,
      );
    }

    if (nextStatus === SwapTransactionStatus.SUCCESS) {
      await this.outstandingsService.createForSwapSuccess(tx, updated);
    } else if (
      nextStatus === SwapTransactionStatus.REJECTED ||
      nextStatus === SwapTransactionStatus.FAILED
    ) {
      await (tx as any).outstanding.deleteMany({
        where: {
          sourceType: 'SWAP',
          sourceId: updated.id,
        },
      });
    }

    this.logger.log(
      `Swap ${updated.id} transitioned ${beforeStatus} -> ${nextStatus} via ${input.workflowAction}`,
    );

    return {
      applied: true,
      blocked: false,
      blockedReason: null,
      swapId: updated.id,
      swapNo: updated.swapNo || null,
      workflowAction: input.workflowAction,
      transitionCode: this.mapTransitionCode(input.workflowAction),
      swapStatusBefore: beforeStatus,
      swapStatusAfter: nextStatus,
      auditMetadata,
    };
  }
}
