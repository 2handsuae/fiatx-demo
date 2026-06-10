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
import { OutstandingsService } from '../../clearing-settle/outstandings/outstandings.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { bigintToHex } from '../../accounting/tigerbeetle/utils/tb-id.util';
import { SwapTransactionsService } from './swap-transactions.service';

interface PendingRef {
  id: bigint;
  amount: bigint;
}

@Injectable()
export class SwapWorkflowService {
  private readonly logger = new Logger(SwapWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingService: OnboardingService,
    private readonly swapQuoteService: SwapQuoteService,
    private readonly swapTransactionsService: SwapTransactionsService,
    private readonly outstandingsService: OutstandingsService,
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
    const traceId = `SWAP:${swapNo}`;

    const created: PendingRef[] = [];

    let swapId: string;
    let swapNoForEvent: string | null;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const quote = await this.swapQuoteService.getActiveQuoteOrThrow(quoteId, 'CUSTOMER', ownerId, now, tx);
        const fromAmount = new Prisma.Decimal(quote.amountIn);
        const toAmount = new Prisma.Decimal(quote.amountOut);
        const totals = this.parseTotals(quote.totalsJson);
        const netToAmount = new Prisma.Decimal(totals.amountOutNet || quote.amountOut.toString());
        const feeAmount = new Prisma.Decimal(quote.feeTotal || 0);
        const rate = new Prisma.Decimal(quote.rateAllIn);

        await this.swapQuoteService.consumeQuote(quoteId, 'CUSTOMER', ownerId, fromAmount, tx);

        const [fromAsset, toAsset] = await Promise.all([
          tx.asset.findUnique({ where: { id: quote.fromAssetId }, select: { decimals: true, currency: true } }),
          tx.asset.findUnique({ where: { id: quote.toAssetId }, select: { decimals: true, currency: true } }),
        ]);
        const fromCurrency = fromAsset?.currency || quote.fromAssetCode || '';
        const toCurrency = toAsset?.currency || quote.toAssetCode || '';
        const fromDecimals = fromAsset?.decimals ?? 8;
        const toDecimals = toAsset?.decimals ?? 8;
        const fromLedger = this.resolveLedger(fromCurrency);
        const toLedger = this.resolveLedger(toCurrency);

        const fromAmountBigint = this.decimalToBigint(fromAmount, fromDecimals);
        const feeAmountBigint = this.decimalToBigint(feeAmount, toDecimals);

        // Spread margin = market value of the in-leg minus the quoted gross out.
        // This is platform revenue (rate markup) and is booked directly to
        // SPREAD_INCOME at trade time (T1 recognition). Without this entry the
        // spread would remain as an FX imbalance stranded in TRADE_CLEARING —
        // on spread-only fee levels (feeTotal = 0) the platform's entire margin
        // would never be recognized.
        const marketRate = new Prisma.Decimal(quote.marketRate);
        const marketValueOut = fromAmount
          .mul(marketRate)
          .toDecimalPlaces(toDecimals, Prisma.Decimal.ROUND_HALF_UP);
        const spreadAmount = marketValueOut.sub(toAmount);
        const spreadAmountBigint = spreadAmount.gt(0)
          ? this.decimalToBigint(spreadAmount, toDecimals)
          : 0n;
        // Customer is credited the GROSS out (net + fee); the fee is then debited
        // from CLIENT_CREDIT so the ledger shows the deduction on the customer's
        // own account. (Fee leg is created AFTER the gross credit is posted —
        // CLIENT_CREDIT enforces debits_must_not_exceed_credits, and a pending
        // credit does not count toward available balance.)
        const grossToAmountBigint = this.decimalToBigint(toAmount, toDecimals);

        const clientCreditFrom = await this.accountingService.resolveTbAccountId({
          code: TB_ACCOUNT_CODES.CLIENT_CREDIT, ledger: fromLedger, ownerType: 'CUSTOMER', ownerUuid: ownerId,
        });
        const clearingFrom = await this.accountingService.resolveTbAccountId({
          code: TB_ACCOUNT_CODES.TRADE_CLEARING, ledger: fromLedger, ownerType: 'SYSTEM',
        });
        const clearingTo = await this.accountingService.resolveTbAccountId({
          code: TB_ACCOUNT_CODES.TRADE_CLEARING, ledger: toLedger, ownerType: 'SYSTEM',
        });
        const clientCreditTo = await this.accountingService.resolveTbAccountId({
          code: TB_ACCOUNT_CODES.CLIENT_CREDIT, ledger: toLedger, ownerType: 'CUSTOMER', ownerUuid: ownerId,
        });

        const fromPending = await this.accountingService.executePendingTransfer({
          debitAccountId: clientCreditFrom, creditAccountId: clearingFrom, amount: fromAmountBigint,
          ledger: fromLedger, code: TB_TRANSFER_CODES.SWAP_CREDIT_TO_CLEARING_PENDING, timeout: 0,
          evidence: this.evidence(swapNo, 'SWAP_LOCK_FROM', TB_ACCOUNT_CODES.CLIENT_CREDIT, TB_ACCOUNT_CODES.TRADE_CLEARING, fromCurrency, traceId, ownerId, 'Swap pending lock: from-leg'),
          tx,
        });
        created.push({ id: fromPending.tbTransferId, amount: fromAmountBigint });

        const toPending = await this.accountingService.executePendingTransfer({
          debitAccountId: clearingTo, creditAccountId: clientCreditTo, amount: grossToAmountBigint,
          ledger: toLedger, code: TB_TRANSFER_CODES.SWAP_CLEARING_TO_CREDIT, timeout: 0,
          evidence: this.evidence(swapNo, 'SWAP_CREDIT_TO', TB_ACCOUNT_CODES.TRADE_CLEARING, TB_ACCOUNT_CODES.CLIENT_CREDIT, toCurrency, traceId, ownerId, 'Swap pending: to-leg credit (gross)'),
          tx,
        });
        created.push({ id: toPending.tbTransferId, amount: grossToAmountBigint });

        let spreadTransferIdHex: string | null = null;
        let spreadPendingId: bigint | null = null;
        if (spreadAmountBigint > 0n) {
          const spreadIncome = await this.accountingService.resolveTbAccountId({
            code: TB_ACCOUNT_CODES.SPREAD_INCOME, ledger: toLedger, ownerType: 'SYSTEM',
          });
          const spreadPending = await this.accountingService.executePendingTransfer({
            debitAccountId: clearingTo, creditAccountId: spreadIncome, amount: spreadAmountBigint,
            ledger: toLedger, code: TB_TRANSFER_CODES.SWAP_CLEARING_TO_SPREAD, timeout: 0,
            evidence: this.evidence(swapNo, 'SWAP_SPREAD', TB_ACCOUNT_CODES.TRADE_CLEARING, TB_ACCOUNT_CODES.SPREAD_INCOME, toCurrency, traceId, ownerId, 'Swap pending: spread income (T1 recognition)'),
            tx,
          });
          created.push({ id: spreadPending.tbTransferId, amount: spreadAmountBigint });
          spreadTransferIdHex = bigintToHex(spreadPending.tbTransferId);
          spreadPendingId = spreadPending.tbTransferId;
        }

        const swap = await this.swapTransactionsService.create({
          swapNo, quoteId: quote.id, quoteNo: quote.quoteNo,
          ownerType: 'CUSTOMER', ownerId, ownerNo: quote.ownerNo,
          fromAssetId: quote.fromAssetId, fromAssetCode: quote.fromAssetCode, fromAmount,
          toAssetId: quote.toAssetId, toAssetCode: quote.toAssetCode, toAmount,
          netToAmount, feeAmount, feeCurrency: quote.feeCurrency || quote.toAssetCode,
          feeBreakdown: quote.feeBreakdown, spreadAmount, exchangeRate: rate,
          tbFromTransferId: bigintToHex(fromPending.tbTransferId),
          tbToTransferId: bigintToHex(toPending.tbTransferId),
          tbFeeTransferId: null, // set after the gross credit is posted (see below)
          tbSpreadTransferId: spreadTransferIdHex,
          traceId,
        }, tx);

        await this.outstandingsService.createForSwapSuccess(tx, {
          id: swap.id, swapNo: swap.swapNo, ownerType: swap.ownerType, ownerId: swap.ownerId, ownerNo: swap.ownerNo,
          status: 'SUCCESS', fromAssetId: swap.fromAssetId, fromAssetCurrency: swap.fromAssetCode, fromAmount,
          toAssetId: swap.toAssetId, toAssetCurrency: swap.toAssetCode, toAmount, netToAmount,
        });

        await this.accountingService.postPendingTransfer({
          pendingTransferId: fromPending.tbTransferId, amount: fromAmountBigint,
          evidence: this.evidence(swapNo, 'SWAP_POST_FROM', TB_ACCOUNT_CODES.CLIENT_CREDIT, TB_ACCOUNT_CODES.TRADE_CLEARING, fromCurrency, traceId, ownerId, 'Swap post: from-leg'),
          tx,
        });
        await this.accountingService.postPendingTransfer({
          pendingTransferId: toPending.tbTransferId, amount: grossToAmountBigint,
          evidence: this.evidence(swapNo, 'SWAP_POST_TO', TB_ACCOUNT_CODES.TRADE_CLEARING, TB_ACCOUNT_CODES.CLIENT_CREDIT, toCurrency, traceId, ownerId, 'Swap post: to-leg (gross)'),
          tx,
        });
        if (spreadPendingId) {
          await this.accountingService.postPendingTransfer({
            pendingTransferId: spreadPendingId, amount: spreadAmountBigint,
            evidence: this.evidence(swapNo, 'SWAP_POST_SPREAD', TB_ACCOUNT_CODES.TRADE_CLEARING, TB_ACCOUNT_CODES.SPREAD_INCOME, toCurrency, traceId, ownerId, 'Swap post: spread income'),
            tx,
          });
        }

        // Fee: debit the customer's CLIENT_CREDIT (now holding the posted gross)
        // into FEE_INCOME. Posted directly because the debit is only valid
        // once the gross credit above is posted.
        if (feeAmountBigint > 0n) {
          const feeIncome = await this.accountingService.resolveTbAccountId({
            code: TB_ACCOUNT_CODES.FEE_INCOME, ledger: toLedger, ownerType: 'SYSTEM',
          });
          const feeTransfer = await this.accountingService.executeTransfer({
            debitAccountId: clientCreditTo, creditAccountId: feeIncome, amount: feeAmountBigint,
            ledger: toLedger, code: TB_TRANSFER_CODES.SWAP_CREDIT_TO_FEE,
            evidence: this.evidence(swapNo, 'SWAP_FEE', TB_ACCOUNT_CODES.CLIENT_CREDIT, TB_ACCOUNT_CODES.FEE_INCOME, toCurrency, traceId, ownerId, 'Swap: fee income debited from client credit (T1 recognition)'),
            tx,
          });
          await tx.swapTransaction.update({
            where: { id: swap.id },
            data: { tbFeeTransferId: bigintToHex(feeTransfer.tbTransferId) },
          });
        }

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

        return swap;
      });

      swapId = result.id;
      swapNoForEvent = result.swapNo;
    } catch (error) {
      for (const ref of created) {
        await this.accountingService.voidPendingTransferBestEffort(ref.id, ref.amount);
      }
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
      debitCode: String(debitCode), creditCode: String(creditCode),
      assetCurrency, traceId, actorType: 'CUSTOMER', actorId: ownerId, memo,
    };
  }
}
