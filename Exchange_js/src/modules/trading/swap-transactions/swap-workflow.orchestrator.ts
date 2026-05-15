import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ensureCustomerCanTransact } from '../shared/customer-transaction-guard';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { TransactionComplianceService } from '../../risk-engine/transaction-compliance/transaction-compliance.service';
import { PricingCenterService } from '../pricing-center/pricing-center.service';
import { SwapEvents } from './constants/swap-events.constant';
import {
  SwapTransactionAction,
  SwapTransactionStatus,
  UpdateSwapTransactionStatusDto,
} from './dto/swap-transaction.dto';
import { SwapTransactionsService } from './swap-transactions.service';
import {
  SwapTransactionWorkflowService,
  SwapWorkflowAction,
} from './swap-transaction-workflow.service';

export interface SwapOrchestratorOutput {
  swap_status_after: SwapTransactionStatus;
  emitted_events: string[];
  audit_log_id: string;
  transaction: any;
}

@Injectable()
export class SwapWorkflowOrchestrator {
  private readonly logger = new Logger(SwapWorkflowOrchestrator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly swapService: SwapTransactionsService,
    private readonly pricingCenterService: PricingCenterService,
    private readonly transactionComplianceService: TransactionComplianceService,
    private readonly swapTransactionWorkflowService: SwapTransactionWorkflowService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private parseJson<T>(value: string | null | undefined, fallback: T): T {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private createAccountingContext(swap: {
    id: string;
    swapNo: string | null;
    quoteId?: string | null;
    quoteNo?: string | null;
    ownerId: string;
    ownerType: string;
    fromAssetId: string;
    toAssetId: string;
    fromAmount: Prisma.Decimal;
    toAmount: Prisma.Decimal;
    netToAmount?: Prisma.Decimal | null;
    feeAmount?: Prisma.Decimal | null;
    feeCurrency?: string | null;
    exchangeRate: Prisma.Decimal;
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
        amount: swap.fromAmount.toString(),
        fromAmount: swap.fromAmount.toString(),
        toAmount: swap.toAmount.toString(),
        netAmount: (swap.netToAmount || swap.toAmount).toString(),
        feeAmount: (swap.feeAmount || new Prisma.Decimal(0)).toString(),
        feeAssetId: swap.toAssetId,
        feeCurrency: swap.feeCurrency || null,
        exchangeRate: swap.exchangeRate.toString(),
      },
    };
  }

  private buildInitialStatusHistory(input: {
    status: SwapTransactionStatus;
    operator: string;
    source: string;
    note: string;
    quoteId?: string | null;
    quoteNo?: string | null;
  }) {
    return JSON.stringify([
      {
        status: input.status,
        timestamp: new Date().toISOString(),
        operator: input.operator,
        source: input.source,
        note: input.note,
        quoteId: input.quoteId || null,
        quoteNo: input.quoteNo || null,
      },
    ]);
  }

  private mapAdminAction(action: SwapTransactionAction): SwapWorkflowAction {
    if (action === SwapTransactionAction.SUCCESS) return 'CLEAR';
    if (action === SwapTransactionAction.FLAG) return 'FLAG';
    if (action === SwapTransactionAction.FAIL) return 'FAIL';
    return 'REJECT';
  }

  private resolveEmittedEventsForStatus(status: string): string[] {
    if (status === SwapTransactionStatus.SUCCESS) {
      return [SwapEvents.EVT_SWAP_SUCCESS];
    }
    if (status === SwapTransactionStatus.REJECTED) {
      return [SwapEvents.EVT_SWAP_REJECTED];
    }
    if (status === SwapTransactionStatus.FAILED) {
      return [SwapEvents.EVT_SWAP_FAILED];
    }
    if (status === SwapTransactionStatus.UNDER_REVIEW) {
      return [];
    }
    return [SwapEvents.EVT_SWAP_CREATED];
  }

  private async finalizeSwapCompliance(swapId: string) {
    try {
      await this.transactionComplianceService.evaluateSwapFinalReview(swapId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error || 'UNKNOWN_ERROR');
      this.logger.error(
        `Swap final compliance evaluation failed for ${swapId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.swapTransactionWorkflowService.execute(undefined, {
        swapId,
        source: 'SYSTEM',
        sourceId: 'SYSTEM',
        workflowAction: 'FAIL',
        reason: `Swap final compliance evaluation failed: ${message}`,
        reasonCode: 'TX_SWAP_FINAL_EVALUATION_FAILED',
        failureCode: 'TX_SWAP_FINAL_EVALUATION_FAILED',
        failureReason: message,
        actor: {
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          actorNo: 'SYSTEM',
          actorRole: 'SYSTEM',
          sourcePlatform: 'SYSTEM',
        },
        triggerStage: 'REVIEW_SWAP_FINAL',
        triggerStatus: 'FAILED',
      });
    }
  }

  async createSwapFromQuote(
    ownerId: string,
    quoteId: string,
  ): Promise<SwapOrchestratorOutput> {
    // Enforce compliance hold / restriction checks before creating the swap
    const customer = await (this.prisma as any).customerMain.findUnique({
      where: { id: ownerId },
    });
    ensureCustomerCanTransact(customer);

    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const quote = await this.pricingCenterService.getActiveSwapQuoteOrThrow(
        quoteId,
        'CUSTOMER',
        ownerId,
        now,
        tx,
      );

      await this.pricingCenterService.assertSwapProductAllowedForOwner({
        ownerType: 'CUSTOMER',
        ownerId,
        ownerNo: quote.ownerNo,
        fromAssetId: quote.fromAssetId,
        toAssetId: quote.toAssetId,
        sourcePlatform: 'CUSTOMER_API',
      });

      const fromAmount = new Prisma.Decimal(quote.amountIn);
      const toAmount = new Prisma.Decimal(quote.amountOut);
      const totals = this.parseJson<Record<string, string>>(quote.totalsJson, {});
      const netToAmount = new Prisma.Decimal(
        totals.amountOutNet || quote.amountOut.toString(),
      );
      const feeAmount = new Prisma.Decimal(quote.feeTotal || 0);
      const rate = new Prisma.Decimal(quote.rateAllIn);
      const swapNo = generateReferenceNo('SWP');

      // V2 balance check removed — migrated to TigerBeetle
      // TODO: re-wire balance guard via TigerBeetle adapter

      await this.pricingCenterService.consumeSwapQuoteForSwap(
        tx,
        quote.id,
        'CUSTOMER',
        ownerId,
        now,
      );

      const transaction = await tx.swapTransaction.create({
        data: {
          swapNo,
          quoteId: quote.id,
          quoteNo: quote.quoteNo,
          quoteSnapshotRef: quote.id,
          ownerType: 'CUSTOMER',
          ownerId,
          ownerNo: quote.ownerNo,
          status: SwapTransactionStatus.PENDING_COMPLIANCE,
          fromAssetId: quote.fromAssetId,
          fromAssetCode: quote.fromAssetCode,
          fromAmount,
          toAssetId: quote.toAssetId,
          toAssetCode: quote.toAssetCode,
          toAmount,
          netToAmount,
          feeAmount,
          feeCurrency: quote.feeCurrency || quote.toAssetCode,
          feeBreakdown: quote.feeBreakdown,
          exchangeRate: rate,
          statusHistory: this.buildInitialStatusHistory({
            status: SwapTransactionStatus.PENDING_COMPLIANCE,
            operator: ownerId,
            source: 'CUSTOMER',
            note: `Swap created from quote ${quote.quoteNo || quote.id}`,
            quoteId: quote.id,
            quoteNo: quote.quoteNo,
          }),
        },
        include: {
          fromAsset: true,
          toAsset: true,
        },
      });

      const auditLog = await this.auditLogsService.recordByActor(
        {

          action: AuditActions.SWAP_CREATED,
          entityType: AuditEntityTypes.SWAP_TRANSACTION,
          entityId: transaction.id,
          entityNo: transaction.swapNo || undefined,
          traceId: `SWAP:${transaction.id}`,
          workflowType: AuditWorkflowTypes.SWAP,
          entityOwnerType: transaction.ownerType,
          entityOwnerId: transaction.ownerId,
          entityOwnerNo: transaction.ownerNo || undefined,
          reason: `Created from quote ${quote.id}`,
          metadata: {
            quoteId: quote.id,
            quoteNo: quote.quoteNo,
            quoteSnapshotRef: quote.id,
          },
          sourcePlatform: 'CUSTOMER_API',
        },
        {
          actorType: 'CUSTOMER',
          actorId: ownerId,
          actorNo: quote.ownerNo || undefined,
          actorRole: 'CUSTOMER',
        },
        tx,
      );

      // V2 accounting removed — migrated to TigerBeetle

      return {
        audit_log_id: auditLog.id,
        transaction,
      };
    });

    await this.finalizeSwapCompliance(result.transaction.id);
    const refreshed = await this.swapService.findOne(result.transaction.id);

    return {
      swap_status_after: refreshed.status,
      emitted_events: this.resolveEmittedEventsForStatus(refreshed.status),
      audit_log_id: result.audit_log_id,
      transaction: refreshed,
    };
  }

  async handleStatusTransition(
    id: string,
    dto: UpdateSwapTransactionStatusDto,
    operatorId: string,
  ): Promise<SwapOrchestratorOutput> {
    const result = await this.swapTransactionWorkflowService.execute(undefined, {
      swapId: id,
      source: 'ADMIN',
      sourceId: operatorId,
      workflowAction: this.mapAdminAction(dto.action),
      reason: dto.reason || null,
      actor: {
        actorType: 'ADMIN',
        actorId: operatorId,
        actorRole: 'ADMIN',
        sourcePlatform: 'ADMIN_API',
      },
      triggerStage: 'REVIEW_SWAP_FINAL',
    });

    const transaction = await this.swapService.findOne(id);
    return {
      swap_status_after: result.swapStatusAfter as SwapTransactionStatus,
      emitted_events: this.resolveEmittedEventsForStatus(result.swapStatusAfter),
      audit_log_id: `${result.transitionCode}:${id}`,
      transaction,
    };
  }
}
