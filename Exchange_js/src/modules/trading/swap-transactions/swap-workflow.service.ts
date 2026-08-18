import { randomUUID } from 'crypto';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { OnboardingService } from '../../identity/onboarding/onboarding.service';
import { SwapQuoteService } from '../swap-fee-level/swap-quote.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapTransactionAction, SwapTransactionStatus } from './dto/swap-transaction.dto';
import { SwapLegAccounting, SwapSettleCtx } from './swap-leg-accounting';
import {
  SUMSUB_TXN_CLIENT,
  SumsubTxnClient,
} from '../../deposit-sumsub/sumsub-txn-client.interface';
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
import {
  TransactionLimitGateService,
  GateValuation,
} from '../../asset-treasury/transaction-limits/transaction-limit-gate.service';
import { CustomerRestrictionsService } from '../../identity/customers/customer-restrictions.service';
import { CustomerAccessService } from '../../identity/customers/customer-access.service';
import { CustomerPendingActionService } from '../../identity/customers/customer-pending-action.service';
import { MaterialRequestsService } from '../../identity/material-requests/material-requests.service';
import { MaterialRequestIssuerService } from '../../identity/material-requests/material-request-issuer.service';

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
    private readonly limitGateService: TransactionLimitGateService,
    @Inject(SUMSUB_TXN_CLIENT) private readonly sumsubTxnClient: SumsubTxnClient,
    private readonly customerRestrictionsService: CustomerRestrictionsService,
    private readonly customerPendingActionService: CustomerPendingActionService,
    private readonly customerAccessService: CustomerAccessService,
    private readonly materialRequests: MaterialRequestsService,
    private readonly materialRequestIssuer: MaterialRequestIssuerService,
  ) {}

  private resolveLedger(currency: string): number {
    const ledger = (TB_LEDGERS as Record<string, number>)[currency];
    if (!ledger) {
      throw new BadRequestException(`Unsupported asset currency for TB accounting: ${currency}`);
    }
    return ledger;
  }

  async initiateSwap(ownerId: string, quoteId: string) {
    // ── L1 Eligibility gate (synchronous) ──
    const customer = await this.prisma.customerMain.findUnique({ where: { id: ownerId } });
    await this.onboardingService.assertTradingEligibility(ownerId, 'SWAP');

    // ── L1 Transaction Limit gate (A + B) — evaluate BEFORE quote consumption ──
    // Peek the quote OUTSIDE the transaction only to get the from-asset + amount
    // for the gate. A missing quote is NOT thrown here on purpose: it falls
    // through to the in-transaction getActiveQuoteOrThrow, which rejects it via
    // the existing audited SWAP_FAILED path (skipping the gate for a nonexistent
    // quote gates nothing — no swap can be created without a valid quote).
    let gateValuation: GateValuation | null = null;
    const quotePeek = await this.prisma.swapQuote.findUnique({
      where: { id: quoteId },
      select: { fromAssetId: true, amountIn: true },
    });
    if (quotePeek) {
      gateValuation = await this.limitGateService.evaluate({
        operationType: 'SWAP',
        customerId: ownerId,
        assetId: quotePeek.fromAssetId,
        amount: new Prisma.Decimal(quotePeek.amountIn),
      });
    }

    const now = new Date();
    const swapNo = generateReferenceNo('SWP');

    // Lifted to outer scope so the catch block can emit SWAP_FAILED with the
    // inherited traceId. Assigned at the top of the transaction once we read
    // the quote. If the failure happens before assignment (e.g. quote lookup
    // itself throws), traceId stays null and the SWAP_FAILED audit will carry
    // null — still useful for swapNo-based correlation.
    let traceId: string | null = null;
    let swap: any;
    try {
      swap = await this.prisma.$transaction(async (tx) => {
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
          // Ledger precheck: fail fast (and roll back the quote consume + swap
          // row together with the rest of this transaction) if the asset's
          // settlement currency isn't registered in TB_LEDGERS. Without this,
          // the same miss only surfaces later inside applyKytVerdict's
          // buildLegContext — by then the compliance verdict has already been
          // written outside that transaction, leaving the swap stuck in
          // COMPLIANCE_PENDING with the quote burned and the KYT check wasted.
          const assetRow = await tx.asset.findUnique({
            where: { id: asset.id },
            select: { currency: true },
          });
          this.resolveLedger(assetRow?.currency || asset.code);
        }

        const fromAmount = new Prisma.Decimal(quote.amountIn);
        const toAmount = new Prisma.Decimal(quote.amountOut);
        const totals = this.parseTotals(quote.totalsJson);
        const netToAmount = new Prisma.Decimal(totals.amountOutNet || quote.amountOut.toString());
        const feeAmount = new Prisma.Decimal(quote.feeTotal || 0);
        const rate = new Prisma.Decimal(quote.rateAllIn);

        await this.swapQuoteService.consumeQuote(quoteId, 'CUSTOMER', ownerId, fromAmount, tx);

        // Spread margin needs only the to-asset's decimal precision for rounding.
        // The full leg-accounting context (ledgers/currencies/fromIsFiat) is no
        // longer built here — legs are deferred until the sell leg clears Sumsub
        // KYT, at which point buildLegContext rebuilds it from the persisted row.
        const toAsset = await tx.asset.findUnique({
          where: { id: quote.toAssetId },
          select: { decimals: true },
        });
        const toDecimals = toAsset?.decimals ?? 8;

        // Spread margin = market value of the in-leg minus the quoted gross out.
        // Kept as a reporting field on the swap row only.
        const marketRate = new Prisma.Decimal(quote.marketRate);
        const marketValueOut = fromAmount
          .mul(marketRate)
          .toDecimalPlaces(toDecimals, Prisma.Decimal.ROUND_HALF_UP);
        const spreadAmount = marketValueOut.sub(toAmount);

        // Create the swap row in COMPLIANCE_PENDING — no legs are booked here.
        // Legs are built only after the sell leg clears Sumsub KYT (Task 6
        // applyKytVerdict / onKytApproved).
        const createdSwap = await this.swapTransactionsService.create({
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
          grossAedValue: gateValuation?.grossAedValue ?? undefined,
          status: SwapTransactionStatus.COMPLIANCE_PENDING,
        }, tx);

        await this.auditLogsService.recordByActor(
          {
            action: AuditActions.SWAP_CREATED,
            entityType: AuditEntityTypes.SWAP_TRANSACTION,
            entityId: createdSwap.id,
            entityNo: createdSwap.swapNo || undefined,
            traceId,
            workflowType: AuditWorkflowTypes.SWAP,
            entityOwnerType: createdSwap.ownerType,
            entityOwnerId: createdSwap.ownerId,
            entityOwnerNo: createdSwap.ownerNo || undefined,
            reason: `Swap executed from quote ${quote.quoteNo || quote.id}`,
            metadata: { quoteId: quote.id, quoteNo: quote.quoteNo },
            sourcePlatform: 'CUSTOMER_API',
          },
          { actorType: 'CUSTOMER', actorId: ownerId, actorNo: quote.ownerNo || undefined, actorRole: 'CUSTOMER' },
          tx,
        );

        return createdSwap;
      });
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

    // Submit the sell leg to Sumsub KYT. The order stays COMPLIANCE_PENDING —
    // only the webhook verdict handler (Task 5/6) may advance status from here.
    // submitSumsubTxnOut never throws (I2, see its own doc comment) — a
    // Sumsub outage here must not 500 the customer or strand the swap.
    await this.submitSumsubTxnOut(swap.id);
    // Task 11 hardening: route the create response through the same
    // customer allow-list findOne/findAll already use, even though the raw
    // `swap` row is harmless today (compliance columns are still null at
    // insert time). Defence in depth — a future edit that reassigns `swap`
    // to a richer, post-verdict row would otherwise silently reopen a
    // tipping-off leak on this one route.
    return this.swapTransactionsService.toCustomerSwapView(swap);
  }

  /**
   * Submit the sell leg (fromAsset, direction=out) to Sumsub KYT right after
   * the swap is created COMPLIANCE_PENDING. Public (not private): the SLA
   * watchdog (Task 8) retries this directly, so it must be safe to call twice —
   * if the swap already has an outbound Sumsub txn id, this is a no-op. If the
   * customer has no sumsubApplicantId yet, warns and skips — the swap stays
   * COMPLIANCE_PENDING awaiting manual handling rather than submitting an
   * empty applicantId that Sumsub would reject.
   *
   * I2 (充值教训): the ENTIRE call is wrapped in try/catch — a submit failure
   * (Sumsub down, network error) must never strand the swap; it just stays
   * in COMPLIANCE_PENDING for retry (there is no caller-side try/catch here,
   * mirrors WithdrawWorkflowService.submitSumsubTxn).
   */
  async submitSumsubTxnOut(swapId: string): Promise<void> {
    let swap: any = null;
    try {
      swap = await this.prisma.swapTransaction.findUnique({
        where: { id: swapId },
        include: { customer: true, fromAsset: true },
      });
      if (!swap) throw new NotFoundException(`Swap not found: ${swapId}`);
      if (swap.sumsubTxnIdOut) return; // 幂等：看门狗重试安全

      const applicantId = swap.customer?.sumsubApplicantId;
      if (!applicantId) {
        this.logger.warn(
          `submitSumsubTxnOut skip: swap ${swapId} owner ${swap.ownerId} has no sumsubApplicantId — staying in COMPLIANCE_PENDING for manual handling`,
        );
        return;
      }

      const res = await this.sumsubTxnClient.submitTxn({
        applicantId,
        clientTxnId: `${swap.swapNo}-OUT`,
        type: 'finance',
        direction: 'out',
        amount: Number(swap.fromAmount),
        currencyCode: swap.fromAsset.currency,
        currencyType: swap.fromAsset.type === 'CRYPTO' ? 'crypto' : 'fiat',
        orderId: swap.swapNo ?? undefined,
        props: { txType: 'exchange' },
        infoType: 'exchange',
      });

      await this.prisma.swapTransaction.update({
        where: { id: swapId },
        data: {
          sumsubTxnIdOut: res.txnId,
        sumsubTxnType: 'finance', // swap 恒 finance（无对手方 → 无 travelRule）
          // 同步响应只作证据快照，绝不写 status —— 状态唯一写入口是 webhook handler
          complianceAction: res.scoringResult?.action ?? null,
          complianceRuleNames: res.scoringResult?.matchedRuleNames?.join(',') ?? null,
        },
      });

      await this.auditLogsService.recordSystem({
        action: AuditActions.SWAP_KYT_SUBMITTED,
        entityType: AuditEntityTypes.SWAP_TRANSACTION,
        entityId: swap.id,
        entityNo: swap.swapNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'Swap sell-leg submitted to Sumsub KYT',
        metadata: { sumsubTxnId: res.txnId, scoringAction: res.scoringResult?.action, direction: 'out' },
      });
    } catch (err) {
      this.logger.error(
        `submitSumsubTxnOut failed for swap ${swapId}: ${(err as Error).message} — staying in COMPLIANCE_PENDING for retry`,
      );
      await this.auditLogsService
        .recordSystem({
          action: AuditActions.SWAP_KYT_SUBMIT_FAILED,
          entityType: AuditEntityTypes.SWAP_TRANSACTION,
          entityId: swap?.id,
          entityNo: swap?.swapNo || undefined,
          entityOwnerType: swap?.ownerType,
          entityOwnerId: swap?.ownerId,
          traceId: swap?.traceId ?? undefined,
          workflowType: AuditWorkflowTypes.SWAP,
          reason: err instanceof Error ? err.message : 'Sumsub KYT submit failed',
          sourcePlatform: 'SYSTEM',
        })
        .catch(() => undefined);
    }
  }

  // 已终态:进入 applyKytVerdict 时直接 no-op(幂等,防终态后迟到/重投的 webhook)。
  private static readonly KYT_VERDICT_TERMINAL_STATUSES = new Set([
    SwapTransactionStatus.SUCCESS,
    SwapTransactionStatus.REJECTED,
    SwapTransactionStatus.FAILED,
    SwapTransactionStatus.REVERSED,
  ]);

  /**
   * Sumsub KYT 裁决落地入口(SwapKytVerdictHandler 调用,Task 5 打桩、Task 6 落地)。
   * Swap 没有 withdraw/deposit 那种"等"态(无 awaitUser/onHold) —— handler 已把
   * 每个非 approved 的 verdict 归一成 rejected,这里落库分三支:
   *
   *   PROCESSING → 只落证据 + 审计 + (rejected 时)needsReview,不做状态分发
   *              (Review Fix 1,见下方守卫的详细注释)。
   *   approved → markStatus(KYT_APPROVED) → PROCESSING,在同一事务内用
   *              buildLegContext + createLeg 建 leg1,随后补提买入腿到 Sumsub
   *              (纯数据腿,不承载裁决,失败不阻断已放行的兑换)。
   *   rejected → markStatus(KYT_REJECTED, {rejectReason: 'KYT_REJECTED'}) →
   *              REJECTED,零记账(不建任何 leg、不碰 TB)——移交处置(Task 7 打桩)。
   *
   * 事务边界:裁决证据字段(complianceVerdict/sumsubDetailJson)和 markStatus
   * 落在同一个 $transaction 里,而不是先落库再开事务(Task 4 终审教训)——否则
   * 事务内任何一步抛错都会回滚状态迁移,却把裁决证据留在库里,单子就卡在
   * COMPLIANCE_PENDING 但 complianceVerdict 已经显示 approved/rejected,误导排查。
   */
  async applyKytVerdict(
    swapId: string,
    input: {
      verdict: 'approved' | 'rejected';
      /** scoringResult.score —— 与提现契约对齐（parity 2026-08-14），approved 也带。 */
      riskScore?: number | null;
      detailRaw?: unknown;
      applicantActions?: { applicantActionId: string; externalActionId: string }[];
      typedTags?: string[];
    },
  ): Promise<void> {
    const swap = await this.swapTransactionsService.findByIdInternal(swapId);
    if (!swap) {
      this.logger.warn(`applyKytVerdict: swap ${swapId} not found`);
      return;
    }

    const status = swap.status as SwapTransactionStatus;
    if (SwapWorkflowService.KYT_VERDICT_TERMINAL_STATUSES.has(status)) {
      // Review Fix 1 (Important): a swap already sitting in REJECTED does NOT
      // mean disposition (customerRestrictionsService.add + pendingAction)
      // actually landed — markStatus and handleRejectDisposition are two
      // separate writes (state machine vs. customer domain), and the latter
      // runs outside the $transaction that committed REJECTED. If it threw
      // (SQLite lock, transient DB error, ...), the exception propagated all
      // the way to SwapKytVerdictHandler.handle uncaught, the ingestion
      // dispatcher marked the webhook event FAILED and retried it — and
      // without this carve-out the retry would land right back here and
      // silently no-op, leaving the customer unrestricted forever with no
      // signal. A second 'rejected' verdict arriving for an already-REJECTED
      // swap is exactly that redelivery shape (or a genuine duplicate, which
      // is a harmless no-op since handleRejectDisposition is fully
      // idempotent — see its class comment) — so it is let back in, on
      // purpose, to re-run ONLY disposition. markStatus/leg-building must
      // never re-run here; they are genuinely one-shot.
      //
      // Finding 2 (Minor, 终审): the exact same redelivery shape can also land
      // on a swap that has since reached SUCCESS — disposition is invoked a
      // second time from the PROCESSING branch below (a hard line raised
      // after the swap already entered settlement); if THAT call throws, the
      // webhook retry (≥30s later, per the ingestion dispatcher's backoff) can
      // easily arrive after the swap's legs have all cleared. The order's own
      // state must not decide whether the PERSON gets restricted (same
      // principle as Review Fix 3 above), so SUCCESS is admitted here too —
      // handleRejectDisposition never touches swap status or legs, only
      // customer-domain writes, so re-admitting it here cannot re-transition
      // the swap, rebuild a leg, or unwind anything already settled.
      if (
        (status === SwapTransactionStatus.REJECTED || status === SwapTransactionStatus.SUCCESS) &&
        input.verdict === 'rejected'
      ) {
        await this.handleRejectDisposition(swap, input);
        return;
      }
      this.logger.debug(`applyKytVerdict no-op: swap ${swapId} already terminal (${status})`);
      return;
    }

    // parity 2026-08-14：证据四件套(verdict/score/scoredAt/detailJson)经
    // saveSumsubVerdict 一次原子写——镜像提现 saveSumsubVerdict,三个分支共用。
    const verdictEvidence = {
      verdict: input.verdict,
      score: input.riskScore ?? null,
      scoredAt: new Date(),
      detailJson: input.detailRaw !== undefined ? JSON.stringify(input.detailRaw) : undefined,
    };

    // Review Fix 1 (Important): PROCESSING 期迟到裁决不能死信。PROCESSING 故意不在
    // KYT_VERDICT_TERMINAL_STATUSES 里(兑换还在四腿链上结算,是个长窗口而非瞬时态),
    // 但下面两支转移表都没有"PROCESSING + KYT_*"的合法边(transitions 表 PROCESSING
    // 只定义了 SUCCESS 一条边)。任由它落进两支之一,一个重评的 rejected 裁决会在
    // markStatus 里抛 BadRequestException——SwapKytVerdictHandler 不 catch,
    // ingestion dispatcher 把这个 webhook 标 FAILED → 重试 → DEAD,一次执行后的
    // 合规拒绝就此静默丢失。镜像 withdraw-workflow.service.ts 的 PAYOUT_PENDING 守卫:
    // 落证据字段 + 写一条专属审计,rejected 时给单子打 needsReview,然后原样返回——
    // 不做任何状态分发,让 webhook 正常拿到 200。
    if (status === SwapTransactionStatus.PROCESSING) {
      await this.prisma.$transaction(async (tx) => {
        await this.swapTransactionsService.saveSumsubVerdict(swapId, verdictEvidence, tx);
        if (input.verdict === 'rejected') {
          await this.swapTransactionsService.setNeedsReview(swap.id, true, tx);
        }
        await this.auditLogsService.recordSystem(
          {
            action: AuditActions.SWAP_POST_APPROVAL_VERDICT,
            entityType: AuditEntityTypes.SWAP_TRANSACTION,
            entityId: swap.id,
            entityNo: swap.swapNo || undefined,
            traceId: swap.traceId ?? undefined,
            workflowType: AuditWorkflowTypes.SWAP,
            entityOwnerType: swap.ownerType,
            entityOwnerId: swap.ownerId,
            reason: `KYT verdict '${input.verdict}' received after swap entered PROCESSING — no state-machine action taken`,
            metadata: { verdict: input.verdict },
            sourcePlatform: 'SYSTEM',
          },
          tx,
        );
      });
      // Review Fix 3 (Important): the swap itself correctly keeps executing
      // here (it's mid-settlement, already past the point of no return, and
      // must not be unwound) — but the PERSON must still be restricted. Before
      // this fix, a sanction verdict landing after PROCESSING only flagged
      // needsReview above and never reached disposition, so a customer
      // sanctioned mid-swap kept full SWAP/WITHDRAW capability indefinitely.
      // Reuses the exact same disposition logic as the REJECTED branch below
      // (idempotent — safe against webhook redelivery or a second late
      // verdict for the same swap).
      if (input.verdict === 'rejected') {
        await this.handleRejectDisposition(swap, input);
      }
      return;
    }

    if (input.verdict === 'approved') {
      await this.prisma.$transaction(async (tx) => {
        await this.swapTransactionsService.saveSumsubVerdict(swapId, verdictEvidence, tx);
        await this.swapTransactionsService.markStatus(swapId, SwapTransactionAction.KYT_APPROVED, tx);
        await this.auditLogsService.recordSystem(
          {
            action: AuditActions.SWAP_KYT_APPROVED,
            entityType: AuditEntityTypes.SWAP_TRANSACTION,
            entityId: swap.id,
            entityNo: swap.swapNo || undefined,
            traceId: swap.traceId ?? undefined,
            workflowType: AuditWorkflowTypes.SWAP,
            entityOwnerType: swap.ownerType,
            entityOwnerId: swap.ownerId,
            reason: 'Swap KYT verdict approved — proceeding to settlement',
            sourcePlatform: 'SYSTEM',
          },
          tx,
        );
        const ctx = await this.buildLegContext(swap, tx);
        const legSpecs = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat });
        await this.createLeg(swap, legSpecs[0]!, ctx, 1, 1, swap.traceId ?? undefined, tx);
      });
      await this.submitSumsubTxnIn(swapId); // fire-and-forget，买入腿失败不阻断已放行的兑换
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await this.swapTransactionsService.saveSumsubVerdict(swapId, verdictEvidence, tx);
      await this.swapTransactionsService.markStatus(swapId, SwapTransactionAction.KYT_REJECTED, tx, {
        rejectReason: 'KYT_REJECTED',
      });
      await this.auditLogsService.recordSystem(
        {
          action: AuditActions.SWAP_KYT_REJECTED,
          entityType: AuditEntityTypes.SWAP_TRANSACTION,
          entityId: swap.id,
          entityNo: swap.swapNo || undefined,
          traceId: swap.traceId ?? undefined,
          workflowType: AuditWorkflowTypes.SWAP,
          entityOwnerType: swap.ownerType,
          entityOwnerId: swap.ownerId,
          reason: 'Swap KYT verdict rejected — no settlement legs booked',
          metadata: { typedTags: input.typedTags },
          sourcePlatform: 'SYSTEM',
        },
        tx,
      );
    });
    await this.handleRejectDisposition(swap, input);
  }

  /**
   * Submit the buy leg (toAsset, direction=in) to Sumsub KYT right after leg1
   * is booked. This leg carries NO verdict — Sumsub already approved the swap
   * via the sell-leg KYT check; this is purely data feeding the applicant's
   * behavioural profile. Mirrors submitSumsubTxnOut's guards (idempotency +
   * missing-applicantId), and the whole call is try/caught: a failure here
   * must never roll back or block a swap that has already started executing.
   */
  private async submitSumsubTxnIn(swapId: string): Promise<void> {
    let swap: any = null;
    try {
      swap = await this.prisma.swapTransaction.findUnique({
        where: { id: swapId },
        include: { customer: true, toAsset: true },
      });
      if (!swap) return;
      if (swap.sumsubTxnIdIn) return; // 幂等：webhook 重投/看门狗重试安全

      const applicantId = swap.customer?.sumsubApplicantId;
      if (!applicantId) {
        this.logger.warn(
          `submitSumsubTxnIn skip: swap ${swapId} owner ${swap.ownerId} has no sumsubApplicantId`,
        );
        return;
      }

      const res = await this.sumsubTxnClient.submitTxn({
        applicantId,
        clientTxnId: `${swap.swapNo}-IN`,
        type: 'finance',
        direction: 'in',
        amount: Number(swap.netToAmount ?? swap.toAmount),
        currencyCode: swap.toAsset.currency,
        currencyType: swap.toAsset.type === 'CRYPTO' ? 'crypto' : 'fiat',
        orderId: swap.swapNo ?? undefined,
        props: { txType: 'exchange' },
        infoType: 'exchange',
      });

      await this.prisma.swapTransaction.update({
        where: { id: swapId },
        data: { sumsubTxnIdIn: res.txnId },
      });

      await this.auditLogsService.recordSystem({
        action: AuditActions.SWAP_KYT_SUBMITTED,
        entityType: AuditEntityTypes.SWAP_TRANSACTION,
        entityId: swap.id,
        entityNo: swap.swapNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'Swap buy-leg submitted to Sumsub KYT (data-only, carries no verdict)',
        metadata: { sumsubTxnId: res.txnId, direction: 'in' },
      });
    } catch (err) {
      // 买入腿是纯数据腿，不承载裁决 —— 失败只告警，绝不回滚已成交的兑换。但对运营
      // 来说失败才是真正要看见的一面（买入腿悄悄没喂给 Sumsub 会静默拉低客户行为
      // 画像的完整度）—— 补一条 SWAP_KYT_SUBMIT_FAILED 审计，与 submitSumsubTxnOut
      // 的失败路径对称。
      this.logger.error(`buy-leg KYT submit failed for swap ${swapId}: ${String(err)}`);
      await this.auditLogsService
        .recordSystem({
          action: AuditActions.SWAP_KYT_SUBMIT_FAILED,
          entityType: AuditEntityTypes.SWAP_TRANSACTION,
          entityId: swap?.id,
          entityNo: swap?.swapNo || undefined,
          entityOwnerType: swap?.ownerType,
          entityOwnerId: swap?.ownerId,
          traceId: swap?.traceId ?? undefined,
          workflowType: AuditWorkflowTypes.SWAP,
          reason: err instanceof Error ? err.message : 'Sumsub KYT buy-leg submit failed',
          metadata: { direction: 'in' },
          sourcePlatform: 'SYSTEM',
        })
        .catch(() => undefined);
    }
  }

  /**
   * On a rejected KYT verdict this decides disposition: writing customer
   * restrictions, whether to expose a re-verification prompt to the
   * customer, and the sanctions/tipping-off split (silent for SANCTION hits,
   * customer-visible otherwise). By the time this runs the swap is already
   * REJECTED with zero accounting trace — this only adds side effects on top
   * and must never touch funds, legs, or accounting.
   *
   * Runs OUTSIDE the $transaction that committed REJECTED (that transaction
   * is long closed by the time applyKytVerdict calls this) — so every write
   * here must be independently idempotent and safe to re-run (webhook
   * redelivery, retry, or a manual replay must never duplicate restrictions
   * or corrupt state):
   *   - customerRestrictionsService.add is dedup'd per capability (Task 1) —
   *     re-adding SWAP/WITHDRAW is a no-op on repeat calls.
   *   - 2026-08-17 材料请求账：materialRequestIssuer.register() is NOT
   *     naturally idempotent — externalActionId is @unique, so re-registering
   *     an action already on the books throws P2002 instead of no-op'ing like
   *     the old customerPendingActionService.set() did. The register loop
   *     below dedupes against listLiveByOrder() first (same guard
   *     deposit/withdraw's applicant-actions services use) so a webhook
   *     redelivery / ingestion retry after a partial failure can't wedge the
   *     swap permanently.
   *
   * Two situations, and telling them apart correctly is the whole point:
   *   - soft line: Sumsub attached ≥1 applicantActions and no SANCTION tag —
   *     the customer can fix this (submit source-of-funds, a liveness check,
   *     etc.), so pendingAction is exposed.
   *   - hard line: no actions attached, OR a SANCTION scene tag is present —
   *     nothing the customer can submit will fix it, and in the sanctions
   *     case the customer must not be told anything at all (tipping-off is a
   *     criminal offence in most AML regimes). pendingAction is stored null.
   *
   * The tipping-off decision is made exactly ONCE, here, on the write side.
   * CustomerPendingActionService.get() (the read side, consumed by the
   * client-facing endpoint) is a dumb accessor with no conditional logic of
   * its own — see that service's class comment for why the decision must
   * never be re-derived on the read side.
   *
   * Review Fix 2 (Important): a single swap's own tags/actions are not
   * enough to decide exposure — a customer can have two swaps in
   * COMPLIANCE_PENDING at once, and the SWAP restriction only lands after the
   * FIRST rejection, so a hard-line (sanction) disposition on swap A followed
   * seconds later by an independent soft-line disposition on swap B would
   * otherwise re-expose an entry point for a sanctioned customer — each write
   * individually correct, the resulting state wrong. `hasHardLineDisposition`
   * makes the hard-line fact sticky on the customer row: once tripped, it
   * silences every later disposition for that customer, not just this swap's.
   *
   * Finding 3 (Minor, 终审): the sticky marker is stamped on `hasSanction`
   * ONLY, not on `isHardLineThisVerdict`. The durable-silence requirement
   * above was motivated by sanctions specifically — a SANCTION hit must never
   * be un-silenced by a later, independently-arriving soft-line verdict. The
   * no-actions hard line (Sumsub attached nothing to act on) has no such
   * requirement: it's a per-verdict fact, not a permanent one — this
   * particular rejection has nothing to expose, but it says nothing about
   * whether the customer's NEXT rejection will. Stamping the sticky marker
   * there too would permanently silence a customer whose first rejection
   * simply happened to carry no applicantActions, with no path back (see
   * CustomerPendingActionService — the marker has no clear/reset entry
   * point on purpose).
   *
   * Review Fix 1 (Important): this entire body is wrapped in try/catch. A
   * throw here (SQLite lock, transient DB error, a service throwing
   * NotFoundException) must not vanish — see the call sites for how the
   * exception is used (propagated so the ingestion pipeline retries, and the
   * terminal-status guard in applyKytVerdict now explicitly allows a REJECTED
   * swap's retry to re-enter here instead of silently no-op'ing).
   */
  private async handleRejectDisposition(
    // Review Fix 6 (Minor): narrow inline type — only the fields this method
    // actually reads (plus ownerNo, needed for Review Fix 4's audit business key).
    swap: {
      id: string;
      swapNo: string | null;
      ownerId: string;
      ownerType: string;
      ownerNo: string | null;
      traceId: string | null;
    },
    input: {
      verdict: 'approved' | 'rejected';
      /** scoringResult.score —— 与提现契约对齐（parity 2026-08-14），approved 也带。 */
      riskScore?: number | null;
      detailRaw?: unknown;
      applicantActions?: { applicantActionId: string; externalActionId: string }[];
      typedTags?: string[];
    },
  ): Promise<void> {
    try {
      // ── 先做分型判定（全是只读，无副作用），再落写入 ──
      // Task 8：便签的 cause 取决于软硬线，所以判定必须先于贴便签。
      const hasSanction = (input.typedTags ?? []).includes('SANCTION');
      const actions = input.applicantActions ?? [];
      // 本次裁决单看自己是不是硬线：无 action 可做，或命中 SANCTION。
      const isHardLineThisVerdict = hasSanction || actions.length === 0;

      // Review Fix 2: 跨订单持久化 —— 查这个客户是否曾经被任意一笔 swap 硬线
      // 过。一旦命中过，永久不再暴露，不管这次裁决本身是软线还是硬线。
      const alreadyHardLined = await this.customerPendingActionService.hasHardLineDisposition(
        swap.ownerId,
      );
      const exposeToCustomer = !alreadyHardLined && !isHardLineThisVerdict;

      // 收紧方向、免事前审批：无论软硬线都限制 SWAP/WITHDRAW。DEPOSIT 故意不
      // 限制 —— 链上资金已经到账，拒收解决不了任何问题，只会制造资金卡死。
      //
      // Task 8：从 restrictions.add(capability[]) 换成限制账 open({cause})。
      // cause 三分：命中制裁 → SANCTION（SILENT / 卡全部能力 / 只能 MLRO 解）；
      // 否则按本次是否暴露补料入口分 KYT_REJECTED_SOFT（DISCLOSED）与
      // KYT_REJECTED_HARD（SILENT）。scope 不传 —— 三个 cause 的 scopeSelectable
      // 均为 false，由注册表带出。caseRef=swapNo，便于按单撕。
      //
      // Review Fix 5 (Minor): 下面这两次写入（限制账 open /
      // customerPendingActionService.set）不在同一事务里，中途崩溃会留下不
      // 一致状态。当前顺序（先 restrict 再写 pendingAction）是故意的
      // fail-safe 排列：如果崩在两次写入之间，客户已经被限制、只是暂时看不到
      // 补料入口（偏保守，不出事）；反过来的顺序会在中途崩溃时出现"入口已经
      // 暴露但限制还没落地"的窗口，更危险。不要因为"看起来能合并成一次"把这
      // 个顺序调换——它是 load-bearing 的。
      const restrictionCause = hasSanction
        ? ('SANCTION' as const)
        : exposeToCustomer
          ? ('KYT_REJECTED_SOFT' as const)
          : ('KYT_REJECTED_HARD' as const);
      const { restrictionNo, created: restrictionCreated } =
        await this.customerRestrictionsService.open({
          customerId: swap.ownerId,
          cause: restrictionCause,
          reason: `Swap ${swap.swapNo} KYT rejected`,
          caseRef: swap.swapNo,
          openedBy: 'system',
        });

      // tipping-off 线：制裁调查绝不能提示客户；只有「这次是软线」且「这个客户
      // 从未被硬线过」才登记补料入口（exposeToCustomer 已在上方算好）。
      //
      // 2026-08-17 材料请求账：从 customerPendingActionService.set() 换成逐条
      // 登记材料账。旧写法是 customer_main 上一个**单值指针**，只取
      // actions[0]，同一客户第二笔单软线拒还会把第一笔整个盖掉 —— 那正是本轮
      // 要治的病。现在一条 action 一行，各交各的、各撕各的。
      //
      // ⚠️ 本段必须留在上面 open() 之后：登记材料请求 = 暴露入口，
      // fail-safe 顺序是 load-bearing 的（见上方注释），不要合并或调换。
      if (exposeToCustomer) {
        const customer = await this.prisma.customerMain.findUnique({
          where: { id: swap.ownerId },
          select: { id: true, sumsubApplicantId: true },
        });
        if (customer?.sumsubApplicantId) {
          // register() 不像旧 set() 天然幂等 —— externalActionId 是材料账的
          // @unique 键，重复登记同一条会撞 P2002 而不是静默覆盖。先查一次这笔
          // swap 名下已登记的活行，跳过已在账上的 action，防止 webhook 重投 /
          // ingestion 重试在部分失败后把这个 swap 卡死在永久 P2002 循环里
          // （deposit/withdraw 的 applicant-actions service 是同一个防护）。
          const live = await this.materialRequests.listLiveByOrder('SWAP', swap.swapNo ?? '');
          const liveExternalIds = new Set(live.map((r) => r.externalActionId));
          for (const action of actions) {
            if (liveExternalIds.has(action.externalActionId)) continue;
            await this.materialRequestIssuer.register({
              customerId: customer.id,
              sumsubApplicantId: customer.sumsubApplicantId,
              materialType: 'SOURCE_OF_FUNDS',
              levelName: 'wave3-action-sof-refresh',
              applicantActionId: action.applicantActionId,
              externalActionId: action.externalActionId,
              orderDomain: 'SWAP',
              orderRef: swap.swapNo,
              origin: 'SUMSUB_PUSHED',
              reason: `Swap ${swap.swapNo} KYT rejected — additional materials required`,
              issuedBy: 'SYSTEM',
              // 便签上面已经开好了（restrictionNo 在手），这里不重复开 ——
              // register 的 restrict=false 表示「不要再开一张」，不表示「不摁人」。
              // existingRestrictionNo 把已经开好的那张便签接进这一行，否则
              // restrictionNo 恒为 null，GREEN 复核时 autoRelease 永远不会被调用
              // （2026-08-18 修复：客户交齐材料后限制原地不动、永久卡死）。
              restrict: false,
              existingRestrictionNo: restrictionNo,
              actor: { actorType: 'SYSTEM', userId: 'SYSTEM', userNo: 'SYSTEM', role: 'SYSTEM', roleCodes: ['SYSTEM'] } as any,
            });
          }
        }
      }
      // 硬线（含制裁）：一条材料请求都不登记 —— 客户端因此结构上没有任何入口。
      // 旧写法这里是 set(null) 把可能残留的软线指针清空；单指针没了之后不需要
      // 这一步，因为软线登记的是**属于那笔单**的行，不会被这笔硬线单波及。
      // 真要收口历史入口，靠的是 hardLineDispositionedAt 这个 sticky 标记
      // （下面仍然照常盖章），而不是清指针。
      if (hasSanction) {
        await this.customerPendingActionService.markHardLineDisposition(swap.ownerId);
      }

      await this.auditLogsService.recordSystem({
        action: AuditActions.SWAP_KYT_REJECTED_DISPOSED,
        entityType: AuditEntityTypes.SWAP_TRANSACTION,
        entityId: swap.id,
        entityNo: swap.swapNo || undefined,
        traceId: swap.traceId ?? undefined,
        workflowType: AuditWorkflowTypes.SWAP,
        entityOwnerType: swap.ownerType,
        entityOwnerId: swap.ownerId,
        // Review Fix 4 (Minor): business key alongside the UUID — this is the
        // record explaining a tipping-off decision to an investigator.
        entityOwnerNo: swap.ownerNo || undefined,
        reason: hasSanction
          ? 'Sanction hit — customer not notified (tipping-off)'
          : alreadyHardLined
          ? 'Restricted; customer previously hard-lined on another swap — not notified (sticky silence)'
          : exposeToCustomer
          ? 'Restricted; re-verification action exposed to customer'
          : 'Restricted; no action available — customer not notified',
        metadata: {
          hasSanction,
          actionCount: actions.length,
          exposeToCustomer,
          alreadyHardLined,
          // Review Fix 4 (Minor), amended 2026-08-18: record every action shown,
          // not just actions[0] — the single-pointer bug this task fixes was an
          // instance of exactly that pattern, so this audit metadata must not
          // repeat it (an investigator reconstructing this decision needs the
          // full list, not just the first row).
          actionIds: exposeToCustomer ? actions.map((a) => a.externalActionId) : undefined,
          restrictionNo,
          restrictionCause,
          restrictionCreated,
        },
        sourcePlatform: 'SYSTEM',
      });
    } catch (err) {
      // Review Fix 1 (Important): make the failure visible (audit + swap
      // needsReview) before letting it propagate. The rethrow is what makes
      // this recoverable — SwapKytVerdictHandler.handle doesn't catch, so the
      // ingestion dispatcher marks the webhook event FAILED and retries it;
      // applyKytVerdict's terminal-status guard now explicitly re-admits a
      // REJECTED swap's retry into this method instead of silently no-op'ing
      // (see that guard's comment). Best-effort: a failure in these two
      // side-writes must never mask the original error.
      await this.swapTransactionsService.setNeedsReview(swap.id, true).catch(() => undefined);
      await this.auditLogsService
        .recordSystem({
          action: AuditActions.SWAP_KYT_REJECTED_DISPOSITION_FAILED,
          entityType: AuditEntityTypes.SWAP_TRANSACTION,
          entityId: swap.id,
          entityNo: swap.swapNo || undefined,
          traceId: swap.traceId ?? undefined,
          workflowType: AuditWorkflowTypes.SWAP,
          entityOwnerType: swap.ownerType,
          entityOwnerId: swap.ownerId,
          entityOwnerNo: swap.ownerNo || undefined,
          reason: err instanceof Error ? err.message : 'Reject disposition failed',
          sourcePlatform: 'SYSTEM',
        })
        .catch(() => undefined);
      throw err;
    }
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
   * Rebuild the leg-accounting context (SwapSettleCtx) from a persisted swap
   * row. Moved verbatim out of the old executeSwap transaction (Task 4) —
   * legs are no longer built at initiateSwap time, so applyKytVerdict
   * (Task 6) calls this once the sell leg clears Sumsub KYT to reconstruct
   * the same ctx that used to be computed inline before the swap row existed.
   */
  private async buildLegContext(swap: any, tx: any): Promise<SwapSettleCtx> {
    const [fromAsset, toAsset] = await Promise.all([
      tx.asset.findUnique({ where: { id: swap.fromAssetId }, select: { decimals: true, currency: true, type: true } }),
      tx.asset.findUnique({ where: { id: swap.toAssetId }, select: { decimals: true, currency: true, type: true } }),
    ]);
    const fromCurrency = fromAsset?.currency || swap.fromAssetCode || '';
    const toCurrency = toAsset?.currency || swap.toAssetCode || '';
    const fromDecimals = fromAsset?.decimals ?? 8;
    const toDecimals = toAsset?.decimals ?? 8;
    const fromLedger = this.resolveLedger(fromCurrency);
    const toLedger = this.resolveLedger(toCurrency);

    return {
      swapId: swap.id,
      swapNo: swap.swapNo,
      ownerId: swap.ownerId,
      fromIsFiat: fromAsset?.type === 'FIAT',
      fromAssetId: swap.fromAssetId,
      toAssetId: swap.toAssetId,
      fromLedger,
      toLedger,
      fromCurrency,
      toCurrency,
      fromAmount: new Prisma.Decimal(swap.fromAmount),
      grossToAmount: new Prisma.Decimal(swap.toAmount),
      feeAmount: new Prisma.Decimal(swap.feeAmount ?? 0),
      fromDecimals,
      toDecimals,
    };
  }

  /**
   * Unified create-leg helper. Single code path for the four leg-build sites:
   *   - onKytApproved leg1 build      (legSeq=1, attempt=1)
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
    // Task 9：推下一腿之前查客户级能力闸。三域里兑换是唯一漏掉这道的。
    if (!(await this.assertSwapCustomerAccessOrHalt(swap, 'leg-confirmed'))) return;
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
      await this.swapTransactionsService.markStatus(swap.id, SwapTransactionAction.SUCCESS, client);
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
  /**
   * 客户级能力闸（Task 9 补齐）。兑换此前只在 initiateSwap() 建单前查一次，
   * PROCESSING 中 4 腿照常推完 —— 客户在推腿途中被摁住也拦不住，这是三域里
   * 唯一漏掉的一处。复刻提现范式：命中则停推 + 审计 + 返回 false，调用方立即 return。
   *
   * 注意：兑换没有 FROZEN 态（SwapTransactionStatus 只有 4 个活态），所以这里
   * 不改状态机，只 setNeedsReview + 停止推进，留在 PROCESSING 等人工处置。
   */
  private async assertSwapCustomerAccessOrHalt(swap: any, stage: string): Promise<boolean> {
    const access = await this.customerAccessService.resolve(swap.ownerId);
    if (!access.blocked.has('SWAP')) return true;

    this.logger.warn(
      `Swap capability gate FAIL at ${stage}: swap ${swap.swapNo} — SWAP blocked → halting leg progression`,
    );
    await this.swapTransactionsService.setNeedsReview(swap.id, true).catch(() => undefined);
    await this.auditLogsService.recordSystem({
      action: AuditActions.SWAP_LEG_HALTED_BY_RESTRICTION,
      entityType: AuditEntityTypes.SWAP_TRANSACTION,
      entityId: swap.id,
      entityNo: swap.swapNo || undefined,
      entityOwnerType: swap.ownerType,
      entityOwnerId: swap.ownerId,
      traceId: swap.traceId || undefined,
      workflowType: AuditWorkflowTypes.SWAP,
      reason: `Customer SWAP capability restricted at ${stage} — in-flight swap leg progression halted`,
      metadata: { swapNo: swap.swapNo, stage },
      sourcePlatform: 'SYSTEM',
    });
    return false;
  }

  /**
   * 客户被贴了「卡住全部能力」的便签 → 停掉他名下所有非终态兑换的推腿。
   */
  @OnEvent(DomainEventNames.CUSTOMER_RESTRICTION_OPENED, { async: true })
  async onCustomerRestrictionOpened(event: {
    customerId: string;
    restrictionNo: string;
    cause: string;
    blocksAllCapabilities: true;
    traceId: string;
  }): Promise<void> {
    const inflight = await this.swapTransactionsService.findNonTerminalByOwner(event.customerId);
    for (const sw of inflight) {
      try {
        await this.assertSwapCustomerAccessOrHalt(sw, `restriction:${event.restrictionNo}`);
      } catch (e) {
        this.logger.warn(
          `Failed to halt in-flight swap ${sw.swapNo} for restriction ${event.restrictionNo}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }

}
