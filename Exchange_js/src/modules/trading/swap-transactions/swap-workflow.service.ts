import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import { SwapLegAccounting, SwapSettleCtx } from './swap-leg-accounting';
import { FundsFlowService } from '../../funds-layer/domain/funds-flow.service';
import {
  buildSwapLegPlan,
  SwapLegSpec,
} from '../../funds-layer/constants/swap-leg-plan.constant';
import { InternalFundAction, InternalFundStatus } from '../../funds-layer/dto/internal-fund.dto';
import { DomainEventNames } from '../../../common/events/domain-events.constants';

/**
 * Thrown when a swap leg's (fromWalletId, toWalletId) pair fails R1 invariants:
 *   - Customer-side leg requires the customer wallet to resolve.
 *   - Firm-only leg requires both platform wallets to resolve.
 * Carries swapNo + legSeq + roles so operators can locate the seed/data gap.
 */
export class InvalidInternalFundError extends BadRequestException {
  constructor(message: string) {
    super({ code: 'INVALID_INTERNAL_FUND', message });
    this.name = 'InvalidInternalFundError';
  }
}

/**
 * R1 validation: enforce the InternalFund.fromWalletId / toWalletId contract
 * for a swap leg. Customer-side leg requires the customer-role wallet to
 * resolve; firm-only leg requires both firm wallets to resolve. Throws
 * InvalidInternalFundError on miss so we never persist a {from:NULL, to:NULL}
 * SWAP InternalFund row.
 */
export function assertInternalFundLegRules(
  spec: { legSeq: number; fromRole: string; toRole: string },
  fromWalletId: string | null,
  toWalletId: string | null,
  swapNo: string,
): void {
  const isCustomerRole = (r: string) => r.startsWith('C_');
  const fromIsCustomer = isCustomerRole(spec.fromRole);
  const toIsCustomer = isCustomerRole(spec.toRole);
  const hasCustomerLeg = fromIsCustomer || toIsCustomer;

  if (hasCustomerLeg) {
    // Customer-side leg: the customer-role wallet must resolve.
    const customerSideResolved = fromIsCustomer ? !!fromWalletId : !!toWalletId;
    if (!customerSideResolved) {
      throw new InvalidInternalFundError(
        `swap ${swapNo} leg ${spec.legSeq}: customer wallet for role ` +
          `${fromIsCustomer ? spec.fromRole : spec.toRole} did not resolve`,
      );
    }
    // The firm side should also resolve in practice — surface gaps now.
    const firmSideResolved = fromIsCustomer ? !!toWalletId : !!fromWalletId;
    if (!firmSideResolved) {
      throw new InvalidInternalFundError(
        `swap ${swapNo} leg ${spec.legSeq}: firm wallet for role ` +
          `${fromIsCustomer ? spec.toRole : spec.fromRole} did not resolve`,
      );
    }
    return;
  }

  // Firm-only leg: both sides must be firm wallets.
  if (!fromWalletId || !toWalletId) {
    throw new InvalidInternalFundError(
      `swap ${swapNo} leg ${spec.legSeq}: firm-only leg requires both ` +
        `${spec.fromRole} and ${spec.toRole} to resolve — got from=` +
        `${fromWalletId ?? 'NULL'} to=${toWalletId ?? 'NULL'}`,
    );
  }
}

@Injectable()
export class SwapWorkflowService {
  private readonly logger = new Logger(SwapWorkflowService.name);

  /** Swap-6 self-heal cap: at most N attempts per legSeq before STUCK. */
  private static readonly MAX_LEG_ATTEMPTS = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingService: OnboardingService,
    private readonly swapQuoteService: SwapQuoteService,
    private readonly swapTransactionsService: SwapTransactionsService,
    private readonly accountingService: AccountingService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly swapLegAccounting: SwapLegAccounting,
    private readonly fundsFlow: FundsFlowService,
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

        // Create the swap row in PROCESSING status; leg1 booked below, rest chained by advanceLeg.
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

        // Swap-9 cut-over: create ONLY leg1 + initiate its pending; subsequent
        // legs are chained by advanceLeg(legSeq+1) per the progressive build
        // model (Swap-5). One code path for all three leg-build sites — see
        // createAndStartLeg helper.
        const ctx: SwapSettleCtx = {
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
        };
        const legSpecs = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat });
        await this.createAndStartLeg(swap, legSpecs[0]!, ctx, 1, 1, 'SYSTEM', tx);

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

  // ── Swap-5: advanceLeg (new path, not yet wired by controller) ──

  /** stage label per legSeq (4-leg model: SELL, SETTLE, BUY, FEE). */
  private stageOf(legSeq: number): string {
    return legSeq === 1
      ? 'SELL'
      : legSeq === 2
      ? 'SETTLE'
      : legSeq === 3
      ? 'BUY'
      : legSeq === 4
      ? 'FEE'
      : 'UNKNOWN';
  }

  /** Primary amount for a leg's first accounting entry (mirrors helper logic). */
  private legPrimaryAmountDecimal(spec: SwapLegSpec, ctx: SwapSettleCtx): Prisma.Decimal {
    const ref = spec.accounting[0].amountRef;
    if (ref === 'from') return ctx.fromAmount;
    if (ref === 'grossTo') return ctx.grossToAmount;
    if (ref === 'fee') return ctx.feeAmount;
    throw new Error(`Unknown amountRef: ${ref}`);
  }

  /**
   * Starting action for a leg: FIAT side → SUBMIT, CRYPTO side → SIGN.
   * Matches the dispatch the existing settlement.start uses for leg1.
   */
  private legStartAction(spec: SwapLegSpec, ctx: SwapSettleCtx): InternalFundAction {
    const sideIsFiat =
      (spec.side === 'from' && ctx.fromIsFiat) || (spec.side === 'to' && !ctx.fromIsFiat);
    return sideIsFiat ? InternalFundAction.SUBMIT : InternalFundAction.SIGN;
  }

  /**
   * Unified create + start leg helper. Single code path for the four leg-build sites:
   *   - executeSwap leg1 build (legSeq=1, attempt=1, operator='SYSTEM')
   *   - onLegCleared chain-next  (legSeq=N+1, attempt=1, operator='SYSTEM')
   *   - onLegFailedSelfHeal retry (legSeq=N,  attempt=K+1, operator='SYSTEM')
   *   - resumeLeg manual recovery (legSeq=N,  attempt=K+1, operator=ops)
   * Atomic with the passed tx. Updates projections at the end (I2 — recompute
   * is part of the leg-mutation boundary). Returns the created leg row.
   */
  private async createAndStartLeg(
    swap: any,
    spec: SwapLegSpec,
    ctx: SwapSettleCtx,
    legSeq: number,
    attempt: number,
    operatorId: string,
    tx: any,
  ): Promise<any> {
    const assetIdForLeg = spec.side === 'from' ? ctx.fromAssetId : ctx.toAssetId;
    const amount = this.legPrimaryAmountDecimal(spec, ctx);
    // R1: resolve the leg's from/to wallets per role + assert invariants
    // before we persist the InternalFund row. Throws InvalidInternalFundError
    // if a customer/firm wallet for the leg's roles is missing.
    const { fromWalletId, toWalletId } = await this.swapLegAccounting.resolveLegWallets(spec, ctx);
    assertInternalFundLegRules(spec, fromWalletId, toWalletId, ctx.swapNo);
    const leg = await this.fundsFlow.createSwapLeg(
      {
        swapTransactionId: swap.id,
        legSeq,
        legAttempt: attempt,
        assetId: assetIdForLeg,
        amount,
        fromWalletId,
        toWalletId,
      },
      operatorId,
      tx,
    );
    const legCtx = { ...ctx, attempt };
    await this.swapLegAccounting.initiateLegPending(legCtx, spec, tx);
    await this.fundsFlow.transitionSwapLeg(
      (leg as any).id,
      this.legStartAction(spec, ctx),
      operatorId,
      tx,
    );
    await this.swapTransactionsService.recomputeProjections(
      swap.id,
      (n) => this.stageOf(n),
      tx,
    );
    return leg;
  }

  /**
   * Swap-6 self-heal: void this attempt's pending, then either retry (attempt+1)
   * or mark the leg NEEDS_REVIEW (after MAX_LEG_ATTEMPTS). Swap stays PROCESSING
   * — never markStatus FAILED. Mirrors `onLegCleared`'s shape; recomputes
   * projections at the end of the branch.
   */
  private async onLegFailedSelfHeal(
    swap: any,
    spec: SwapLegSpec,
    legSeq: number,
    ctx: SwapSettleCtx,
    target: any,
    nextStatus: InternalFundStatus,
    client: any,
  ): Promise<void> {
    const failedAttempt = target.attempt ?? 1;
    await this.swapLegAccounting.voidLeg(
      { ...ctx, attempt: failedAttempt },
      spec,
      client,
    );

    if (failedAttempt < SwapWorkflowService.MAX_LEG_ATTEMPTS) {
      const nextAttempt = failedAttempt + 1;
      // createAndStartLeg recomputes projections internally (I2).
      await this.createAndStartLeg(swap, spec, ctx, legSeq, nextAttempt, 'SYSTEM', client);
      await this.auditLogsService.recordSystem(
        {
          action: AuditActions.SWAP_LEG_RETRIED,
          entityType: AuditEntityTypes.SWAP_TRANSACTION,
          entityId: swap.id,
          entityNo: swap.swapNo,
          traceId: swap.traceId ?? swap.swapNo,
          workflowType: AuditWorkflowTypes.SWAP,
          entityOwnerType: swap.ownerType,
          entityOwnerId: swap.ownerId,
          reason: `Swap leg ${legSeq} failed (attempt ${failedAttempt}/${SwapWorkflowService.MAX_LEG_ATTEMPTS}); retry attempt ${nextAttempt} created`,
          metadata: { legSeq, failedAttempt, nextAttempt, failedStatus: nextStatus },
          sourcePlatform: 'SYSTEM',
        },
        client,
      );
    } else {
      // attempts == MAX_LEG_ATTEMPTS → STUCK: delegate to FundsFlowService so the
      // workflow stays out of the InternalFund table (CLAUDE.md rule 5).
      await this.fundsFlow.markLegNeedsReview(target.id, failedAttempt, 'SYSTEM', client);
      await this.auditLogsService.recordSystem(
        {
          action: AuditActions.SWAP_LEG_STUCK,
          entityType: AuditEntityTypes.SWAP_TRANSACTION,
          entityId: swap.id,
          entityNo: swap.swapNo,
          traceId: swap.traceId ?? swap.swapNo,
          workflowType: AuditWorkflowTypes.SWAP,
          entityOwnerType: swap.ownerType,
          entityOwnerId: swap.ownerId,
          reason: `Swap leg ${legSeq} stuck after ${failedAttempt} failed attempts; awaiting manual resume`,
          metadata: { legSeq, attempts: failedAttempt, lastFailedStatus: nextStatus },
          sourcePlatform: 'SYSTEM',
        },
        client,
      );
      // STUCK: no leg created, so recompute is not covered by the helper.
      await this.swapTransactionsService.recomputeProjections(
        swap.id,
        (n) => this.stageOf(n),
        client,
      );
    }
    // NOTE: do NOT markStatus FAILED — self-heal keeps swap in PROCESSING.
  }

  /**
   * Handle the CLEAR branch: post leg + audit, then either finalize SUCCESS or
   * chain the next leg. Returns whether (and what) to emit post-commit so the
   * caller fires SWAP_SUCCEEDED after the transaction commits.
   */
  private async onLegCleared(
    swap: any,
    spec: SwapLegSpec,
    legSeq: number,
    allSpecs: SwapLegSpec[],
    ctx: SwapSettleCtx,
    target: any,
    client: any,
  ): Promise<{ emit: boolean; payload?: { swapId: string; swapNo: string; ownerId: string } }> {
    // The TB pending id is derived per-(swap, leg, attempt). Use THIS attempt
    // so post/void hit the right transfer (matches initiateLegPending's id).
    await this.swapLegAccounting.postLeg(
      { ...ctx, attempt: target.attempt ?? 1 },
      spec,
      client,
    );
    await this.auditLogsService.recordSystem(
      {
        action: AuditActions.SWAP_LEG_POSTED,
        entityType: AuditEntityTypes.SWAP_TRANSACTION,
        entityId: swap.id,
        entityNo: swap.swapNo,
        traceId: swap.traceId ?? swap.swapNo,
        workflowType: AuditWorkflowTypes.SWAP,
        entityOwnerType: swap.ownerType,
        entityOwnerId: swap.ownerId,
        reason: `Swap leg ${legSeq} posted`,
        metadata: { legSeq, attempt: target.attempt ?? 1 },
        sourcePlatform: 'SYSTEM',
      },
      client,
    );

    const isLast = !allSpecs.some((s) => s.legSeq === legSeq + 1);
    let emitInfo: { emit: boolean; payload?: { swapId: string; swapNo: string; ownerId: string } } = {
      emit: false,
    };

    if (isLast) {
      await this.swapTransactionsService.markStatus(swap.id, 'SUCCESS', client);
      await this.auditLogsService.recordSystem(
        {
          action: AuditActions.SWAP_SUCCEEDED,
          entityType: AuditEntityTypes.SWAP_TRANSACTION,
          entityId: swap.id,
          entityNo: swap.swapNo,
          traceId: swap.traceId ?? swap.swapNo,
          workflowType: AuditWorkflowTypes.SWAP,
          entityOwnerType: swap.ownerType,
          entityOwnerId: swap.ownerId,
          reason: 'Swap settlement completed — all legs cleared',
          sourcePlatform: 'SYSTEM',
        },
        client,
      );
      emitInfo = {
        emit: true,
        payload: { swapId: swap.id, swapNo: swap.swapNo, ownerId: swap.ownerId },
      };
      // SUCCESS: no leg created, so recompute is not covered by the helper.
      await this.swapTransactionsService.recomputeProjections(
        swap.id,
        (n) => this.stageOf(n),
        client,
      );
    } else {
      // Progressively create the next leg. createAndStartLeg recomputes projections (I2).
      const nextSpec = allSpecs.find((s) => s.legSeq === legSeq + 1)!;
      await this.createAndStartLeg(swap, nextSpec, ctx, legSeq + 1, 1, 'SYSTEM', client);
    }

    return emitInfo;
  }

  /**
   * Advance a specific leg of a PROCESSING swap. Per-leg sequence-guarded.
   *
   * - On first advance (target leg still CREATED) we book pending TB entries.
   * - On CLEAR: post the leg's TB entries + audit, then either chain next leg or finalize SUCCESS.
   * - On TERMINAL_FAIL: void this leg + markStatus(FAILED) + audit + recompute (legacy-equivalent;
   *   Swap-6 will replace this with the self-heal flow).
   *
   * NOTE: This is the canonical per-leg admin path; the legacy SwapSettlementService is gone.
   * rewires the controller. Do not call this from production code yet.
   */
  async advanceLeg(
    swapNo: string,
    legSeq: number,
    action: InternalFundAction,
    operatorId: string,
  ): Promise<{ swapId: string; legSeq: number; nextStatus: InternalFundStatus }> {
    let emitInfo: { emit: boolean; payload?: { swapId: string; swapNo: string; ownerId: string } } = {
      emit: false,
    };

    const result = await this.prisma.$transaction(async (client: any) => {
      const swap = await this.swapTransactionsService.findByNoInternal(swapNo, client);
      if (swap.status !== 'PROCESSING') {
        throw new BadRequestException('Swap is not in PROCESSING status');
      }

      const active = await this.swapTransactionsService.activeLegsBySeq(swap.id, client);
      const target = active.find((l: any) => l.legSeq === legSeq);
      if (!target) throw new NotFoundException(`Leg ${legSeq} not found`);

      // Sell-first sequence guard: every prior active leg must be CLEAR.
      const priorNotClear = active.some(
        (l: any) => (l.legSeq ?? 0) < legSeq && l.status !== InternalFundStatus.CLEAR,
      );
      if (priorNotClear) {
        throw new BadRequestException(
          'SWAP_SEQUENCE_VIOLATION: previous leg is not yet CLEAR',
        );
      }

      const ctx = this.swapLegAccounting.ctxFromSwap(swap);
      const allSpecs = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat });
      const spec = allSpecs.find((s) => s.legSeq === legSeq);
      if (!spec) throw new Error(`Spec not found for legSeq ${legSeq}`);

      // First advance for this leg → book pending TB entries before transitioning.
      if (target.status === InternalFundStatus.CREATED) {
        await this.swapLegAccounting.initiateLegPending(ctx, spec, client);
      }

      const { nextStatus } = await this.fundsFlow.transitionSwapLeg(
        target.id,
        action,
        operatorId,
        client,
      );

      const TERMINAL_FAIL = new Set<InternalFundStatus>([
        InternalFundStatus.FAILED,
        InternalFundStatus.TIMEOUT,
        InternalFundStatus.RETURNED,
      ]);

      if (nextStatus === InternalFundStatus.CLEAR) {
        emitInfo = await this.onLegCleared(swap, spec, legSeq, allSpecs, ctx, target, client);
      } else if (TERMINAL_FAIL.has(nextStatus)) {
        await this.onLegFailedSelfHeal(swap, spec, legSeq, ctx, target, nextStatus, client);
      }
      // Intermediate hops (SIGNING/BROADCASTED/CONFIRMING/CONFIRMED): just transition, no accounting.

      return { swapId: swap.id, legSeq, nextStatus };
    });

    if (emitInfo.emit && emitInfo.payload) {
      this.eventEmitter.emit(DomainEventNames.SWAP_SUCCEEDED, emitInfo.payload);
    }

    return result;
  }

  /**
   * Swap-7 manual recovery: after ops fixes the root cause for a STUCK leg
   * (NEEDS_REVIEW), this creates a fresh attempt (current+1), books pending,
   * and kicks off the leg's start transition. The previously-stuck attempt row
   * stays as history. Swap remains PROCESSING throughout.
   */
  async resumeLeg(
    swapNo: string,
    legSeq: number,
    operatorId: string,
  ): Promise<{ swapId: string; legSeq: number; resumedAttempt: number }> {
    return this.prisma.$transaction(async (client: any) => {
      const swap = await this.swapTransactionsService.findByNoInternal(swapNo, client);
      if (swap.status !== 'PROCESSING') {
        throw new BadRequestException(
          'SWAP_NOT_PROCESSING: cannot resume a leg on a non-PROCESSING swap',
        );
      }

      const active = await this.swapTransactionsService.activeLegsBySeq(swap.id, client);
      const target = active.find((l: any) => l.legSeq === legSeq);
      if (!target) throw new NotFoundException(`Leg ${legSeq} not found for swap ${swapNo}`);
      if (target.status !== InternalFundStatus.NEEDS_REVIEW) {
        throw new BadRequestException(
          `SWAP_LEG_NOT_STUCK: leg ${legSeq} is in ${target.status}, only NEEDS_REVIEW can be resumed`,
        );
      }

      const ctx = this.swapLegAccounting.ctxFromSwap(swap);
      const allSpecs = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat });
      const spec = allSpecs.find((s) => s.legSeq === legSeq);
      if (!spec) throw new Error(`Spec not found for legSeq ${legSeq}`);

      const fromAttempt = target.attempt ?? 1;
      const resumedAttempt = fromAttempt + 1;

      // createAndStartLeg recomputes projections internally (I2).
      await this.createAndStartLeg(swap, spec, ctx, legSeq, resumedAttempt, operatorId, client);

      await this.auditLogsService.recordSystem(
        {
          action: AuditActions.SWAP_LEG_RESUMED,
          entityType: AuditEntityTypes.SWAP_TRANSACTION,
          entityId: swap.id,
          entityNo: swap.swapNo,
          traceId: swap.traceId ?? swap.swapNo,
          workflowType: AuditWorkflowTypes.SWAP,
          entityOwnerType: swap.ownerType,
          entityOwnerId: swap.ownerId,
          reason: `Swap leg ${legSeq} manually resumed by ${operatorId} (attempt ${resumedAttempt})`,
          metadata: { legSeq, resumedAttempt, fromAttempt },
          sourcePlatform: 'SYSTEM',
        },
        client,
      );

      return { swapId: swap.id, legSeq, resumedAttempt };
    });
  }
}
