import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ensureCustomerCanTransact } from '../shared/customer-transaction-guard';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { OnboardingService } from '../../identity/onboarding/onboarding.service';
import { SwapQuoteService } from '../swap-fee-level/swap-quote.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapSettlementService } from './swap-settlement.service';

@Injectable()
export class SwapWorkflowService {
  private readonly logger = new Logger(SwapWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingService: OnboardingService,
    private readonly swapQuoteService: SwapQuoteService,
    private readonly swapTransactionsService: SwapTransactionsService,
    private readonly accountingService: AccountingService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly swapSettlement: SwapSettlementService,
  ) {}

  private resolveLedger(currency: string): number {
    const ledger = (TB_LEDGERS as Record<string, number>)[currency];
    if (!ledger) {
      throw new BadRequestException(`Unsupported asset currency for TB accounting: ${currency}`);
    }
    return ledger;
  }

  async executeSwap(ownerId: string, quoteId: string) {
    // ── L1 Eligibility gate (synchronous) ──
    const customer = await this.prisma.customerMain.findUnique({ where: { id: ownerId } });
    ensureCustomerCanTransact(customer);
    await this.onboardingService.assertTradingEligibility(ownerId, 'SWAP');

    const now = new Date();
    const swapNo = generateReferenceNo('SWP');

    // Lifted to outer scope so the catch block can emit SWAP_FAILED with the
    // inherited traceId. Assigned at the top of the transaction once we read
    // the quote. If the failure happens before assignment (e.g. quote lookup
    // itself throws), traceId stays null and the SWAP_FAILED audit will carry
    // null — still useful for swapNo-based correlation.
    let traceId: string | null = null;
    let swapId: string;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const quote = await this.swapQuoteService.getActiveQuoteOrThrow(quoteId, 'CUSTOMER', ownerId, now, tx);
        // Inherit the quote's UUID so every audit event for one business unit
        // (quote.created + quote.used + swap.created + swap.succeeded) share a
        // single traceId. Legacy quotes with null traceId fall back to a fresh UUID.
        traceId = quote.traceId ?? randomUUID();
        const fromAmount = new Prisma.Decimal(quote.amountIn);
        const toAmount = new Prisma.Decimal(quote.amountOut);
        const totals = this.parseTotals(quote.totalsJson);
        const netToAmount = new Prisma.Decimal(totals.amountOutNet || quote.amountOut.toString());
        const feeAmount = new Prisma.Decimal(quote.feeTotal || 0);
        const rate = new Prisma.Decimal(quote.rateAllIn);

        await this.swapQuoteService.consumeQuote(quoteId, 'CUSTOMER', ownerId, fromAmount, tx);

        const [fromAsset, toAsset] = await Promise.all([
          tx.asset.findUnique({ where: { id: quote.fromAssetId }, select: { decimals: true, currency: true, type: true } }),
          tx.asset.findUnique({ where: { id: quote.toAssetId }, select: { decimals: true, currency: true, type: true } }),
        ]);
        const fromCurrency = fromAsset?.currency || quote.fromAssetCode || '';
        const toCurrency = toAsset?.currency || quote.toAssetCode || '';
        const fromDecimals = fromAsset?.decimals ?? 8;
        const toDecimals = toAsset?.decimals ?? 8;
        const fromLedger = this.resolveLedger(fromCurrency);
        const toLedger = this.resolveLedger(toCurrency);

        // Spread margin = market value of the in-leg minus the quoted gross out.
        // Kept as a reporting field on the swap row only.
        const marketRate = new Prisma.Decimal(quote.marketRate);
        const marketValueOut = fromAmount
          .mul(marketRate)
          .toDecimalPlaces(toDecimals, Prisma.Decimal.ROUND_HALF_UP);
        const spreadAmount = marketValueOut.sub(toAmount);

        // Create the swap row in PROCESSING status — legs will be posted by SwapSettlementService.
        const swap = await this.swapTransactionsService.create({
          swapNo, quoteId: quote.id, quoteNo: quote.quoteNo,
          ownerType: 'CUSTOMER', ownerId, ownerNo: quote.ownerNo,
          fromAssetId: quote.fromAssetId, fromAssetCode: quote.fromAssetCode, fromAmount,
          toAssetId: quote.toAssetId, toAssetCode: quote.toAssetCode, toAmount,
          netToAmount, feeAmount, feeCurrency: quote.feeCurrency || quote.toAssetCode,
          feeBreakdown: quote.feeBreakdown, spreadAmount, exchangeRate: rate,
          tbFromTransferId: null,
          tbToTransferId: null,
          tbFeeTransferId: null,
          tbSpreadTransferId: null,
          traceId,
        }, tx);

        await this.auditLogsService.recordByActor(
          {
            action: AuditActions.SWAP_CREATED,
            entityType: AuditEntityTypes.SWAP_TRANSACTION,
            entityId: swap.id,
            entityNo: swap.swapNo || undefined,
            traceId,
            workflowType: AuditWorkflowTypes.SWAP,
            entityOwnerType: swap.ownerType,
            entityOwnerId: swap.ownerId,
            entityOwnerNo: swap.ownerNo || undefined,
            reason: `Swap executed from quote ${quote.quoteNo || quote.id}`,
            metadata: { quoteId: quote.id, quoteNo: quote.quoteNo },
            sourcePlatform: 'CUSTOMER_API',
          },
          { actorType: 'CUSTOMER', actorId: ownerId, actorNo: quote.ownerNo || undefined, actorRole: 'CUSTOMER' },
          tx,
        );

        // Delegate physical leg creation + leg1 pending to SwapSettlementService,
        // atomically within the same transaction so legs are created with the swap row.
        await this.swapSettlement.start(
          {
            swapId: swap.id,
            swapNo,
            ownerId,
            fromIsFiat: fromAsset?.type === 'FIAT',
            fromAssetId: quote.fromAssetId,
            toAssetId: quote.toAssetId,
            fromLedger,
            toLedger,
            fromCurrency,
            toCurrency,
            fromAmount,
            grossToAmount: toAmount,
            feeAmount,
            fromDecimals,
            toDecimals,
          },
          tx,
        );

        return swap;
      });

      swapId = result.id;
    } catch (error) {
      // Best-effort terminal audit — swap row may or may not exist depending
      // on the failure stage. We carry the quote.traceId (captured at the top
      // of the transaction) and the pre-allocated swapNo for operator correlation.
      await this.auditLogsService
        .recordSystem({
          action: AuditActions.SWAP_FAILED,
          entityType: AuditEntityTypes.SWAP_TRANSACTION,
          entityId: undefined,
          entityNo: swapNo,
          entityOwnerType: 'CUSTOMER',
          entityOwnerId: ownerId,
          workflowType: AuditWorkflowTypes.SWAP,
          reason: error instanceof Error ? error.message : 'Swap execution failed',
          sourcePlatform: 'SYSTEM',
          traceId: traceId ?? undefined,
        })
        .catch(() => undefined);
      throw error;
    }

    // Swap is now PROCESSING (not yet succeeded). Return the persisted row.
    return this.swapTransactionsService.findOne(swapId);
  }

  private parseTotals(value: string | null | undefined): Record<string, string> {
    if (!value) return {};
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return {};
    }
  }
}
