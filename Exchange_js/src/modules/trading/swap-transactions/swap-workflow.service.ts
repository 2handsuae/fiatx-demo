import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
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
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { bigintToHex } from '../../accounting/tigerbeetle/utils/tb-id.util';
import { SwapTransactionsService } from './swap-transactions.service';

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
  ) {}

  private decimalToBigint(decimalValue: Prisma.Decimal | string | number, decimals: number): bigint {
    const str = String(decimalValue);
    const [whole, frac = ''] = str.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }

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
    let swapNoForEvent: string | null;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const quote = await this.swapQuoteService.getActiveQuoteOrThrow(quoteId, 'CUSTOMER', ownerId, now, tx);
        // Inherit the quote's UUID so every audit event for one business unit
        // (quote.created + quote.used + swap.created + swap.succeeded) and
        // every TB evidence record share a single traceId. Same direction as
        // deposit←payin (TR-T4). Replaces the legacy SWAP:<swapNo> literal.
        // Legacy quotes from before SW-T1 have a null traceId — fall back to a
        // freshly minted UUID so downstream invariants (non-null traceId on
        // swap row + audit + TB evidence) still hold.
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

        const fromAmountBigint = this.decimalToBigint(fromAmount, fromDecimals);
        const feeAmountBigint = this.decimalToBigint(feeAmount, toDecimals);
        // grossTo = the to-ccy amount the customer receives BEFORE fee (= net + fee).
        const grossToAmountBigint = this.decimalToBigint(toAmount, toDecimals);

        // Spread margin = market value of the in-leg minus the quoted gross out.
        // Kept as a reporting field on the swap row only; in the real-time 1:1
        // model there is NO spread leg — the platform's rate markup stays implicit
        // in FIRM_OPS (the firm pays out grossTo from FIRM_OPS but only sourced
        // fromAmount-worth of the opposite leg into it).
        const marketRate = new Prisma.Decimal(quote.marketRate);
        const marketValueOut = fromAmount
          .mul(marketRate)
          .toDecimalPlaces(toDecimals, Prisma.Decimal.ROUND_HALF_UP);
        const spreadAmount = marketValueOut.sub(toAmount);

        // Post the real-time multi-leg physical transfers (SELL → BUY → FEE).
        // CASE A (USDT→AED) and CASE B (AED→USDT) are selected by currency type.
        const legIds = await this.postSwapLegs({
          tx, traceId, swapNo, ownerId,
          fromIsFiat: fromAsset?.type === 'FIAT',
          fromCurrency, toCurrency, fromLedger, toLedger,
          fromAmountBigint, grossToAmountBigint, feeAmountBigint,
        });

        const swap = await this.swapTransactionsService.create({
          swapNo, quoteId: quote.id, quoteNo: quote.quoteNo,
          ownerType: 'CUSTOMER', ownerId, ownerNo: quote.ownerNo,
          fromAssetId: quote.fromAssetId, fromAssetCode: quote.fromAssetCode, fromAmount,
          toAssetId: quote.toAssetId, toAssetCode: quote.toAssetCode, toAmount,
          netToAmount, feeAmount, feeCurrency: quote.feeCurrency || quote.toAssetCode,
          feeBreakdown: quote.feeBreakdown, spreadAmount, exchangeRate: rate,
          tbFromTransferId: legIds.sellClientHex,
          tbToTransferId: legIds.buyClientHex,
          tbFeeTransferId: legIds.feeClientHex,
          tbSpreadTransferId: null, // no spread leg in the real-time 1:1 model
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

        // Terminal success audit. Paired with SWAP_FAILED in the catch below so
        // every executeSwap call ends with exactly one terminal event sharing
        // the inherited quote.traceId.
        await this.auditLogsService.recordSystem(
          {
            action: AuditActions.SWAP_SUCCEEDED,
            entityType: AuditEntityTypes.SWAP_TRANSACTION,
            entityId: swap.id,
            entityNo: swap.swapNo || undefined,
            traceId,
            workflowType: AuditWorkflowTypes.SWAP,
            entityOwnerType: swap.ownerType,
            entityOwnerId: swap.ownerId,
            entityOwnerNo: swap.ownerNo || undefined,
            reason: 'Swap completed (atomic SUCCESS)',
            sourcePlatform: 'SYSTEM',
          },
          tx,
        );

        return swap;
      });

      swapId = result.id;
      swapNoForEvent = result.swapNo;
    } catch (error) {
      // Real-time 1:1 model: all swap legs are direct (non-pending) transfers
      // posted inside the Prisma $transaction, so a failure rolls back the swap
      // row + audit + evidence atomically. The deterministic-id TB transfers are
      // idempotent on retry; there are no pending transfers to void.
      // Best-effort terminal audit — swap row may or may not exist depending
      // on the failure stage. We carry the quote.traceId (captured at the top
      // of the transaction) and the pre-allocated swapNo so operators can
      // correlate with TB evidence even when the Prisma row is gone.
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

    // Post-commit: the swap row + its TB transfers are durably committed. Emit
    // the settlement trigger and load the response OUTSIDE the try/catch so a
    // listener error or a read failure can never run the void-pending rollback
    // on already-posted transfers.
    this.eventEmitter.emit(DomainEventNames.SWAP_SUCCEEDED, {
      swapId,
      swapNo: swapNoForEvent,
      ownerId,
    });

    return this.swapTransactionsService.findOne(swapId);
  }

  /**
   * Post the real-time multi-leg physical transfers for one swap.
   *
   * Two currencies only: AED (FIAT) + USDT (CRYPTO), so every swap is exactly
   * one fiat leg + one crypto leg. Legs are posted SELL → BUY → FEE (先转出再转入).
   * No clearing bridge, no Outstanding, no spread leg — the rate markup stays
   * implicit in FIRM_OPS.
   *
   * Routing rule: a leg touching a customer fiat vIBAN ↔ FIRM_OPS must pass
   * through FIRM_SET; crypto is direct; the firm's liquidity is always FIRM_OPS.
   *
   *   CASE A (USDT→AED, fromIsFiat=false): SELL crypto direct to FIRM_OPS;
   *     BUY fiat via FIRM_OPS→FIRM_SET→FIRM_ASSET→client.
   *   CASE B (AED→USDT, fromIsFiat=true):  SELL fiat via FIRM_ASSET→FIRM_SET→FIRM_OPS;
   *     BUY crypto direct FIRM_OPS→FIRM_ASSET→client.
   *
   * Returns the headline transfer ids (client sell / client buy / client fee)
   * that the swap row stores; every leg is durably captured in TB evidence
   * (sourceNo = swapNo) regardless.
   */
  private async postSwapLegs(params: {
    tx: Prisma.TransactionClient;
    traceId: string;
    swapNo: string;
    ownerId: string;
    fromIsFiat: boolean;
    fromCurrency: string;
    toCurrency: string;
    fromLedger: number;
    toLedger: number;
    fromAmountBigint: bigint;
    grossToAmountBigint: bigint;
    feeAmountBigint: bigint;
  }): Promise<{ sellClientHex: string; buyClientHex: string; feeClientHex: string | null }> {
    const {
      tx, traceId, swapNo, ownerId, fromIsFiat,
      fromCurrency, toCurrency, fromLedger, toLedger,
      fromAmountBigint, grossToAmountBigint, feeAmountBigint,
    } = params;
    const C = TB_ACCOUNT_CODES;

    // Resolve every account once (one of each per ledger / owner).
    const clientPayableFrom = await this.accountingService.resolveTbAccountId({ code: C.CLIENT_PAYABLE, ledger: fromLedger, ownerType: 'CUSTOMER', ownerUuid: ownerId });
    const clientAssetFrom = await this.accountingService.resolveTbAccountId({ code: C.CLIENT_ASSET, ledger: fromLedger, ownerType: 'SYSTEM' });
    const firmAssetFrom = await this.accountingService.resolveTbAccountId({ code: C.FIRM_ASSET, ledger: fromLedger, ownerType: 'SYSTEM' });
    const firmOpsFrom = await this.accountingService.resolveTbAccountId({ code: C.FIRM_OPS, ledger: fromLedger, ownerType: 'SYSTEM' });

    const clientPayableTo = await this.accountingService.resolveTbAccountId({ code: C.CLIENT_PAYABLE, ledger: toLedger, ownerType: 'CUSTOMER', ownerUuid: ownerId });
    const clientAssetTo = await this.accountingService.resolveTbAccountId({ code: C.CLIENT_ASSET, ledger: toLedger, ownerType: 'SYSTEM' });
    const firmAssetTo = await this.accountingService.resolveTbAccountId({ code: C.FIRM_ASSET, ledger: toLedger, ownerType: 'SYSTEM' });
    const firmOpsTo = await this.accountingService.resolveTbAccountId({ code: C.FIRM_OPS, ledger: toLedger, ownerType: 'SYSTEM' });

    // ── SELL legs (from-ledger) ──
    // leg1: client gives up the from-asset (PAYABLE → ASSET, from-ledger).
    const sellClient = await this.accountingService.executeTransfer({
      debitAccountId: clientPayableFrom, creditAccountId: clientAssetFrom, amount: fromAmountBigint,
      ledger: fromLedger, code: TB_TRANSFER_CODES.SWAP_SELL_CLIENT,
      evidence: this.evidence(swapNo, 'SWAP_SELL_CLIENT', C.CLIENT_PAYABLE, C.CLIENT_ASSET, fromCurrency, traceId, ownerId, 'Swap sell: client gives up from-asset'),
      tx,
    });

    if (fromIsFiat) {
      // CASE B sell: fiat in → FIRM_ASSET, route FIRM_ASSET→FIRM_SET then FIRM_SET→FIRM_OPS.
      const firmSetFrom = await this.accountingService.resolveTbAccountId({ code: C.FIRM_SET, ledger: fromLedger, ownerType: 'SYSTEM' });
      await this.accountingService.executeTransfer({
        debitAccountId: firmAssetFrom, creditAccountId: firmSetFrom, amount: fromAmountBigint,
        ledger: fromLedger, code: TB_TRANSFER_CODES.SWAP_SELL_FIRM,
        evidence: this.evidence(swapNo, 'SWAP_SELL_FIRM', C.FIRM_ASSET, C.FIRM_SET, fromCurrency, traceId, ownerId, 'Swap sell: firm receives fiat into settlement'),
        tx,
      });
      await this.accountingService.executeTransfer({
        debitAccountId: firmSetFrom, creditAccountId: firmOpsFrom, amount: fromAmountBigint,
        ledger: fromLedger, code: TB_TRANSFER_CODES.SWAP_SELL_SET_TO_OPS,
        evidence: this.evidence(swapNo, 'SWAP_SELL_SET_TO_OPS', C.FIRM_SET, C.FIRM_OPS, fromCurrency, traceId, ownerId, 'Swap sell: firm settlement → ops liquidity'),
        tx,
      });
    } else {
      // CASE A sell: crypto in → FIRM_ASSET, direct to FIRM_OPS liquidity.
      await this.accountingService.executeTransfer({
        debitAccountId: firmAssetFrom, creditAccountId: firmOpsFrom, amount: fromAmountBigint,
        ledger: fromLedger, code: TB_TRANSFER_CODES.SWAP_SELL_FIRM,
        evidence: this.evidence(swapNo, 'SWAP_SELL_FIRM', C.FIRM_ASSET, C.FIRM_OPS, fromCurrency, traceId, ownerId, 'Swap sell: firm receives crypto into ops liquidity'),
        tx,
      });
    }

    // ── BUY legs (to-ledger, gross) ──
    // toIsFiat is the complement of fromIsFiat (exactly one fiat + one crypto leg).
    const toIsFiat = !fromIsFiat;
    if (toIsFiat) {
      // CASE A buy: fiat out → FIRM_OPS→FIRM_SET→FIRM_ASSET, then client credit.
      const firmSetTo = await this.accountingService.resolveTbAccountId({ code: C.FIRM_SET, ledger: toLedger, ownerType: 'SYSTEM' });
      await this.accountingService.executeTransfer({
        debitAccountId: firmOpsTo, creditAccountId: firmSetTo, amount: grossToAmountBigint,
        ledger: toLedger, code: TB_TRANSFER_CODES.SWAP_BUY_OPS_TO_SET,
        evidence: this.evidence(swapNo, 'SWAP_BUY_OPS_TO_SET', C.FIRM_OPS, C.FIRM_SET, toCurrency, traceId, ownerId, 'Swap buy: firm ops → settlement (fiat)'),
        tx,
      });
      await this.accountingService.executeTransfer({
        debitAccountId: firmSetTo, creditAccountId: firmAssetTo, amount: grossToAmountBigint,
        ledger: toLedger, code: TB_TRANSFER_CODES.SWAP_BUY_SET_TO_ASSET,
        evidence: this.evidence(swapNo, 'SWAP_BUY_SET_TO_ASSET', C.FIRM_SET, C.FIRM_ASSET, toCurrency, traceId, ownerId, 'Swap buy: firm settlement → asset (fiat)'),
        tx,
      });
    } else {
      // CASE B buy: crypto out → FIRM_OPS→FIRM_ASSET (no SET hop), then client credit.
      await this.accountingService.executeTransfer({
        debitAccountId: firmOpsTo, creditAccountId: firmAssetTo, amount: grossToAmountBigint,
        ledger: toLedger, code: TB_TRANSFER_CODES.SWAP_BUY_SET_TO_ASSET,
        evidence: this.evidence(swapNo, 'SWAP_BUY_SET_TO_ASSET', C.FIRM_OPS, C.FIRM_ASSET, toCurrency, traceId, ownerId, 'Swap buy: firm ops → asset (crypto)'),
        tx,
      });
    }
    const buyClient = await this.accountingService.executeTransfer({
      debitAccountId: clientAssetTo, creditAccountId: clientPayableTo, amount: grossToAmountBigint,
      ledger: toLedger, code: TB_TRANSFER_CODES.SWAP_BUY_CLIENT,
      evidence: this.evidence(swapNo, 'SWAP_BUY_CLIENT', C.CLIENT_ASSET, C.CLIENT_PAYABLE, toCurrency, traceId, ownerId, 'Swap buy: client receives to-asset (gross)'),
      tx,
    });

    // ── FEE legs (to-ledger, direct) ──
    let feeClientHex: string | null = null;
    if (feeAmountBigint > 0n) {
      const feeClient = await this.accountingService.executeTransfer({
        debitAccountId: clientPayableTo, creditAccountId: clientAssetTo, amount: feeAmountBigint,
        ledger: toLedger, code: TB_TRANSFER_CODES.SWAP_FEE_CLIENT,
        evidence: this.evidence(swapNo, 'SWAP_FEE_CLIENT', C.CLIENT_PAYABLE, C.CLIENT_ASSET, toCurrency, traceId, ownerId, 'Swap fee: deducted from client to-asset'),
        tx,
      });
      await this.accountingService.executeTransfer({
        debitAccountId: firmAssetTo, creditAccountId: await this.accountingService.resolveTbAccountId({ code: C.FIRM_FEE, ledger: toLedger, ownerType: 'SYSTEM' }), amount: feeAmountBigint,
        ledger: toLedger, code: TB_TRANSFER_CODES.SWAP_FEE_FIRM,
        evidence: this.evidence(swapNo, 'SWAP_FEE_FIRM', C.FIRM_ASSET, C.FIRM_FEE, toCurrency, traceId, ownerId, 'Swap fee: firm-side fee income'),
        tx,
      });
      feeClientHex = bigintToHex(feeClient.tbTransferId);
    }

    return {
      sellClientHex: bigintToHex(sellClient.tbTransferId),
      buyClientHex: bigintToHex(buyClient.tbTransferId),
      feeClientHex,
    };
  }

  private parseTotals(value: string | null | undefined): Record<string, string> {
    if (!value) return {};
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private evidence(
    swapNo: string, eventCode: string, debitCode: number, creditCode: number,
    assetCurrency: string, traceId: string, ownerId: string, memo: string,
  ) {
    return {
      sourceType: 'SWAP', sourceNo: swapNo, eventCode,
      debitCode: TB_CODE_TO_COA[debitCode], creditCode: TB_CODE_TO_COA[creditCode],
      assetCurrency, traceId, actorType: 'CUSTOMER', actorId: ownerId, memo,
    };
  }
}
