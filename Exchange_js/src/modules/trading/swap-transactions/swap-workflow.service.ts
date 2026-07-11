import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
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
import {
  buildSwapLegPlan,
  SwapLegSpec,
} from '../../funds-layer/constants/swap-leg-plan.constant';
import { InternalFundAction } from '../../funds-layer/dto/internal-fund.dto';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import {
  FundsOrderAction,
  FundsOrderStatus,
} from '../../funds-orders/dto/funds-order.dto';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { WalletQueryService } from '../../asset-treasury/wallets/wallet-query.service';

/**
 * Payload of `funds_order.status.changed` — emitted by FundsOrderService on
 * every create/advance. The swap workflow filters on
 * `parent.swapTransactionId` to react to its own settlement legs only.
 */
interface FundsOrderStatusChangedEvent {
  fundsOrderId: string;
  fundsOrderNo: string;
  parent: {
    depositTransactionId?: string;
    withdrawTransactionId?: string;
    swapTransactionId?: string;
  };
  legSeq: number;
  attempt: number;
  oldStatus: string | null;
  newStatus: string;
  traceId?: string;
  effectiveDate?: string; // 平账推单回填的业务归属日；普通实时流转恒为 undefined（swap 腿本阶段不接线）
}

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
 * R1 validation: enforce the funds-order.fromWalletId / toWalletId contract
 * for a swap leg. Customer-side leg requires the customer-role wallet to
 * resolve; firm-only leg requires both firm wallets to resolve. Throws
 * InvalidInternalFundError on miss so we never persist a {from:NULL, to:NULL}
 * SWAP funds-order row.
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

/**
 * Legacy per-leg admin/demo action → FundsOrderAction (spec §3). The old swap
 * leg state machine had SIGN / BROADCAST intermediate hops; the funds-order
 * state machine collapses both into a single SUBMIT (CREATED → SUBMITTED).
 *   SIGN, BROADCAST      → SUBMIT
 *   SEEN_IN_MEMPOOL      → OBSERVE_CONFIRMING
 *   CONFIRM              → CONFIRM
 *   CLEAR                → CLEAR
 *   FAIL                 → FAIL
 *   TIMEOUT              → TIMEOUT
 */
export function mapLegAction(action: InternalFundAction): FundsOrderAction {
  switch (action) {
    case InternalFundAction.SIGN:
    case InternalFundAction.BROADCAST:
    case InternalFundAction.SUBMIT:
      return FundsOrderAction.SUBMIT;
    case InternalFundAction.SEEN_IN_MEMPOOL:
      return FundsOrderAction.OBSERVE_CONFIRMING;
    case InternalFundAction.CONFIRM:
      return FundsOrderAction.CONFIRM;
    case InternalFundAction.CLEAR:
      return FundsOrderAction.CLEAR;
    case InternalFundAction.FAIL:
      return FundsOrderAction.FAIL;
    case InternalFundAction.TIMEOUT:
      return FundsOrderAction.TIMEOUT;
    default:
      throw new BadRequestException(`Unsupported swap leg action: ${action}`);
  }
}

@Injectable()
export class SwapWorkflowService {
  private readonly logger = new Logger(SwapWorkflowService.name);

  /** Swap-6 self-heal cap: at most N attempts per legSeq before STUCK. */
  private static readonly MAX_LEG_ATTEMPTS = 3;

  /** Total legs per swap (4-leg model: SELL, SETTLE, BUY, FEE). */
  private static readonly TOTAL_LEGS = 4;

  private static readonly TERMINAL_FAIL = new Set<string>([
    FundsOrderStatus.FAILED,
    FundsOrderStatus.TIMEOUT,
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingService: OnboardingService,
    private readonly swapQuoteService: SwapQuoteService,
    private readonly swapTransactionsService: SwapTransactionsService,
    private readonly accountingService: AccountingService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly swapLegAccounting: SwapLegAccounting,
    private readonly fundsOrders: FundsOrderService,
    private readonly walletQuery: WalletQueryService,
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

        // R4: both the buy-side and sell-side asset must have an ACTIVE customer
        // receiving account (C_DEP for crypto / C_VIBAN for fiat) before the swap
        // can execute — pre-empts the mid-swap failure that swap-leg-accounting's
        // resolveLegWallets would otherwise hit when a receiving wallet is missing.
        for (const asset of [
          { id: quote.fromAssetId, code: quote.fromAssetCode },
          { id: quote.toAssetId, code: quote.toAssetCode },
        ]) {
          if (!(await this.walletQuery.hasReceivingAccount(ownerId, asset.id))) {
            throw new BadRequestException({
              code: 'RECEIVING_ACCOUNT_REQUIRED',
              assetCode: asset.code,
              message: `请先为 ${asset.code} 创建收款账户再兑换`,
            });
          }
        }

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

        // Create the swap row in PROCESSING status; leg1 booked below, rest chained by the handler.
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

        // Swap-9 cut-over: create ONLY leg1 (CREATED) + book its pending TB
        // entries. Subsequent legs are chained by handleFundsOrderChanged as
        // each prior leg reaches CLEARED (progressive build — Swap-5). One code
        // path for all four leg-build sites — see createLeg helper.
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
        await this.createLeg(swap, legSpecs[0]!, ctx, 1, 1, traceId ?? undefined, tx);

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
   * Unified create-leg helper. Single code path for the four leg-build sites:
   *   - executeSwap leg1 build        (legSeq=1, attempt=1)
   *   - handler chain-next            (legSeq=N+1, attempt=1)
   *   - handler self-heal retry       (legSeq=N,  attempt=K+1)
   *   - resumeLeg manual recovery     (legSeq=N,  attempt=K+1)
   * Creates the funds_order in CREATED (the driver/controller advances it via
   * advanceLeg → funds_order.advance) and books the leg's pending TB entries.
   * Atomic with the passed tx. Recomputes projections at the end (I2). Returns
   * the created funds_order row.
   */
  private async createLeg(
    swap: any,
    spec: SwapLegSpec,
    ctx: SwapSettleCtx,
    legSeq: number,
    attempt: number,
    traceId: string | undefined,
    tx: any,
  ): Promise<any> {
    const assetIdForLeg = spec.side === 'from' ? ctx.fromAssetId : ctx.toAssetId;
    const amount = this.legPrimaryAmountDecimal(spec, ctx);
    // R1: resolve the leg's from/to wallets per role + assert invariants before
    // we persist the funds_order row. Throws InvalidInternalFundError if a
    // customer/firm wallet for the leg's roles is missing.
    const { fromWalletId, toWalletId } = await this.swapLegAccounting.resolveLegWallets(spec, ctx);
    assertInternalFundLegRules(spec, fromWalletId, toWalletId, ctx.swapNo);
    const leg = await this.fundsOrders.create(
      {
        swapTransactionId: swap.id,
        legSeq,
        attempt,
        initialStatus: FundsOrderStatus.CREATED,
        assetId: assetIdForLeg,
        amount: amount.toString(),
        netAmount: amount.toString(),
        fromWalletId,
        toWalletId,
        traceId,
      },
      tx,
    );
    // Book this attempt's pending TB entries. deterministicTransferId keys on
    // attempt so retried legs never collide with the failed attempt's pending.
    const legCtx = { ...ctx, attempt };
    await this.swapLegAccounting.initiateLegPending(legCtx, spec, tx);
    await this.swapTransactionsService.recomputeProjections(
      swap.id,
      (n) => this.stageOf(n),
      tx,
    );
    return leg;
  }

  /**
   * Advance a specific leg of a PROCESSING swap — the sync controller/demo
   * entry. Thin wrapper: resolve the active funds_order for (swap, legSeq,
   * latest attempt, non-terminal), then delegate to funds_order.advance. The
   * funds-order state change emits funds_order.status.changed, which
   * handleFundsOrderChanged picks up for TB posting / chaining / self-heal.
   *
   * Keeps the sell-first sequence guard: every prior active leg must be CLEARED.
   */
  async advanceLeg(
    swapNo: string,
    legSeq: number,
    action: InternalFundAction,
    operatorId: string,
  ): Promise<{ swapId: string; legSeq: number; nextStatus: FundsOrderStatus }> {
    const swap = await this.swapTransactionsService.findByNoInternal(swapNo);
    if (swap.status !== 'PROCESSING') {
      throw new BadRequestException('Swap is not in PROCESSING status');
    }

    const active = await this.swapTransactionsService.activeLegsBySeq(swap.id);
    const target = active.find((l: any) => l.legSeq === legSeq);
    if (!target) throw new NotFoundException(`Leg ${legSeq} not found`);

    // Sell-first sequence guard: every prior active leg must be CLEARED.
    const priorNotClear = active.some(
      (l: any) => (l.legSeq ?? 0) < legSeq && l.status !== FundsOrderStatus.CLEARED,
    );
    if (priorNotClear) {
      throw new BadRequestException(
        'SWAP_SEQUENCE_VIOLATION: previous leg is not yet CLEAR',
      );
    }

    const updated = await this.fundsOrders.advance(
      target.id,
      mapLegAction(action),
      operatorId,
    );

    return { swapId: swap.id, legSeq, nextStatus: updated.status as FundsOrderStatus };
  }

  /**
   * Unified funds-order listener (spec §5.3) — replaces the legacy per-leg
   * accounting that used to live inside advanceLeg. Reacts only to funds orders
   * parented to a swap.
   *
   *   SUBMITTED / CONFIRMING / CONFIRMED → no-op (intermediate hops)
   *   CLEARED  → POST the leg's TB entries + audit SWAP_LEG_POSTED, then either
   *              chain the next leg (legSeq < 4) or finalize SUCCESS (legSeq 4).
   *   FAILED / TIMEOUT → Swap-6 self-heal: void this attempt + (attempt < 3 →
   *              rebuild attempt+1 + audit SWAP_LEG_RETRIED : mark
   *              swap.needsReview + audit SWAP_LEG_STUCK). Swap stays PROCESSING.
   */
  @OnEvent(DomainEventNames.FUNDS_ORDER_STATUS_CHANGED)
  async handleFundsOrderChanged(event: FundsOrderStatusChangedEvent): Promise<void> {
    if (!event.parent.swapTransactionId) return; // only swap legs
    const { newStatus } = event;
    if (
      newStatus !== FundsOrderStatus.CONFIRMED &&
      !SwapWorkflowService.TERMINAL_FAIL.has(newStatus)
    ) {
      // CONFIRMED is the finalize trigger (workflow posts TB + auto-CLEARs the
      // leg + chains the next). CLEARED re-fires here from that auto-CLEAR and
      // is a deliberate no-op. Other intermediate hops: nothing to do.
      return;
    }

    const swapId = event.parent.swapTransactionId;
    this.logger.log(
      `Swap ${swapId} funds order ${event.fundsOrderNo} (leg ${event.legSeq} attempt ${event.attempt}) → ${newStatus}`,
    );

    await this.prisma.$transaction(async (client: any) => {
      const swap = await this.swapTransactionsService.findByIdInternal(swapId, client);
      if (!swap || swap.status !== 'PROCESSING') {
        // Already SUCCESS (idempotent replay) or gone — nothing to do.
        return;
      }
      const ctx = this.swapLegAccounting.ctxFromSwap(swap);
      const allSpecs = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat });
      const spec = allSpecs.find((s) => s.legSeq === event.legSeq);
      if (!spec) throw new Error(`Spec not found for legSeq ${event.legSeq}`);

      if (newStatus === FundsOrderStatus.CONFIRMED) {
        await this.onLegConfirmed(swap, spec, event, ctx, client);
      } else {
        await this.onLegFailedSelfHeal(swap, spec, event, ctx, client);
      }
    });
  }

  /**
   * Handle the CONFIRMED trigger: POST the leg's TB entries + audit
   * SWAP_LEG_POSTED, auto-advance the leg funds_order to CLEARED (terminal —
   * mirrors deposit/withdraw where CONFIRM finalizes internally, so manual
   * simulation only needs to reach CONFIRMED), then either finalize SUCCESS
   * (last leg) or chain the next leg. The CLEARED event this advance emits
   * re-enters handleFundsOrderChanged and is a no-op (guarded out).
   */
  private async onLegConfirmed(
    swap: any,
    spec: SwapLegSpec,
    event: FundsOrderStatusChangedEvent,
    ctx: SwapSettleCtx,
    client: any,
  ): Promise<void> {
    const legSeq = event.legSeq;
    // The TB pending id is derived per-(swap, leg, attempt). Use THIS attempt so
    // post hits the right transfer (matches initiateLegPending's id).
    // 铸号已在 advance()→CONFIRMED 落到 leg funds_order(事件先于此提交)。读回真实号
    // 传入 postLeg,由 enrichForPost 盖进 evidence + account_flows。
    const legFo = await this.fundsOrders.findById(event.fundsOrderId);
    const externalRef = legFo ? this.fundsOrders.resolveExternalRef(legFo) : null;
    await this.swapLegAccounting.postLeg(
      { ...ctx, attempt: event.attempt },
      spec,
      client,
      externalRef,
    );
    // Auto-CLEAR the leg funds_order now that accounting is posted (CONFIRMED →
    // CLEARED). Terminal; the re-emitted CLEARED event is guarded out above.
    await this.fundsOrders.advance(
      event.fundsOrderId,
      FundsOrderAction.CLEAR,
      'SYSTEM',
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
        metadata: { legSeq, attempt: event.attempt },
        sourcePlatform: 'SYSTEM',
      },
      client,
    );

    const isLast = legSeq >= SwapWorkflowService.TOTAL_LEGS;
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
      // SUCCESS: no leg created, so recompute is not covered by createLeg.
      await this.swapTransactionsService.recomputeProjections(
        swap.id,
        (n) => this.stageOf(n),
        client,
      );
      return;
    }

    // Progressively create the next leg (CREATED). createLeg recomputes projections (I2).
    const allSpecs = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat });
    const nextSpec = allSpecs.find((s) => s.legSeq === legSeq + 1)!;
    await this.createLeg(swap, nextSpec, ctx, legSeq + 1, 1, swap.traceId ?? undefined, client);
  }

  /**
   * Swap-6 self-heal: void this attempt's pending, then either retry
   * (attempt+1) or flag the swap needsReview (after MAX_LEG_ATTEMPTS). Swap
   * stays PROCESSING — never markStatus FAILED. The failed funds_order row
   * stays terminal (FAILED/TIMEOUT) as history.
   */
  private async onLegFailedSelfHeal(
    swap: any,
    spec: SwapLegSpec,
    event: FundsOrderStatusChangedEvent,
    ctx: SwapSettleCtx,
    client: any,
  ): Promise<void> {
    const legSeq = event.legSeq;
    const failedAttempt = event.attempt;
    await this.swapLegAccounting.voidLeg(
      { ...ctx, attempt: failedAttempt },
      spec,
      client,
    );

    if (failedAttempt < SwapWorkflowService.MAX_LEG_ATTEMPTS) {
      const nextAttempt = failedAttempt + 1;
      // createLeg recomputes projections internally (I2).
      await this.createLeg(swap, spec, ctx, legSeq, nextAttempt, swap.traceId ?? undefined, client);
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
          metadata: { legSeq, failedAttempt, nextAttempt, failedStatus: event.newStatus },
          sourcePlatform: 'SYSTEM',
        },
        client,
      );
    } else {
      // attempts == MAX_LEG_ATTEMPTS → STUCK: flag the swap for manual resume.
      // The funds_order stays terminal; needsReview is tracked on the swap.
      await this.swapTransactionsService.setNeedsReview(swap.id, true, client);
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
          metadata: { legSeq, attempts: failedAttempt, lastFailedStatus: event.newStatus },
          sourcePlatform: 'SYSTEM',
        },
        client,
      );
    }
    // NOTE: do NOT markStatus FAILED — self-heal keeps swap in PROCESSING.
  }

  /**
   * Swap-7 manual recovery: after ops fixes the root cause for a stuck leg
   * (swap.needsReview=true), this creates a fresh attempt (max+1 for the leg),
   * books pending, and clears needsReview. The previous terminal attempt rows
   * stay as history. Swap remains PROCESSING throughout.
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
      if (!SwapWorkflowService.TERMINAL_FAIL.has(target.status)) {
        throw new BadRequestException(
          `SWAP_LEG_NOT_STUCK: leg ${legSeq} is in ${target.status}, only a failed (FAILED/TIMEOUT) leg can be resumed`,
        );
      }

      const ctx = this.swapLegAccounting.ctxFromSwap(swap);
      const allSpecs = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat });
      const spec = allSpecs.find((s) => s.legSeq === legSeq);
      if (!spec) throw new Error(`Spec not found for legSeq ${legSeq}`);

      const fromAttempt = target.attempt ?? 1;
      const resumedAttempt = fromAttempt + 1;

      // createLeg recomputes projections internally (I2).
      await this.createLeg(swap, spec, ctx, legSeq, resumedAttempt, swap.traceId ?? undefined, client);
      // Clear the STUCK flag now that a fresh attempt is in flight.
      await this.swapTransactionsService.setNeedsReview(swap.id, false, client);

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
