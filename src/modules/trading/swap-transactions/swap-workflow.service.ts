import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  ApprovalStatuses,
} from '../../governance/approvals/constants/approval.constants';
import { AuditOutcome, AuditCategory, AuditSubjectRole, AuditSubjectInput, AuditActorContext } from '../../audit-logging/dto/audit-log.dto';
import { SwapQuoteService } from '../swap-fee-level/swap-quote.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { SwapTransactionsService } from './swap-transactions.service';
import { computeSpreadAmount } from '../shared/spread-amount.util';
import { SwapTransactionAction, SwapTransactionStatus } from './dto/swap-transaction.dto';
import { SwapLegAccounting, SwapSettleCtx } from './swap-leg-accounting';
import {
  SUMSUB_TXN_CLIENT,
  SumsubTxnClient,
} from '../../sumsub-shared/sumsub-txn-client.interface';
import { type SceneTag, type DispoTag } from '../../sumsub-shared/scene-tags';
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
import { CustomerAccessService, NEUTRAL_DENIAL } from '../../identity/customers/customer-access.service';
import { CustomersService } from '../../identity/customers/customers.service';
import { MaterialRequestsService } from '../../identity/material-requests/material-requests.service';
import { MaterialRequestIssuerService } from '../../identity/material-requests/material-request-issuer.service';
import { L1GateService, l1ReasonCodeOf } from '../shared/l1-gate/l1-gate.service';
import type { L1Check } from '../shared/l1-gate/l1-gate.types';

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
    private readonly customersService: CustomersService,
    private readonly customerAccessService: CustomerAccessService,
    private readonly materialRequests: MaterialRequestsService,
    private readonly materialRequestIssuer: MaterialRequestIssuerService,
    private readonly l1Gate: L1GateService,
    // 波五 Task 3：initiateUnfreeze/initiateRefund 走 maker-checker 正门。
    private readonly approvalsService: ApprovalsService,
    // 战役丙波一 T7 修（fix round 1，T10 走查逮）：notifyOrderStatusChange 挂在
    // 这一层而不是 SwapTransactionsService.markStatus 内部——markStatus 不拥有
    // 事务边界，通知必须在真正控制 $transaction 生命周期的这一层、在 resolve
    // 之后才调用，否则会在 tx 内自锁到 Prisma 默认超时、拖累外层事务回滚。
    private readonly notificationsService: NotificationsService,
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
    // 波五 T4（创建即冻）：改用 assertTradingIntake——DISCLOSED 客户仍在这里被中性
    // 拒绝（响应体与旧 assertTradingEligibility 逐字一致）；SILENT-only（制裁）客户
    // 改为放行并回 fold=true，订单照常建、建完立即冻（见下方"建单后冻结段"）——
    // 拒单本身就是向客户泄露"你被盯上了"。
    const intake = await this.customerAccessService.assertTradingIntake(ownerId, 'SWAP');
    const fold = intake.fold;

    // ── L1 Transaction Limit gate (A + B) — evaluate BEFORE quote consumption ──
    // Peek the quote OUTSIDE the transaction only to get the from-asset + amount
    // for the gate. A missing quote is NOT thrown here on purpose: it falls
    // through to the in-transaction getActiveQuoteOrThrow, which rejects it via
    // the existing audited SWAP_FAILED path (skipping the gate for a nonexistent
    // quote gates nothing — no swap can be created without a valid quote).
    let gateValuation: GateValuation | null = null;
    const quotePeek = await this.prisma.swapQuote.findUnique({
      where: { id: quoteId },
      select: { fromAssetId: true, amountIn: true, toAssetId: true },
    });
    if (quotePeek) {
      gateValuation = await this.limitGateService.evaluate({
        operationType: 'SWAP',
        customerId: ownerId,
        assetId: quotePeek.fromAssetId,
        amount: new Prisma.Decimal(quotePeek.amountIn),
      });
    }

    // ── L1 闸门收口（第四批）── 与提现侧同口径：**上面已经快速失败过一轮**，
    // 这里重跑一次是为了拿到逐项**可回显的快照**（上面抛的是中性错误，拿不到明细）。
    //
    // ⚠️ 订正（B2 审查）：兑换域并非「此前完全没查资格/限制」—— 上面的
    // assertTradingIntake(ownerId,'SWAP') 内部就是 intakeDecision(资格+限制)，
    // 且对非 DEPOSIT 还多跑一层 assertTradingReady，**严格强于** L1 这两项判定；
    // 对 DISCLOSED 客户，下面的 BLOCK 分支逻辑上不可达，只在上面与本行之间的
    // 毫秒级竞态窗口（便签刚被开出来）才触发——兜底保留。
    //
    // ⚠️ 波五 T4 订正：**fold 客户是这条"不可达"结论的例外**——上面特意放行了
    // SILENT-only 命中，这里的快照会如实再算出一次 CUSTOMER_RESTRICTION FAIL
    // （BLOCK），不是竞态，是必然。下面 BLOCK 分支据此判断是否放行建单继续走。
    //
    // 快照口径（**逐格只写这一刻真判过的**，写不实的 PASS = 伪证据）：
    //  · SINGLE/CUMULATIVE_LIMIT、QUOTE_VALIDITY —— 限额闸已在上面按 quotePeek 跑过；
    //    报价的有效性由建单事务内的 getActiveQuoteOrThrow 把关，未过则整单回滚不留单。
    //  · TRADING_READINESS —— :210 的 assertTradingReady 已过（本行之前，确凿）。
    //  · ACCOUNT_READINESS —— 双边收款账户由建单事务内的 hasReceivingAccount 无条件
    //    校验，未过则整单回滚：**能落库的快照，这一格必然为真**。
    //  · BALANCE_SUFFICIENCY —— 第四批补：建单前无条件校验卖出侧可用余额（本行
    //    之前跑过、跑不过直接抛出不留单），跑在本次 evaluate() 调用之前，故可写 PASS。
    const preChecks: L1Check[] = [];
    if (quotePeek) {
      preChecks.push({
        code: 'SINGLE_LIMIT', outcome: 'PASS',
        detail: `Per-transaction limits passed (${quotePeek.amountIn})`,
      });
      preChecks.push({
        code: 'CUMULATIVE_LIMIT', outcome: 'PASS',
        detail: `Cumulative limit passed (AED ${gateValuation?.grossAedValue ?? '—'})`,
      });
      preChecks.push({
        code: 'QUOTE_VALIDITY', outcome: 'PASS',
        detail: 'Quote valid (checked inside the order-creation transaction; the whole order rolls back if it fails)',
      });
    }
    preChecks.push({
      code: 'ACCOUNT_READINESS', outcome: 'PASS',
      detail: 'Both-side receiving accounts ready (checked inside the order-creation transaction; the whole order rolls back if it fails)',
    });
    preChecks.push({
      code: 'TRADING_READINESS', outcome: 'PASS',
      detail: 'Trading-start preconditions satisfied (assertTradingIntake passed before order creation)',
    });

    // ── 建单前余额校验（第四批补）──
    // 提现建单即压 TB pending 锁额,余额不足当场被 TB 拒;兑换此前**没有这道闸**,
    // 要等 KYT 过了建第一条腿才发现钱不够 —— 那时报价已烧、KYT 已过,而 PROCESSING
    // 没有失败出边,单子永久卡死。所以必须前移到建单前。
    //
    // ⚠️ 2026-08-22 终审 I2 订正：这道校验**只读不锁**,因此**只堵住单笔场景**,原注释
    // 写「堵住」是说过头了。它比一下 getCustomerAvailableBalance 就完事,**不像提现
    // 那样压 TB pending**(available = creditsPosted − debitsPosted − debitsPending,
    // 而兑换要等 KYT 通过建腿才写 pending)。并发同币种多单照样各自通过:客户 100 USDT,
    // A 用 60 过闸落 COMPLIANCE_PENDING,A 裁决未回时 B 又用 60 —— 可用仍读到 100,
    // B 也过闸;两笔都 kyt_approved → PROCESSING,A 抽干余额,B 的第一条腿失败 →
    // B 永久卡在 PROCESSING + needsReview,正是这道闸想防的那个洞。
    // 真正的修法是建单即压 TB pending、与提现同形状——并发锁类问题按 CLAUDE.md
    // §4 走 PRODUCTION-NOTES.md（已登记，2026-08-22 终审 I2），不进 BACKLOG，本批未做。
    //
    // 在 Decimal 空间比,不在 bigint 空间比：`decimalToBigint` 是
    // swap-leg-accounting.ts 的**私有**方法,本文件拿不到;而
    // getCustomerAvailableBalance 返回的是账本最小单位的 bigint,
    // 除以 10^decimals 降回业务单位即可,不必新造 helper。
    if (quotePeek) {
      const sellAsset = await this.prisma.asset.findUnique({
        where: { id: quotePeek.fromAssetId },
        select: { currency: true, decimals: true },
      });
      if (sellAsset) {
        const bal = await this.accountingService.getCustomerAvailableBalance(
          ownerId,
          sellAsset.currency,
        );
        const availableDecimal = new Prisma.Decimal(bal.available.toString()).div(
          new Prisma.Decimal(10).pow(sellAsset.decimals),
        );
        const needed = new Prisma.Decimal(quotePeek.amountIn);
        if (availableDecimal.lt(needed)) {
          throw new BadRequestException({
            code: 'INSUFFICIENT_BALANCE',
            assetCode: sellAsset.currency,
            message: `Insufficient balance: need ${needed.toString()} ${sellAsset.currency}, available ${availableDecimal.toString()}`,
          });
        }
        preChecks.push({
          code: 'BALANCE_SUFFICIENCY', outcome: 'PASS',
          detail: `Sell-side balance sufficient (need ${needed.toString()} ${sellAsset.currency}, available ${availableDecimal.toString()})`,
        });
      }
    }

    const swapAssetIds = quotePeek ? [quotePeek.fromAssetId, quotePeek.toAssetId] : [];
    const l1 = await this.l1Gate.evaluate({
      domain: 'SWAP',
      customerId: ownerId,
      assetIds: swapAssetIds,
      preChecks,
    });
    if (l1.verdict === 'BLOCK') {
      const failed = l1.checks.filter((c) => c.outcome === 'FAIL');
      // 波五 T4：fold 客户放行的唯一条件——CUSTOMER_RESTRICTION 是这一刻快照里
      // **唯一**的 FAIL。还有别的 FAIL（资产停用等）与 tipping-off 无关，走原
      // BLOCK 路——普通客户同款报错，不因 SILENT 而额外放行。
      const isFoldOnlyRestriction =
        fold && failed.length === 1 && failed[0].code === 'CUSTOMER_RESTRICTION';
      if (!isFoldOnlyRestriction) {
        // 波二·法一：被拦下也留痕。单未建、无单号——主体是客户，兑换涉及的两侧资产当次主体。
        const actorNo = customer?.customerNo ?? ownerId;
        const blockedAssets: Array<{ assetNo: string | null }> = swapAssetIds.length
          ? await this.prisma.asset.findMany({ where: { id: { in: swapAssetIds } }, select: { assetNo: true } })
          : [];
        await this.auditLogsService.recordByActor(
          {
            action: 'SWAP_L1_BLOCKED',
            actionDomain: 'SWAP',
            category: AuditCategory.BUSINESS,
            primarySubjectType: 'CUSTOMER',
            primarySubjectNo: actorNo,
            ownerCustomerNo: customer?.customerNo ?? undefined,
            outcome: AuditOutcome.DENIED,
            reasonCode: failed[0] ? l1ReasonCodeOf(failed[0].code) : 'L1_BLOCK',
            reason: `L1 blocked swap: ${failed.map((c) => `${c.code} — ${c.detail}`).join('; ')}`,
            subjects: [
              ...(customer?.customerNo ? [{ subjectType: 'CUSTOMER', subjectNo: customer.customerNo, subjectRole: AuditSubjectRole.OWNER }] : []),
              ...blockedAssets.filter((a) => a.assetNo).map((a) => ({ subjectType: AuditEntityTypes.ASSET, subjectNo: a.assetNo as string, subjectRole: AuditSubjectRole.RELATED })),
            ],
            metadata: { quoteId, assetIds: swapAssetIds, l1Snapshot: l1 },
            requestId: `SWAP_L1_BLOCKED_${actorNo}_${randomUUID()}`,
            sourcePlatform: 'CUSTOMER_API',
          } as any,
          { actorType: 'CUSTOMER', actorNo, actorDisplayName: actorNo, actorRolesAtTime: ['CUSTOMER'] },
        );
        throw new ForbiddenException({
          code: 'L1_GATE_BLOCKED',
          // 中性文案 —— 直接引用 CustomerAccessService 的那一份（禁止手抄副本：
          // 拒绝理由有差异即可被指纹识别）。绝不透出 cause / visibility。
          message: NEUTRAL_DENIAL,
        });
      }
      // fold 路径：不写 SWAP_L1_BLOCKED（那是真 BLOCK 的留痕），L1 快照照记
      // CUSTOMER_RESTRICTION FAIL（l1 变量不改，供 §4 管理台展示），继续建单。
    }

    const now = new Date();
    const swapNo = generateReferenceNo('SWP');
    const correlationId = randomUUID();

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
          // Ledger precheck: fail fast (and roll back the quote consume + swap
          // row together with the rest of this transaction) if the asset's
          // settlement currency isn't registered in TB_LEDGERS. Without this,
          // the same miss only surfaces later inside applyKytVerdict's
          // buildLegContext — by then the compliance verdict has already been
          // written outside that transaction, leaving the swap stuck in
          // COMPLIANCE_PENDING with the quote burned and the KYT check wasted.
          // (波一 T4：同一次读取也拿 network——R4 收款账户校验现在按网络找钱包。)
          const assetRow = await tx.asset.findUnique({
            where: { id: asset.id },
            select: { currency: true, network: true },
          });
          if (!(await this.walletQuery.hasReceivingAccount(ownerId, assetRow?.network ?? '', tx))) {
            throw new BadRequestException({
              code: 'RECEIVING_ACCOUNT_REQUIRED',
              assetCode: asset.code,
              message: `Create a receiving account for ${asset.code} first, then swap`,
            });
          }
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
        const spreadAmount = computeSpreadAmount(fromAmount, new Prisma.Decimal(quote.marketRate), toAmount, toDecimals);

        // Create the swap row in COMPLIANCE_PENDING — no legs are booked here.
        // Legs are built only after the sell leg clears Sumsub KYT (Task 6
        // applyKytVerdict / onKytApproved).
        const createdSwap = await this.swapTransactionsService.create({
          swapNo, quoteId: quote.id, quoteNo: quote.quoteNo,
          correlationId, // 审计主线：SWAP_CREATED=START 在此铸根，此后全链 INHERIT
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
          l1Snapshot: JSON.stringify(l1),
          status: SwapTransactionStatus.COMPLIANCE_PENDING,
        }, tx);

        await this.auditLogsService.recordByActor(
          {
            action: 'SWAP_CREATED',
            actionDomain: 'SWAP',
            category: AuditCategory.BUSINESS,
            primarySubjectType: AuditEntityTypes.SWAP_TRANSACTION,
            primarySubjectNo: createdSwap.swapNo || undefined,
            ownerCustomerNo: createdSwap.ownerNo || undefined,
            correlationId,
            amount: String(createdSwap.fromAmount),
            currency: quote.fromAssetCode,
            subjects: [
              { subjectType: AuditEntityTypes.SWAP_TRANSACTION, subjectNo: createdSwap.swapNo, subjectRole: AuditSubjectRole.PRIMARY },
              ...(createdSwap.ownerNo ? [{ subjectType: 'CUSTOMER', subjectNo: createdSwap.ownerNo, subjectRole: AuditSubjectRole.OWNER }] : []),
            ],
            traceId,
            reason: `Swap executed from quote ${quote.quoteNo || quote.id}`,
            metadata: { quoteId: quote.id, quoteNo: quote.quoteNo, lockedFromAmount: String(createdSwap.fromAmount) },
            requestId: `SWAP_CREATED_${createdSwap.swapNo}_${randomUUID()}`,
            sourcePlatform: 'CUSTOMER_API',
          } as any,
          { actorType: 'CUSTOMER', actorNo: quote.ownerNo || ownerId, actorDisplayName: quote.ownerNo || ownerId, actorRolesAtTime: ['CUSTOMER'] },
          tx,
        );

        // 站3·出生锁（业主 2026-08-27 裁定）：下单即画圈——按腿1（卖出腿）的记账
        // 条目、attempt=1 预占 fromAmount。结算开始时腿1不再自画（见 createLeg），
        // 编号天然衔接 postLeg；拒绝/冻结落地擦圈退余额（终态不押钱，押人靠限制账）。
        const birthCtx = await this.buildLegContext(createdSwap, tx);
        const birthSpecs = buildSwapLegPlan({ fromIsFiat: birthCtx.fromIsFiat });
        await this.swapLegAccounting.initiateLegPending({ ...birthCtx, attempt: 1 }, birthSpecs[0]!, tx);

        return createdSwap;
      });
    } catch (error) {
      // Best-effort terminal audit — swap row may or may not exist depending
      // on the failure stage. We carry the quote.traceId (captured at the top
      // of the transaction) and the pre-allocated swapNo for operator correlation.
      // 站3-β：执行失败不单独起名——SWAP_CREATED 一码双结局（行可能未落库，
      // 无旅程号可铸，S 模式对失败路不强制）。
      await this.auditLogsService
        .recordSystem({
          action: 'SWAP_CREATED',
          actionDomain: 'SWAP',
          category: AuditCategory.BUSINESS,
          primarySubjectType: AuditEntityTypes.SWAP_TRANSACTION,
          primarySubjectNo: swapNo,
          outcome: AuditOutcome.FAILED,
          reasonCode: 'EXECUTION_ERROR',
          subjects: [{ subjectType: AuditEntityTypes.SWAP_TRANSACTION, subjectNo: swapNo, subjectRole: AuditSubjectRole.PRIMARY }],
          reason: error instanceof Error ? error.message : 'Swap execution failed',
          requestId: `SWAP_CREATED_${swapNo}_${randomUUID()}`,
          sourcePlatform: 'SYSTEM',
          traceId: traceId ?? undefined,
        } as any)
        .catch(() => undefined);
      throw error;
    }

    // 波五 T4（创建即冻）：建单事务已提交——SILENT-restricted 客户的单现在立即
    // 冻结（建单与冻结两步落库、审计各写各的，不追求同事务原子，spec §2.1）。
    // 放在 submitSumsubTxnOut 之前：被冻的单不该再送一轮白跑的 KYT 打分——Task 3
    // 的 triggerUnfreezeRescore 早为"FROZEN 单从未提交过 Sumsub"留好退路
    // （sumsubTxnIdOut 为空时 warn+return，解冻续审时不炸），解冻那一刻自然会
    // 补上这一轮打分。冻结动作本身逐字镜像 onCustomerRestrictionOpened 的
    // COMPLIANCE_PENDING+SANCTION 分支（:2197 附近）——押锁不放，不调
    // releaseBirthLock。
    if (fold) {
      await this.prisma.$transaction(async (tx: any) => {
        await this.swapTransactionsService.markStatus(
          swap.id,
          SwapTransactionAction.FREEZE,
          tx,
          { rejectReason: 'SANCTION_APPLICANT', operator: 'INTAKE_FOLD' },
        );
      });
      // 审计调用独立 catch（与 onCustomerRestrictionOpened 同款，2026-08-20
      // 修订沿用）：审计失败不该让一笔已经成功建好+冻好的单在这里向上抛出、把
      // HTTP 响应变成 500——状态跃迁已经落库成功，只以 logger.error 现身。
      await this.swapAudit(swap, {
        action: 'SWAP_FROZEN',
        reason: 'created by SILENT-restricted customer — folded at intake',
        fromStatus: SwapTransactionStatus.COMPLIANCE_PENDING,
        toStatus: SwapTransactionStatus.FROZEN,
      }).catch((err) => {
        this.logger.error(
          `Failed to write SWAP_FROZEN audit for ${swap.swapNo} (create-time fold): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
      // T7 修：$transaction 已经 resolve（提交完成），这里才通知。
      await this.notifySwapStatusChange(swap, SwapTransactionStatus.COMPLIANCE_PENDING, SwapTransactionStatus.FROZEN);
      // 返回前重取视图：内存里的 `swap`（建单事务的落库结果）没有 fromAsset/
      // toAsset 关系（create() 建单时未 include），toCustomerSwapView 拼资产
      // 投影需要它们；findByIdInternal 带齐客户面需要的全部关系。status 收敛
      // 不受影响——COMPLIANCE_PENDING 与 FROZEN 收敛后是同一个值，重取只为了
      // 资产字段完整。
      const frozenView = await this.swapTransactionsService.findByIdInternal(swap.id);
      return this.swapTransactionsService.toCustomerSwapView(frozenView);
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

      await this.swapAudit(swap, {
        action: 'SWAP_KYT_SUBMITTED',
        reason: 'Swap sell-leg submitted to Sumsub KYT',
        metadata: { sumsubTxnId: res.txnId, scoringAction: res.scoringResult?.action, direction: 'out' },
      });
    } catch (err) {
      this.logger.error(
        `submitSumsubTxnOut failed for swap ${swapId}: ${(err as Error).message} — staying in COMPLIANCE_PENDING for retry`,
      );
      await this.swapAudit(swap ?? { swapNo: undefined }, {
          action: 'SWAP_KYT_SUBMITTED',
          outcome: AuditOutcome.FAILED,
          reasonCode: 'SUBMIT_ERROR',
          reason: err instanceof Error ? err.message : 'Sumsub KYT submit failed',
          metadata: { direction: 'out' },
        })
        .catch(() => undefined);
    }
  }

  // 已终态:进入 applyKytVerdict 时直接 no-op(幂等,防终态后迟到/重投的 webhook)。
  private static readonly KYT_VERDICT_TERMINAL_STATUSES = new Set([
    SwapTransactionStatus.SUCCESS,
    SwapTransactionStatus.REJECTED,
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
   *              REJECTED,零记账(不建任何 leg、不碰 TB)——移交处置（handleRejectDisposition，已落地且幂等）。
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
      /** Task A6：场景 tag（Sumsub 规则引擎自动打，说命中了什么）。 */
      sceneTag?: SceneTag;
      /** Task A6：处置 tag（合规官/MLRO 手工打，说该怎么办）。兑换只认 FROZEN_BY_MLRO。 */
      dispoTag?: DispoTag;
      detailRaw?: unknown;
      applicantActions?: { applicantActionId: string; externalActionId: string }[];
    },
  ): Promise<void> {
    const swap = await this.swapTransactionsService.findByIdInternal(swapId);
    if (!swap) {
      this.logger.warn(`applyKytVerdict: swap ${swapId} not found`);
      return;
    }

    const status = swap.status as SwapTransactionStatus;

    // 2026-08-20：FROZEN 单一律忽略后续裁决 —— 与第一批（2026-08-19）在充值/
    // 提现 decideVerdictLanding 里那条 `if (status === FROZEN) return 'IGNORE'`
    // 同源。刻意**不**放进 KYT_VERDICT_TERMINAL_STATUSES：那个集合的语义是
    // 「终态所以忽略」，这里的语义是「冻了所以忽略」，两者混在一起以后没人
    // 分得清。
    // ⚠️ 这一行是防死信的：不写则 Sumsub 重投同一条 rejected webhook 会一路
    // 走到 markStatus(FREEZE)——FREEZE 不是 FROZEN 的合法出边（2026-09-14 起
    // FROZEN 是中间态，出边只有 RESUME/REJECT_REFUND，两条都要走 Task 3 的
    // 审批消费，不归迟到的 KYT webhook 驱动）——照样抛 Invalid transition，
    // 异常未捕获 → 事件标 FAILED → 三次重试后进死信。
    if (status === SwapTransactionStatus.FROZEN) {
      this.logger.debug(`applyKytVerdict no-op: swap ${swapId} is FROZEN`);
      await this.recordVerdictIgnored(swap, input, status);
      return;
    }

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
      // 第一批 (2026-08-19)：忽略 ≠ 静默。位置刻意在 carve-out 之后 —— 走到这里
      // 说明这条裁决既不推状态机、也不触发处置，是真正的 no-op，才该记 IGNORED。
      await this.recordVerdictIgnored(swap, input, status);
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
        await this.swapAudit(swap, {
          action: 'SWAP_POST_APPROVAL_VERDICT',
          reason: `KYT verdict '${input.verdict}' received after swap entered PROCESSING — no state-machine action taken`,
          metadata: { verdict: input.verdict },
        }, tx);
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
      // T7 修：approvedNext 提到事务外层作用域，$transaction resolve 之后才
      // 用它调 notifySwapStatusChange——这条分支无早退，赋值恒发生。
      let approvedNext: string | null = null;
      await this.prisma.$transaction(async (tx) => {
        await this.swapTransactionsService.saveSumsubVerdict(swapId, verdictEvidence, tx);
        approvedNext = await this.swapTransactionsService.markStatus(swapId, SwapTransactionAction.KYT_APPROVED, tx, { operator: 'SUMSUB_KYT' });
        await this.swapAudit(swap, {
          action: 'SWAP_KYT_APPROVED',
          reason: 'Swap KYT verdict approved — proceeding to settlement',
          fromStatus: swap.status,
          toStatus: approvedNext,
        }, tx);
        const ctx = await this.buildLegContext(swap, tx);
        const legSpecs = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat });
        await this.createLeg(swap, legSpecs[0]!, ctx, 1, 1, swap.traceId ?? undefined, tx);
      });
      if (approvedNext) {
        await this.notifySwapStatusChange(swap, swap.status, approvedNext);
      }
      await this.submitSumsubTxnIn(swapId); // fire-and-forget，买入腿失败不阻断已放行的兑换
      return;
    }

    // 2026-08-20（Task 9）：客户本人命中制裁的落地边是 COMPLIANCE_PENDING
    // --FREEZE--> FROZEN，不是先落 COMPLIANCE_PENDING --KYT_REJECTED--> REJECTED
    // 再"补冻"——迁移表里 REJECTED 是零出边终态，事后再对它 markStatus(FREEZE)
    // 会撞 `Invalid transition: REJECTED + freeze`。判据必须在这次 markStatus 之
    // 前做出，所以这里独立算一次，调用类内 hasApplicantSanctionHit（与
    // handleRejectDisposition 内 Task 3 命门测试组钉住的那一次判定共用同一个
    // 私有谓词，同一个 input.sceneTag，同一条调用链）。
    // 2026-08-29（Task A6）：MLRO 手工冻结（dispoTag=FROZEN_BY_MLRO）与制裁命中
    // 客户本人是同一条落地边——都跳过 KYT_REJECTED，直接交给 handleRejectDisposition
    // 里的 FREEZE 分支。willFreeze 是两者的并集；hasSanction 单独留着，因为它还要
    // 驱动 restrictionCause='SANCTION'（SILENT/卡全部能力）与 tipping-off 判断，
    // MLRO 冻结不共享那两条语义（详见 handleRejectDisposition 里的辨析）。
    //
    // willFreeze 时这个 $transaction 只落证据，不碰状态机——FREEZE 的
    // markStatus + SWAP_FROZEN 审计交给下面的 handleRejectDisposition，那里已经
    // 是"先冻人（customerRestrictionsService.open）、再冻单（markStatus(FREEZE)）"
    // 的 fail-safe 顺序：open() 失败则 FREEZE 不会落地，单子退回原地
    // （COMPLIANCE_PENDING，因为这里跳过了自己的 markStatus）等下一次 webhook
    // 重投干净重跑；不会出现「单已经冻但人没限制」或「同一次裁决两次尝试
    // markStatus」的窗口。
    const hasSanction = this.hasApplicantSanctionHit(input.sceneTag);
    const willFreeze = hasSanction || input.dispoTag === 'FROZEN_BY_MLRO';

    // T7 修：rejectedNext 提到事务外层作用域——willFreeze 时事务内 `return`
    // 跳过 markStatus，rejectedNext 留 null，事务外按 null 不通知（这次裁决
    // 没有落到 REJECTED，没有迁移可通知）。
    let rejectedNext: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      await this.swapTransactionsService.saveSumsubVerdict(swapId, verdictEvidence, tx);
      if (willFreeze) return;
      rejectedNext = await this.swapTransactionsService.markStatus(swapId, SwapTransactionAction.KYT_REJECTED, tx, {
        rejectReason: 'KYT_REJECTED',
        operator: 'SUMSUB_KYT',
      });
      await this.swapAudit(swap, {
        action: 'SWAP_KYT_REJECTED',
        reason: 'Swap KYT verdict rejected — no settlement legs booked, sell-side birth lock released to balance',
        fromStatus: swap.status,
        toStatus: rejectedNext,
        metadata: {
          sceneTag: input.sceneTag ?? null,
          dispoTag: input.dispoTag ?? null,
          releasedFromAmount: String(swap.fromAmount),
        },
      }, tx);
    });
    if (rejectedNext) {
      await this.notifySwapStatusChange(swap, swap.status, rejectedNext);
    }
    // 出生锁擦圈：拒绝=终局，卖出侧预占退还客户余额。
    // willFreeze 时不放——2026-09-14 裁定翻案：FROZEN 押锁不放，这次裁决没有
    // 落到 REJECTED（上面 $transaction 内 `if (willFreeze) return;` 跳过了
    // KYT_REJECTED 迁移），锁不该在这里被这条"拒绝=终局"的擦圈规则误放；
    // FREEZE 落地边（handleRejectDisposition 内）现在也不放，锁的释放交给
    // RESUME 解冻续审后的正常结算，或 Task 3 的 REJECT_REFUND 拒退落地。
    if (!willFreeze) {
      await this.releaseBirthLock(swap, 'KYT rejected');
    }
    await this.handleRejectDisposition(swap, input);
  }

  /**
   * 忽略 ≠ 静默（第一批 · 2026-08-19，与充值/提现域镜像）。
   *
   * ⚠️ 调用点必须在 REJECTED/SUCCESS + rejected 的 carve-out **之后** ——
   * 那条 carve-out 会去跑 handleRejectDisposition（写 SWAP_KYT_REJECTED_DISPOSED），
   * 若在它之前写 IGNORED，同一事件会既"已忽略"又"已处置"，自相矛盾。
   *
   * requestId 拼 randomUUID 是有意为之（3 次写 3 行）。.catch 记 error 不哑吞。
   */
  private async recordVerdictIgnored(
    swap: any,
    input: { verdict: string; riskScore?: number | null },
    status: SwapTransactionStatus,
  ): Promise<void> {
    // swapNo 是 String?（schema），同文件所有兄弟审计一律 `|| undefined` 兜底；
    // requestId 拼同一个值，避免 swapNo 为 null 时拼出字面量 "..._null_<uuid>"。
    const entityNo = swap.swapNo || undefined;
    await this.swapAudit(swap, {
        action: 'SWAP_KYT_VERDICT_IGNORED',
        reason: `Late KYT verdict '${input.verdict}' ignored — swap is ${status} (terminal); existing verdict/evidence left untouched`,
        metadata: {
          verdict: input.verdict,
          status,
          riskScore: input.riskScore ?? null,
        },
      })
      .catch((err) => {
        this.logger.error(
          `SWAP_KYT_VERDICT_IGNORED audit failed for ${swap.swapNo}: ${err?.message}`,
        );
      });
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

      await this.swapAudit(swap, {
        action: 'SWAP_KYT_SUBMITTED',
        reason: 'Swap buy-leg submitted to Sumsub KYT (data-only, carries no verdict)',
        metadata: { sumsubTxnId: res.txnId, direction: 'in' },
      });
    } catch (err) {
      // 买入腿是纯数据腿，不承载裁决 —— 失败只告警，绝不回滚已成交的兑换。但对运营
      // 来说失败才是真正要看见的一面（买入腿悄悄没喂给 Sumsub 会静默拉低客户行为
      // 画像的完整度）—— 补一条 SWAP_KYT_SUBMIT_FAILED 审计，与 submitSumsubTxnOut
      // 的失败路径对称。
      this.logger.error(`buy-leg KYT submit failed for swap ${swapId}: ${String(err)}`);
      await this.swapAudit(swap ?? { swapNo: undefined }, {
          action: 'SWAP_KYT_SUBMITTED',
          outcome: AuditOutcome.FAILED,
          reasonCode: 'SUBMIT_ERROR',
          reason: err instanceof Error ? err.message : 'Sumsub KYT buy-leg submit failed',
          metadata: { direction: 'in' },
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
   *   - customerRestrictionsService.open() is idempotent per (customerId, cause,
   *     caseRef) — see openWithin's existing-OPEN-row lookup — so a repeat call
   *     for the same restriction returns created:false instead of duplicating
   *     it. (Task 8 replaced the old .add(capability[]) call this note used to
   *     describe with open({cause}); the idempotency guarantee still holds.)
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
   * The client-facing read side (`MaterialRequestsClientController.listMine()`,
   * backed by `materialRequests.listLiveByCustomer()`) is a dumb accessor with
   * no conditional logic of its own — it only ever returns what got
   * registered here; the decision must never be re-derived on the read side.
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
   * `CustomersService.markHardLineDisposition` — the marker has no
   * clear/reset entry point on purpose).
   *
   * Review Fix 1 (Important): this entire body is wrapped in try/catch. A
   * throw here (SQLite lock, transient DB error, a service throwing
   * NotFoundException) must not vanish — see the call sites for how the
   * exception is used (propagated so the ingestion pipeline retries, and the
   * terminal-status guard in applyKytVerdict now explicitly allows a REJECTED
   * swap's retry to re-enter here instead of silently no-op'ing).
   */
  /**
   * 客户本人命中制裁（对手方命中 SANCTION_COUNTERPARTY 不算 —— 走普通软/硬线）。
   * 类内私有谓词：applyKytVerdict 和 handleRejectDisposition 两处判定读的是同一个
   * `input.sceneTag`、同一条调用链，抽出来只是去重，不是要跨这两处传参绑定。
   *
   * 只判 SANCTION_APPLICANT，不判 dispoTag===FROZEN_BY_MLRO ——两者虽然共享同一条
   * FREEZE 落地边（见调用方 willFreeze），但语义不同：这个谓词的结果还驱动
   * restrictionCause='SANCTION'（SILENT + 卡全部能力 + 只能 MLRO 解 + 客户级
   * sticky 永久沉默）与 tipping-off 措辞——那是「这个人」的制裁调查专属语义，
   * MLRO 手工冻结是「这一笔单」的处置决定，不共享这两条（见 handleRejectDisposition
   * 内 willFreeze 的辨析）。
   */
  private hasApplicantSanctionHit(sceneTag?: SceneTag): boolean {
    return sceneTag === 'SANCTION_APPLICANT';
  }

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
      // 2026-08-20（Task 9）：本单裁决驱动的冻单判据需要读当前状态 —— 只有
      // COMPLIANCE_PENDING 是 FREEZE 的唯一入边，PROCESSING/终态不能再冻。
      status: string;
    },
    input: {
      verdict: 'approved' | 'rejected';
      /** scoringResult.score —— 与提现契约对齐（parity 2026-08-14），approved 也带。 */
      riskScore?: number | null;
      /** Task A6：场景 tag（Sumsub 规则引擎自动打，说命中了什么）。 */
      sceneTag?: SceneTag;
      /** Task A6：处置 tag（合规官/MLRO 手工打，说该怎么办）。兑换只认 FROZEN_BY_MLRO。 */
      dispoTag?: DispoTag;
      detailRaw?: unknown;
      applicantActions?: { applicantActionId: string; externalActionId: string }[];
    },
  ): Promise<void> {
    try {
      // ── 先做分型判定（全是只读，无副作用），再落写入 ──
      // Task 8：便签的 cause 取决于软硬线，所以判定必须先于贴便签。
      // 2026-08-20 制裁分主体：只有「客户本人命中」才算硬线制裁。对手方命中
      // （SANCTION_COUNTERPARTY）按普通拒绝走软/硬线判定。
      //
      // ⚠️ hasApplicantSanctionHit 现在读的是类型化的 sceneTag（不再是
      // string[] 上的 .includes），写错标签名会被 TS 挡在编译期；但这条判据
      // 依旧是命门——把它删掉或改错，同样会让 hasSanction 恒 false → 真正命中
      // 制裁的客户既不冻单也不贴 SANCTION 便签（2026-09-14 起 open() 只在
      // hasSanction 时调用）；这次裁决若恰好带 action，还会经软线材料请求把
      // 入口暴露给一个本该被制裁沉默的客户 = tipping-off，而构建和测试全绿、
      // 零日志。swap-workflow.service.spec.ts 的「命门」用例组就是为钉死这个
      // 判据存在的，改这里必须同步看那组测试。
      const hasSanction = this.hasApplicantSanctionHit(input.sceneTag);
      // Task A6：MLRO 手工冻结与制裁命中客户本人共享同一条 FREEZE 落地边——
      // 见 applyKytVerdict 顶部同名变量的注释。冻单终态没有材料可交、也没有
      // 补料入口，所以 willFreeze（而不是单独的 hasSanction）才是"这次裁决算
      // 不算硬线"的正确判据：MLRO 冻结即便报文恰好带了 applicantActions，也
      // 不能因为 actions.length>0 而被误判成软线、暴露一个即将被冻结的入口。
      const willFreeze = hasSanction || input.dispoTag === 'FROZEN_BY_MLRO';
      const actions = input.applicantActions ?? [];
      // 本次裁决单看自己是不是硬线：无 action 可做，或即将冻单（制裁/MLRO）。
      const isHardLineThisVerdict = willFreeze || actions.length === 0;

      // Review Fix 2: 跨订单持久化 —— 查这个客户是否曾经被任意一笔 swap 硬线
      // 过。一旦命中过，永久不再暴露，不管这次裁决本身是软线还是硬线。
      const alreadyHardLined = await this.customersService.hasHardLineDisposition(
        swap.ownerId,
      );
      const exposeToCustomer = !alreadyHardLined && !isHardLineThisVerdict;

      // 命中制裁才限制（SWAP/WITHDRAW，注册表 SANCTION 的 scopes；DEPOSIT 故意
      // 不限制——链上资金已到账，拒收解决不了任何问题，只会制造资金卡死）。
      //
      // 2026-09-14 裁定：三域对同一套裁决按钮统一为"只有制裁·客户本人动
      // 人"——⑨ MLRO 冻结只冻单、⑪ 无标签的普通拒绝只拒单，都不再顺手贴便签
      // （兑换此前是唯一在这两路上开 KYT_REJECTED_SOFT/KYT_REJECTED_HARD 便签
      // 的域，收敛后与充提两域同型）。两个 cause 仍留在注册表里（手工下拉等
      // 别处还用），只是这条调用路径不再传。caseRef=swapNo，便于按单撕；
      // scope 不传，由注册表带出。
      let restrictionNo: string | undefined;
      let restrictionCreated: boolean | undefined;
      if (hasSanction) {
        const opened = await this.customerRestrictionsService.open({
          customerId: swap.ownerId,
          cause: 'SANCTION',
          reason: `Swap ${swap.swapNo} KYT rejected`,
          caseRef: swap.swapNo,
          openedBy: 'system',
        });
        restrictionNo = opened.restrictionNo;
        restrictionCreated = opened.created;
      }

      // 2026-08-20（Task 9）：客户本人命中制裁 → 把这笔单打到 FROZEN。
      // 2026-08-29（Task A6）：MLRO 手工冻结（dispoTag=FROZEN_BY_MLRO）共享
      // 同一条落地边——willFreeze 是两者的并集。只对 COMPLIANCE_PENDING 有效
      // （迁移表的唯一入边）；单子若已在 PROCESSING（腿已开跑）或已终态，这里
      // 用 status 判据先过滤，不靠异常控流 —— PROCESSING 分支走的是另一条路径
      // （assertSwapCustomerAccessOrHalt 停腿），REJECTED/SUCCESS carve-out 只
      // 重跑处置，不重跑状态迁移。
      // 顺序刻意排在"命中制裁才 open()"之后（先冻人、再冻单，与充值/提现一致
      // 的 fail-safe 排列）：hasSanction 时若崩在 open() 与这里之间，客户已经
      // 被限制、只是单子还没显示冻结，比反过来更安全。MLRO 冻结
      // （dispoTag=FROZEN_BY_MLRO 但非制裁）不经过 open()，直接冻单——冻的是
      // 这一笔单，不摁人（2026-09-14 裁定，见上方 restrictionNo 声明处注释）。
      if (willFreeze && swap.status === SwapTransactionStatus.COMPLIANCE_PENDING) {
        // 2026-08-20（Review Important Fix）：swap 是 applyKytVerdict 顶部
        // 一次性读出、随后一路传下来的陈旧快照 —— 从那一刻到这里之间，
        // onCustomerRestrictionOpened 广播 handler（由上面 open() 同步 emit 出的
        // 同一次事件触发）可能已经抢先把这一行冻上了。若这里对
        // markStatus 的失败毫无防备，Invalid transition 会被下面外层大 try 的
        // catch 当成整段处置失败：不仅误判这次 FREEZE，还连带跳过下面
        // 本该照常执行的 markHardLineDisposition sticky 标记与
        // SWAP_KYT_REJECTED_DISPOSED 审计（外层 catch 只 setNeedsReview + 记
        // SWAP_KYT_REJECTED_DISPOSITION_FAILED + rethrow，函数直接退出）——而
        // sticky 标记正是永久防 tipping-off 的唯一凭据，一旦跳过，下次软线裁决
        // 会重新对该客户暴露补料入口。外层 catch 的 rethrow 还会让 webhook 标
        // FAILED 重投，重投一进门就撞上 applyKytVerdict 入口的 FROZEN 幂等闸被 IGNORE，
        // sticky 标记与处置审计从此再也没有机会补跑。
        //
        // 判据镜像本文件 onCustomerRestrictionOpened 侧已有的范式（onCustomerRestrictionOpened
        // 侧的良性抢跑判据）：捕获失败后重读当前状态，已经是 FROZEN 就是被广播抢先的良性
        // 竞态 —— 降级 debug、绝不 return/rethrow，让下面的 sticky 标记与处置
        // 审计照常往下执行；不是 FROZEN 才是真失败，照旧上抛交给外层 catch
        // （needsReview + SWAP_KYT_REJECTED_DISPOSITION_FAILED + rethrow）。不靠
        // 匹配异常消息字符串判定 —— 措辞一改就失效。
        let frozeHere = true;
        try {
          await this.prisma.$transaction(async (tx: any) => {
            await this.swapTransactionsService.markStatus(
              swap.id,
              SwapTransactionAction.FREEZE,
              tx,
              { rejectReason: hasSanction ? 'SANCTION_APPLICANT' : 'FROZEN_BY_MLRO', operator: 'SUMSUB_KYT' },
            );
          });
        } catch (freezeErr) {
          let alreadyFrozen = false;
          try {
            const current = await this.swapTransactionsService.findByIdInternal(swap.id);
            alreadyFrozen = current?.status === SwapTransactionStatus.FROZEN;
          } catch {
            // 状态复核本身失败 —— 不能判定良性，走下面真失败分支上抛。
          }
          if (!alreadyFrozen) {
            throw freezeErr;
          }
          frozeHere = false;
          this.logger.debug(
            `Swap ${swap.swapNo} already FROZEN when this disposition tried to freeze it — beaten by onCustomerRestrictionOpened broadcast (same open() call), not a real failure. Continuing to sticky mark + disposition audit.`,
          );
        }
        // 押锁不放（2026-09-14 裁定翻案：FROZEN 从"冻结即放锁"的零出边终态改成
        // 中间态）——不再调用 releaseBirthLock。锁要放，走 RESUME 解冻续审后的
        // 正常结算，或 Task 3 的 REJECT_REFUND 拒退落地，不在这里擦圈。
        // 审计调用独立 catch（与本文件 onCustomerRestrictionOpened 侧的孪生
        // SWAP_FROZEN 审计同款）：不能和上面的 markStatus 共享外层大 try —— 若
        // 共享，这里抛出会被外层 catch 当成整段处置失败重跑，把已经成功的
        // FREEZE 之后本该继续的 markHardLineDisposition / SWAP_KYT_REJECTED_DISPOSED
        // 一起吞掉，也会撞上 FROZEN 幂等闸导致重投的 webhook 永远不再重跑处置。
        // 失败只以 logger.error 现身，绝不让一次已经成功的冻结被判成失败。
        // frozeHere=false（良性竞态）时跳过 —— 那次 FREEZE 是 handler 侧做的,
        // SWAP_FROZEN 审计已经由 handler 自己写过一遍(:1651),这里不重复。
        if (frozeHere) {
          await this.swapAudit(swap, {
              action: 'SWAP_FROZEN',
              // Task A6：两条因由靠这里的 reason 文案 + metadata.sceneTag/dispoTag
              // 分辨，不靠状态分辨——状态都是同一个 FROZEN。
              reason: hasSanction
                ? `KYT verdict rejected: SANCTION_APPLICANT hit (order frozen + customer restricted) — sell-side birth lock HELD pending disposition`
                : `KYT verdict rejected: FROZEN_BY_MLRO disposition (order frozen + customer restricted) — sell-side birth lock HELD pending disposition`,
              fromStatus: swap.status,
              toStatus: SwapTransactionStatus.FROZEN,
              metadata: {
                sceneTag: input.sceneTag ?? null,
                dispoTag: input.dispoTag ?? null,
              },
            })
            .catch((err) => {
              this.logger.error(
                `Failed to write SWAP_FROZEN audit for ${swap.swapNo} (KYT rejected disposition): ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            });
          // T7 修：只在 frozeHere（这次 FREEZE 真的是本调用落地的）才通知——
          // 良性竞态分支（handler 侧先冻）已经由 handler 自己的调用点通知过，
          // 这里再发一条就是重复假通知，和本修复要消灭的病同源。
          await this.notifySwapStatusChange(swap, swap.status, SwapTransactionStatus.FROZEN);
        }
      }

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
              // 2026-09-14 起 open() 只在 hasSanction 时调用，走到这个分支
              // （exposeToCustomer=true）hasSanction 必为 false——restrictionNo
              // 恒是 undefined，这里没有便签可接，纯粹落一行材料请求。
              // restrict:false 依旧表示「不要开新便签」；existingRestrictionNo
              // 缺省时 register() 本身也不会开一张（见 material-request-issuer
              // persist() 的 cause=null 分支）。
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
        await this.customersService.markHardLineDisposition(swap.ownerId);
      }

      await this.swapAudit(swap, {
        action: 'SWAP_KYT_REJECTED_DISPOSED',
        // 2026-09-14 裁定：只有命中制裁才真正限制客户——其余三支不再说
        // "Restricted"，避免审计留痕和实际动作对不上（项目规则①：操作必留痕）。
        reason: hasSanction
          ? 'Sanction hit — customer restricted, not notified (tipping-off)'
          : alreadyHardLined
          ? 'Customer previously hard-lined on another swap — not notified (sticky silence); no restriction opened this time'
          : exposeToCustomer
          ? 'Re-verification action exposed to customer; no restriction opened (only a sanction hit restricts)'
          : 'No action available — customer not notified; no restriction opened (only a sanction hit restricts)',
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
          restrictionCause: hasSanction ? ('SANCTION' as const) : undefined,
          restrictionCreated,
        },
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
      await this.swapAudit(swap, {
          action: 'SWAP_KYT_REJECTED_DISPOSED',
          outcome: AuditOutcome.FAILED,
          reasonCode: 'DISPOSITION_ERROR',
          reason: err instanceof Error ? err.message : 'Reject disposition failed',
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
   * 出生锁擦圈（站3）：把下单时画的腿1/attempt=1 预占退还客户余额。
   * best-effort——拒绝/冻结已成立后调用，失败只以 CRITICAL 现身，绝不回滚状态
   * （镜像提现 releaseLock 的口径）；两处冻结点竞态时输家跳过（赢家已擦）。
   */
  async releaseBirthLock(swap: any, why: string): Promise<string | null> {
    try {
      // 调用方可能只持窄行（批量冻单清单）——擦圈需要资产/金额字段，自取全行；
      // 回吐退还金额串，供落地行的 releasedFromAmount 使用。
      const full = await this.swapTransactionsService.findByIdInternal(swap.id);
      const ctx = await this.buildLegContext(full, this.prisma);
      const legSpecs = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat });
      await this.swapLegAccounting.voidLeg({ ...ctx, attempt: 1 }, legSpecs[0]!, this.prisma);
      return String(full.fromAmount);
    } catch (err) {
      this.logger.error(
        `CRITICAL: failed to void swap birth lock for ${swap.swapNo} (${why}) — sell-side funds may stay locked: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * 战役丙波一 T7 修（fix round 1，T10 走查逮，4 次独立 reset 100% 复现）：
   * notifyOrderStatusChange 必须在 markStatus 所在的 `$transaction` **提交之后**
   * 才调——NotificationsService.notifyOrderStatusChange 走独立 Prisma 连接写
   * customerNotification，若在 tx 回调内调用，会在 SQLite 单写者下被本次未
   * 提交的外层事务锁住，自锁到 Prisma 默认 5000ms 超时，外层事务因此回滚
   * （订单卡回原状态），而通知已经"发出"——SLA sweep 每 30 秒重试同一迁移，
   * 每轮再发一条，堆出重复假通知。调用处一律在对应 `$transaction` resolve
   * 之后调用本方法，传该次迁移**真实**的 fromStatus/toStatus；不包
   * try/catch——T2 NotificationsService 内部已经把失败吞成 console.error，
   * 通知失败不该拖累已经提交成功的状态变更。
   *
   * 不自行预判 collapse 是否变化——去重在 T2 notifyOrderStatusChange 内部
   * （collapsedFrom===collapsedTo 即短路）。amount/assetCode 不传，兑换两条
   * 资产腿没有单一"这笔的资产"可填，SWAP_SUCCESS/REJECTED 模板正文也只用
   * orderNo（notification-templates.constant.ts）——省略比传错好。
   */
  private async notifySwapStatusChange(
    swap: { swapNo: string | null; ownerId: string },
    fromStatus: string,
    toStatus: string,
  ): Promise<void> {
    // swapNo 理论上可空（schema 列 String?，镜像 swapAudit 对同一列的既有
    // 容错）——无业务号没有可寻址的订单，静默不发，不编造 orderNo。
    if (!swap.swapNo) return;
    await this.notificationsService.notifyOrderStatusChange({
      domain: 'SWAP',
      orderNo: swap.swapNo,
      owner: { customerId: swap.ownerId },
      collapsedFrom: this.swapTransactionsService.toCustomerSwapStatus(fromStatus),
      collapsedTo: this.swapTransactionsService.toCustomerSwapStatus(toStatus),
    });
  }

  /**
   * 站3-β 统一信封：兑换域每条业务留痕的公共骨架——actionDomain/旅程号继承/
   * subjects 角色（主体=单号/归属=客户号/牵连=资金单号）/防静默去重 requestId/
   * 来源通道；client 透传（兑换多数留痕与状态迁移同事务）。人为动作传 actor →
   * recordByActor。镜像 deposit/withdraw 两域助手（deliberate fork，词表独立演进）。
   */
  private async swapAudit(
    swap: any,
    patch: {
      action: string;
      outcome?: AuditOutcome;
      reasonCode?: string;
      reason?: string;
      fromStatus?: string;
      toStatus?: string;
      approvalNo?: string;
      causationId?: string;
      fundsOrderNo?: string;
      metadata?: Record<string, unknown>;
      actor?: AuditActorContext;
      sourcePlatform?: string;
    },
    client?: any,
  ): Promise<void> {
    const customerNo: string | null = swap.ownerNo ?? swap.customer?.customerNo ?? null;
    const swapNo: string | undefined = swap.swapNo || undefined;
    const subjects: AuditSubjectInput[] = [];
    if (swapNo) {
      subjects.push({ subjectType: AuditEntityTypes.SWAP_TRANSACTION, subjectNo: swapNo, subjectRole: AuditSubjectRole.PRIMARY });
    }
    if (customerNo) {
      subjects.push({ subjectType: 'CUSTOMER', subjectNo: customerNo, subjectRole: AuditSubjectRole.OWNER });
    }
    // 波五 Task 3：审批消费方审计（SWAP_UNFROZEN/SWAP_REFUNDED）逐字镜像
    // withdrawAudit —— 审批单作为 INSTRUMENT 子主体挂进来。
    if (patch.approvalNo) {
      subjects.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: patch.approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
    }
    if (patch.fundsOrderNo) {
      subjects.push({ subjectType: AuditEntityTypes.FUNDS_ORDER, subjectNo: patch.fundsOrderNo, subjectRole: AuditSubjectRole.RELATED });
    }
    const input = {
      action: patch.action,
      actionDomain: 'SWAP',
      category: AuditCategory.BUSINESS,
      primarySubjectType: AuditEntityTypes.SWAP_TRANSACTION,
      primarySubjectNo: swapNo,
      ownerCustomerNo: customerNo ?? undefined,
      correlationId: swap.correlationId ?? undefined,
      causationId: patch.causationId,
      outcome: patch.outcome ?? AuditOutcome.SUCCESS,
      reasonCode: patch.reasonCode,
      reason: patch.reason,
      fromStatus: patch.fromStatus,
      toStatus: patch.toStatus,
      approvalNo: patch.approvalNo,
      subjects,
      traceId: swap.traceId || undefined,
      metadata: patch.metadata,
      requestId: `${patch.action}_${swapNo ?? swap.id}_${randomUUID()}`,
      sourcePlatform: patch.sourcePlatform ?? 'SYSTEM',
    };
    if (patch.actor) {
      if (client) await this.auditLogsService.recordByActor(input as any, patch.actor as any, client);
      else await this.auditLogsService.recordByActor(input as any, patch.actor as any);
    } else {
      if (client) await this.auditLogsService.recordSystem(input as any, client);
      else await this.auditLogsService.recordSystem(input as any);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 波五 Task 3 — FROZEN maker-checker 解冻/拒退全链。逐字镜像
  // WithdrawWorkflowService.initiateUnfreeze/onUnfreezeDecided/onUnfreezeApproved/
  // fetchApprovedOrderRef/triggerUnfreezeRescore/initiateRefund/onRefundDecided/
  // onRefundApproved（withdraw-workflow.service.ts Task 8/9 段落）。两条出边
  // （resume→COMPLIANCE_PENDING / reject_refund→REJECTED）已在 Task 2 的迁移表
  // 开好，本节只接审批消费方。
  // ═══════════════════════════════════════════════════════════════════════

  private toAuditActor(actor: ApprovalActorContext): AuditActorContext {
    return {
      actorType: actor.actorType,
      actorNo: actor.userNo || 'UNKNOWN',
      actorDisplayName: actor.userNo || 'UNKNOWN',
      actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
    };
  }

  /**
   * UNFREEZE disposition（提出侧）：ops 对一笔 FROZEN 的 swap 提出解冻（名单命中
   * 更正 / MLRO 澄清等），走 V1 单步 MLRO maker-checker。只开审批案 + 写请求
   * 审计，不写 swap 表任何字段；真正的 resume→COMPLIANCE_PENDING 落地在
   * onUnfreezeApproved（Task 9 型决策事件驱动）。
   */
  async initiateUnfreeze(
    swapId: string,
    dto: { orderRef: string; reason: string },
    actor: ApprovalActorContext,
  ) {
    if (!dto.orderRef?.trim()) {
      throw new BadRequestException('Delisting/unfreeze order reference is required');
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Unfreeze reason is required');
    }

    const swap = await this.swapTransactionsService.findByIdInternal(swapId);
    if (!swap || swap.status !== SwapTransactionStatus.FROZEN) {
      throw new BadRequestException('Swap is not FROZEN, cannot open an unfreeze approval');
    }

    // 防重：一张单不能同时挂两个待批的解冻审批。
    const openUnfreezes = await this.approvalsService.list({
      actionType: ApprovalActionTypes.SWAP_UNFREEZE,
      entityRef: swap.swapNo,
      status: ApprovalStatuses.PENDING,
      take: 1,
    });
    if (openUnfreezes.total > 0) {
      throw new ConflictException(
        `Swap ${swap.swapNo} already has a pending unfreeze approval; resolve it before submitting another.`,
      );
    }

    const traceId = swap.traceId || randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.SWAP_UNFREEZE,
        entityRef: swap.swapNo,
        traceId,
        objectSnapshot: {
          swapNo: swap.swapNo,
          ownerType: swap.ownerType,
          ownerId: swap.ownerId,
          orderRef: dto.orderRef,
          reason: dto.reason,
        },
      },
      { reason: dto.reason, traceId },
      actor,
    );

    await this.swapAudit(swap, {
      action: 'SWAP_UNFREEZE_REQUESTED',
      reason: dto.reason,
      approvalNo: approvalCase.approvalNo,
      metadata: { orderRef: dto.orderRef },
      actor: this.toAuditActor(actor),
      sourcePlatform: 'ADMIN_API',
    });

    return {
      swapNo: swap.swapNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  /**
   * SANCTION REFUND disposition（提出侧）：ops 对一笔 FROZEN 的 swap 提出拒退，
   * 走 V1 单步 MLRO maker-checker。只开审批案 + 写请求审计；真正的
   * reject_refund→REJECTED 落地在 onRefundApproved。
   */
  async initiateRefund(
    swapId: string,
    dto: { reason: string },
    actor: ApprovalActorContext,
  ) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Refund reason is required');
    }

    const swap = await this.swapTransactionsService.findByIdInternal(swapId);
    if (!swap || swap.status !== SwapTransactionStatus.FROZEN) {
      throw new BadRequestException('Swap is not FROZEN, cannot open a sanction-refund approval');
    }

    const openRefunds = await this.approvalsService.list({
      actionType: ApprovalActionTypes.SWAP_SANCTION_REFUND,
      entityRef: swap.swapNo,
      status: ApprovalStatuses.PENDING,
      take: 1,
    });
    if (openRefunds.total > 0) {
      throw new ConflictException(
        `Swap ${swap.swapNo} already has a pending sanction-refund approval; resolve it before submitting another.`,
      );
    }

    const traceId = swap.traceId || randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.SWAP_SANCTION_REFUND,
        entityRef: swap.swapNo,
        traceId,
        objectSnapshot: {
          swapNo: swap.swapNo,
          ownerType: swap.ownerType,
          ownerId: swap.ownerId,
          reason: dto.reason,
        },
      },
      { reason: dto.reason, traceId },
      actor,
    );

    await this.swapAudit(swap, {
      action: 'SWAP_REFUND_REQUESTED',
      reason: dto.reason,
      approvalNo: approvalCase.approvalNo,
      actor: this.toAuditActor(actor),
      sourcePlatform: 'ADMIN_API',
    });

    return {
      swapNo: swap.swapNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  /**
   * UNFREEZE decided：SwapUnfreezeApprovalService（ApprovalHandlerBase 子类）
   * 把 governance.approval.* 过滤到 SWAP_UNFREEZE 后转发的
   * workflow.swap-unfreeze.decided。APPROVED → onUnfreezeApproved；其余结局
   * （DECLINED/CANCELLED/EXPIRED）只记日志，swap 原地不动（继续 FROZEN）。
   */
  @OnEvent('workflow.swap-unfreeze.decided', { async: true })
  async onUnfreezeDecided(payload: {
    decision: 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
    entityRef: string;
    approvalId: string;
    approvalNo: string;
    decisionReason?: string | null;
  }) {
    if (payload.decision !== 'APPROVED') {
      this.logger.log(
        `Swap ${payload.entityRef} unfreeze ${payload.decision} (case ${payload.approvalNo}) — original state intact, no unfreeze executed.`,
      );
      return;
    }
    await this.onUnfreezeApproved(payload.entityRef, payload.approvalNo, payload.approvalId);
  }

  /**
   * 从最近一个 APPROVED 的 SWAP_UNFREEZE 审批件 objectSnapshot 里回取
   * orderRef —— ApprovalDecidedEvent.metadata 恒为 {}（approval-handler.base.ts
   * 的 emitDecidedEvent 里如此），故必须在这里重新查一次，不能靠事件负载携带。
   * 抛出而非静默兜底：initiateUnfreeze 已在开审批时校验过 orderRef 非空，这里
   * 查不到就是数据损坏而非正常路径——且这次查询发生在任何状态变更之前
   * （guard-before-mutate），抛出时 swap 原样未动（仍是 FROZEN）。
   */
  private async fetchApprovedOrderRef(swapNo: string, actionType: string): Promise<string> {
    const { items } = await this.approvalsService.list({
      actionType,
      entityRef: swapNo,
      status: ApprovalStatuses.APPROVED,
      take: 1,
    });
    const snapshot = items[0]?.objectSnapshot as { orderRef?: string } | null;
    const orderRef = snapshot?.orderRef;
    if (!orderRef) {
      throw new Error(
        `Swap ${swapNo}: no APPROVED ${actionType} case with an orderRef found in objectSnapshot`,
      );
    }
    return orderRef;
  }

  /**
   * Best-effort：解冻回 COMPLIANCE_PENDING 后重新送一次 Sumsub KYT 打分（卖出腿
   * sumsubTxnIdOut）——解冻的意义就在于用新裁决驱动状态机，而不是继续挂着冻结
   * 前的旧裁决。rescore 是外部 HTTP 调用——必须 try/catch：跑到这一步时 resume
   * 已经落库、SWAP_UNFROZEN 审计已经写完，rescore 失败只能警告，绝不能让已经
   * 提交的状态回滚（镜像 withdraw 同名方法的 I2 教训：外部 HTTP 调用绝不许回滚
   * 已提交状态）。
   */
  private async triggerUnfreezeRescore(swap: { id: string; sumsubTxnIdOut?: string | null }): Promise<void> {
    if (!swap.sumsubTxnIdOut) {
      this.logger.warn(
        `Unfreeze rescore skip: swap ${swap.id} has no sumsubTxnIdOut — never submitted to Sumsub`,
      );
      return;
    }

    try {
      await this.sumsubTxnClient.rescore(swap.sumsubTxnIdOut);
    } catch (err) {
      this.logger.warn(
        `Unfreeze rescore failed for swap ${swap.id}: ${(err as Error).message} — ` +
          `swap remains COMPLIANCE_PENDING for webhook/manual re-submit`,
      );
    }
  }

  /**
   * UNFREEZE approved：解冻回 COMPLIANCE_PENDING 续审。零记账——2026-09-14 裁定
   * 翻案后 FROZEN 押锁不放，卖出侧出生锁全程没动过，没有反向腿要冲。顺序：
   *   1. 只在 FROZEN 上生效——重放的 decided 事件若这时 swap 已经离开 FROZEN，
   *      判为 no-op 而不是崩。
   *   2. 变更任何东西之前先取 orderRef（fetchApprovedOrderRef）——APPROVED 件
   *      没 orderRef 就抛出，swap 原样不动。
   *   3. RESUME → COMPLIANCE_PENDING（markStatus），同一事务内顺手清掉冻结时
   *      打上的 rejectReason —— markStatus 本身只在 opts.rejectReason 存在时
   *      才写、从不清空（见 swap-transactions.service.ts markStatus 的 opts
   *      写入逻辑），解冻回普通合规审的单不该继续带着 'SANCTION_APPLICANT' 之
   *      类的陈旧拒绝因由（管理台会显示"待审但已有拒绝因由"）。选择在同一事务
   *      内补一笔 tx.swapTransaction.update 而非改 markStatus 本身的签名——
   *      markStatus 有十余个调用点，改共享方法的写入语义影响面太大，这里补一
   *      笔窄范围的收尾更新是更小的改动。
   *   4. 审计 SWAP_UNFROZEN，reason 里带 orderRef，approvalNo/causationId 满足
   *      词表 requiredFields/requiresCausation。
   *   5. Best-effort rescore（triggerUnfreezeRescore）——绝不上抛。
   * 全程零记账调用——锁维持原样。
   */
  private async onUnfreezeApproved(swapNo: string, approvalNo?: string, causationId?: string) {
    const swap = await this.swapTransactionsService.findByNoInternal(swapNo);
    if (swap.status !== SwapTransactionStatus.FROZEN) {
      this.logger.warn(
        `onUnfreezeApproved no-op: swap ${swapNo} not in FROZEN (status=${swap.status})`,
      );
      return;
    }

    const orderRef = await this.fetchApprovedOrderRef(swap.swapNo, ApprovalActionTypes.SWAP_UNFREEZE);

    const nextStatus = await this.prisma.$transaction(async (tx: any) => {
      const next = await this.swapTransactionsService.markStatus(
        swap.id,
        SwapTransactionAction.RESUME,
        tx,
        { operator: 'MLRO_APPROVAL' },
      );
      await tx.swapTransaction.update({ where: { id: swap.id }, data: { rejectReason: null } });
      return next;
    });

    await this.swapAudit(swap, {
      action: 'SWAP_UNFROZEN',
      reason: `Unfreeze order ${orderRef} — swap resumed to COMPLIANCE_PENDING`,
      approvalNo,
      causationId,
      fromStatus: SwapTransactionStatus.FROZEN,
      toStatus: nextStatus,
      metadata: { orderRef },
    });

    // T7 修：$transaction 已 resolve，这里才通知。
    await this.notifySwapStatusChange(swap, SwapTransactionStatus.FROZEN, nextStatus);

    await this.triggerUnfreezeRescore(swap);
  }

  /**
   * SANCTION REFUND decided：SwapSanctionRefundApprovalService 转发的
   * workflow.swap-sanction-refund.decided。APPROVED → onRefundApproved；其余
   * 结局只记日志，swap 原地不动。
   */
  @OnEvent('workflow.swap-sanction-refund.decided', { async: true })
  async onRefundDecided(payload: {
    decision: 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
    entityRef: string;
    approvalId: string;
    approvalNo: string;
    decisionReason?: string | null;
  }) {
    if (payload.decision !== 'APPROVED') {
      this.logger.log(
        `Swap ${payload.entityRef} sanction-refund ${payload.decision} (case ${payload.approvalNo}) — original state intact, no refund executed.`,
      );
      return;
    }
    await this.onRefundApproved(payload.entityRef, payload.approvalNo, payload.approvalId);
  }

  /**
   * SANCTION REFUND approved：拒绝这笔 swap 并把卖出侧出生锁放回客户可用余额。
   * 顺序镜像 withdraw 的 onRefundApproved：先落状态迁移，再放锁
   * （releaseBirthLock —— Task 2 保留至今、专等本方法调用的落地点），最后审计。
   */
  private async onRefundApproved(swapNo: string, approvalNo?: string, causationId?: string) {
    const swap = await this.swapTransactionsService.findByNoInternal(swapNo);
    if (swap.status !== SwapTransactionStatus.FROZEN) {
      this.logger.warn(
        `onRefundApproved no-op: swap ${swapNo} not in FROZEN (status=${swap.status})`,
      );
      return;
    }

    const nextStatus = await this.prisma.$transaction(async (tx: any) => {
      return this.swapTransactionsService.markStatus(
        swap.id,
        SwapTransactionAction.REJECT_REFUND,
        tx,
        { operator: 'MLRO_APPROVAL' },
      );
    });

    const releasedFromAmount = await this.releaseBirthLock(swap, 'Sanction refund approved (SWAP_SANCTION_REFUND)');

    // T7 修：$transaction 已 resolve，这里才通知。
    await this.notifySwapStatusChange(swap, SwapTransactionStatus.FROZEN, nextStatus);

    await this.swapAudit(swap, {
      action: 'SWAP_REFUNDED',
      reason: 'Sanction refund approved — swap rejected and sell-side lock released to customer balance',
      approvalNo,
      causationId,
      fromStatus: SwapTransactionStatus.FROZEN,
      toStatus: nextStatus,
      metadata: { releasedFromAmount },
    });
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
    const { fromWalletId, toWalletId } = await this.swapLegAccounting.resolveLegWallets(spec, ctx, tx);
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
    // 出生锁例外：腿1第1次的圈在下单事务里已画（executeFromQuote），此处只铸单据——
    // 编号同为 (SWap, swapNo, eventCode, attempt=1)，postLeg 落笔天然命中出生圈。
    const legCtx = { ...ctx, attempt };
    if (!(legSeq === 1 && attempt === 1)) {
      await this.swapLegAccounting.initiateLegPending(legCtx, spec, tx);
    }
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

    // T7 修：onLegConfirmed 命中 SUCCESS（最后一腿清讫）时把该次迁移的真值
    // 经事务回调的返回值带出——$transaction resolve 之后才通知，不在事务回调
    // 内（onLegConfirmed 本身也在这个 client 事务里跑）调用 notificationsService
    // （独立 Prisma 连接，tx 内调用会自锁）。回调显式 return 而不是闭包改写外层
    // let——闭包捕获的可变绑定会让 TS 控制流分析在这类结构化类型上过度收窄。
    const succeeded = await this.prisma.$transaction(async (
      client: any,
    ): Promise<{ swap: { swapNo: string | null; ownerId: string }; nextStatus: string } | null> => {
      const swap = await this.swapTransactionsService.findByIdInternal(swapId, client);
      if (!swap || swap.status !== 'PROCESSING') {
        // Already SUCCESS (idempotent replay) or gone — nothing to do.
        return null;
      }
      const ctx = this.swapLegAccounting.ctxFromSwap(swap);
      const allSpecs = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat });
      const spec = allSpecs.find((s) => s.legSeq === event.legSeq);
      if (!spec) throw new Error(`Spec not found for legSeq ${event.legSeq}`);

      if (newStatus === FundsOrderStatus.CONFIRMED) {
        const nextStatus = await this.onLegConfirmed(swap, spec, event, ctx, client);
        return nextStatus ? { swap, nextStatus } : null;
      }
      await this.onLegFailedSelfHeal(swap, spec, event, ctx, client);
      return null;
    });
    if (succeeded) {
      await this.notifySwapStatusChange(succeeded.swap, 'PROCESSING', succeeded.nextStatus);
    }
  }

  /**
   * Handle the CONFIRMED trigger: POST the leg's TB entries + audit
   * SWAP_LEG_POSTED, auto-advance the leg funds_order to CLEARED (terminal —
   * mirrors deposit/withdraw where CONFIRM finalizes internally, so manual
   * simulation only needs to reach CONFIRMED), then either finalize SUCCESS
   * (last leg) or chain the next leg. The CLEARED event this advance emits
   * re-enters handleFundsOrderChanged and is a no-op (guarded out).
   *
   * 返回值（T7 修）：非 null 仅当本次调用把 swap 推进 SUCCESS（最后一腿），
   * 携带该次迁移的 nextStatus，供调用方 handleFundsOrderChanged 在
   * $transaction resolve 之后据此调用 notifySwapStatusChange；未到最后一腿
   * （链下一条腿）返回 null——那不是一次客户可见的状态迁移。
   */
  private async onLegConfirmed(
    swap: any,
    spec: SwapLegSpec,
    event: FundsOrderStatusChangedEvent,
    ctx: SwapSettleCtx,
    client: any,
  ): Promise<string | null> {
    // Task 9：推下一腿之前查客户级能力闸。三域里兑换是唯一漏掉这道的。
    if (!(await this.assertSwapCustomerAccessOrHalt(swap, 'leg-confirmed', client))) return null;
    const legSeq = event.legSeq;
    // The TB pending id is derived per-(swap, leg, attempt). Use THIS attempt so
    // post hits the right transfer (matches initiateLegPending's id).
    // 铸号已在 advance()→CONFIRMED 落到 leg funds_order(事件先于此提交)。读回真实号
    // 传入 postLeg,由 enrichForPost 盖进 evidence + account_flows。
    const legFo = await this.fundsOrders.findById(event.fundsOrderId, client);
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
    await this.swapAudit(swap, {
      action: 'SWAP_LEG_POSTED',
      reason: `Swap leg ${legSeq} posted`,
      fundsOrderNo: event.fundsOrderNo,
      metadata: { legSeq, attempt: event.attempt },
    }, client);

    const isLast = legSeq >= SwapWorkflowService.TOTAL_LEGS;
    if (isLast) {
      const succeededNext = await this.swapTransactionsService.markStatus(swap.id, SwapTransactionAction.SUCCESS, client, { operator: 'LEG_SETTLEMENT' });
      await this.swapAudit(swap, {
        action: 'SWAP_SUCCEEDED',
        reason: 'Swap settlement completed — all legs cleared',
        fromStatus: swap.status,
        toStatus: succeededNext,
      }, client);
      // SUCCESS: no leg created, so recompute is not covered by createLeg.
      await this.swapTransactionsService.recomputeProjections(
        swap.id,
        (n) => this.stageOf(n),
        client,
      );
      return succeededNext;
    }

    // Progressively create the next leg (CREATED). createLeg recomputes projections (I2).
    const allSpecs = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat });
    const nextSpec = allSpecs.find((s) => s.legSeq === legSeq + 1)!;
    await this.createLeg(swap, nextSpec, ctx, legSeq + 1, 1, swap.traceId ?? undefined, client);
    return null;
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
      const retryLeg = await this.createLeg(swap, spec, ctx, legSeq, nextAttempt, swap.traceId ?? undefined, client);
      await this.swapAudit(swap, {
        action: 'SWAP_LEG_RETRIED',
        reason: `Swap leg ${legSeq} failed (attempt ${failedAttempt}/${SwapWorkflowService.MAX_LEG_ATTEMPTS}); retry attempt ${nextAttempt} created`,
        fundsOrderNo: retryLeg?.fundsOrderNo,
        metadata: { legSeq, failedAttempt, nextAttempt, failedStatus: event.newStatus },
      }, client);
    } else {
      // attempts == MAX_LEG_ATTEMPTS → STUCK: flag the swap for manual resume.
      // The funds_order stays terminal; needsReview is tracked on the swap.
      await this.swapTransactionsService.setNeedsReview(swap.id, true, client);
      await this.swapAudit(swap, {
        action: 'SWAP_LEG_STUCK',
        outcome: AuditOutcome.FAILED,
        reasonCode: 'LEG_EXHAUSTED',
        reason: `Swap leg ${legSeq} stuck after ${failedAttempt} failed attempts; awaiting manual resume`,
        fundsOrderNo: event.fundsOrderNo,
        metadata: { legSeq, attempts: failedAttempt, lastFailedStatus: event.newStatus },
      }, client);
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

      // E1（2026-09-12 业主定案：原地冻是正解）：冻人期间 Resume = 替被冻客户动钱，
      // 命令行路同样要过这道门（铁律②）。解除限制后断言自然放行。
      const access = await this.customerAccessService.resolve(swap.ownerId, client);
      if (access.blocked.has('SWAP')) {
        throw new BadRequestException(
          'SWAP_CUSTOMER_RESTRICTED: customer SWAP capability is restricted — resume is blocked until the restriction is lifted',
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

      await this.swapAudit(swap, {
        action: 'SWAP_LEG_RESUMED',
        reason: `Swap leg ${legSeq} manually resumed by ${operatorId} (attempt ${resumedAttempt})`,
        metadata: { legSeq, resumedAttempt, fromAttempt },
        actor: { actorType: 'ADMIN', actorNo: operatorId, actorDisplayName: operatorId, actorRolesAtTime: ['ADMIN'] },
        sourcePlatform: 'ADMIN_API',
      }, client);

      return { swapId: swap.id, legSeq, resumedAttempt };
    });
  }
  /**
   * 客户级能力闸（Task 9 补齐）。兑换此前只在 initiateSwap() 建单前查一次，
   * PROCESSING 中 4 腿照常推完 —— 客户在推腿途中被摁住也拦不住，这是三域里
   * 唯一漏掉的一处。复刻提现范式：命中则停推 + 审计 + 返回 false，调用方立即 return。
   *
   * 2026-08-20 更正（Task 9）：兑换现在有 FROZEN 态（Task 8），但 PROCESSING
   * 刻意没有 FREEZE 出边（腿已开跑，冻结会留半截账）—— 这个方法只处理
   * PROCESSING 阶段的停腿闸，不改状态机，只 setNeedsReview + 停止推进，留在
   * PROCESSING 等人工处置。COMPLIANCE_PENDING 单的冻结走
   * onCustomerRestrictionOpened 的另一支（直接 markStatus(FREEZE)）。
   */
  private async assertSwapCustomerAccessOrHalt(swap: any, stage: string, client?: any): Promise<boolean> {
    const access = await this.customerAccessService.resolve(swap.ownerId, client);
    if (!access.blocked.has('SWAP')) return true;

    this.logger.warn(
      `Swap capability gate FAIL at ${stage}: swap ${swap.swapNo} — SWAP blocked → halting leg progression`,
    );
    await this.swapTransactionsService.setNeedsReview(swap.id, true, client).catch(() => undefined);
    await this.swapAudit(swap, {
      action: 'SWAP_LEG_HALTED_BY_RESTRICTION',
      reason: `Customer SWAP capability restricted at ${stage} — in-flight swap leg progression halted`,
      metadata: { stage },
    }, client);
    return false;
  }

  /**
   * 客户被贴了「卡住全部能力」的便签 → 处理他名下所有在途兑换。
   *
   * 2026-08-20 起分两路（Task 9）：
   *   COMPLIANCE_PENDING + cause=SANCTION → 打到 FROZEN（零出边终态，与充值/
   *     提现对齐，运营在列表页一眼可见）
   *   其余一切（PROCESSING；或 COMPLIANCE_PENDING 但 cause 不是 SANCTION，
   *     今天唯一在场的是 ADMIN_SUSPENSION）→ 维持停腿 + needsReview
   *     （assertSwapCustomerAccessOrHalt）
   *
   * cause 过滤是 Review Important Fix（2026-08-20）：blocksAllCapabilities
   * 广播不只由制裁触发 —— ADMIN_SUSPENSION 的 scope 也是 ['ALL']（运营终止
   * 补料周期 / 客户等级升级审批被拒都会开出这张便签），但它是 DISCLOSED /
   * OPS_APPROVAL 就能解的行政便签，与制裁无关。若不按 cause 过滤，一次与
   * 制裁毫不相干的行政暂停会把 COMPLIANCE_PENDING 的单打进 FROZEN、还盖上一个
   * 假的 rejectReason=SANCTION_APPLICANT —— FROZEN 零出边，运营后来把
   * ADMIN_SUSPENSION 解了，单子也永远回不来（Task 9 之前，同一个事件只是
   * 停腿 + needsReview，是可恢复的，这里不能倒退）。
   *
   * 已经 FROZEN 的单不会出现在这里 —— findNonTerminalByOwner 用
   * SWAP_FREEZE_SCAN_EXCLUDED 排除掉了。
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
        if (sw.status === SwapTransactionStatus.COMPLIANCE_PENDING && event.cause === 'SANCTION') {
          await this.prisma.$transaction(async (tx: any) => {
            await this.swapTransactionsService.markStatus(
              sw.id,
              SwapTransactionAction.FREEZE,
              tx,
              { rejectReason: 'SANCTION_APPLICANT', operator: 'RESTRICTION_BROADCAST' },
            );
          });
          // 押锁不放（2026-09-14 裁定翻案：FROZEN 从"冻结即放锁"的零出边终态改成
          // 中间态）——不再调用 releaseBirthLock。锁要放，走 RESUME 解冻续审后的
          // 正常结算，或 Task 3 的 REJECT_REFUND 拒退落地，不在这里擦圈。
          // 铁律①：有持久状态、operator 可见 → 必须写审计。
          //
          // 审计调用独立 catch（与 deposit/withdraw 的 onCustomerRestrictionOpened
          // 同款，2026-08-20）：不能和上面的 markStatus 共享这个 try 块 —— 若共享，
          // 审计写入失败会被下面 catch 的自咬回读判据（"已经 FROZEN 就是良性抢跑"）
          // 误判成良性而静默，那正是本批要消灭的。审计失败与状态跃迁失败必须分开：
          // 这里失败只以 logger.error 现身，绝不让一笔已经冻结成功的单被判成失败。
          await this.swapAudit(sw, {
              action: 'SWAP_FROZEN',
              reason: `Frozen by customer restriction ${event.restrictionNo} (${event.cause}) — sell-side birth lock HELD pending disposition`,
              fromStatus: SwapTransactionStatus.COMPLIANCE_PENDING,
              toStatus: SwapTransactionStatus.FROZEN,
              metadata: { restrictionNo: event.restrictionNo, cause: event.cause },
            })
            .catch((err) => {
              this.logger.error(
                `Failed to write SWAP_FROZEN audit for ${sw.swapNo} (restriction ${event.restrictionNo}): ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            });
          // T7 修：$transaction 已 resolve，这里才通知——这次 FREEZE 确实是
          // 本次循环迭代落地的（try 块跑到这里说明 markStatus 没抛），不是
          // catch 分支判良性竞态的那种情况。
          await this.notifySwapStatusChange(sw, SwapTransactionStatus.COMPLIANCE_PENDING, SwapTransactionStatus.FROZEN);
        } else {
          // PROCESSING；或 COMPLIANCE_PENDING 但 cause≠SANCTION（例如
          // ADMIN_SUSPENSION）：都只停腿/停单，不把单据推进零出边终态
          // （assertSwapCustomerAccessOrHalt 内部已写
          // SWAP_LEG_HALTED_BY_RESTRICTION 审计），不动单据状态机。
          await this.assertSwapCustomerAccessOrHalt(sw, `restriction:${event.restrictionNo}`);
        }
      } catch (e) {
        // 自咬（与 deposit/withdraw 的 onCustomerRestrictionOpened 同构，
        // deliberate fork 不抽公共 helper）：open() 广播是 fire-and-forget，扫描
        // 发生在触发路径 markStatus(FREEZE) 提交之前 —— findNonTerminalByOwner
        // 扫到本单时它的快照仍是 COMPLIANCE_PENDING（notIn 拦不住触发单自己），
        // 但轮到本轮循环对它执行 FREEZE 时，触发路径（如 handleRejectDisposition
        // 的 hasSanction 分支）往往已经把它冻上了（FROZEN 无 FREEZE 自环边）→
        // markStatus 必抛。这不是真失败——单已经冻好，只是被触发路径抢先。判据：
        // 重新读一次当前状态，已是 FROZEN 就是良性抢跑，降级 debug；否则才是真
        // 失败，照旧 warn（不靠匹配异常消息字符串，措辞一改就失效）。
        let alreadyFrozen = false;
        try {
          const current = await this.swapTransactionsService.findByIdInternal(sw.id);
          alreadyFrozen = current?.status === SwapTransactionStatus.FROZEN;
        } catch {
          // 状态复核本身失败（例如单已被删）—— 不能判定良性，走下面 warn 分支。
        }
        if (alreadyFrozen) {
          this.logger.debug(
            `In-flight swap ${sw.swapNo} already FROZEN when restriction ${event.restrictionNo} scan reached it — beaten by the triggering path (open()'s broadcast preceded this order's main-path commit), not a real failure.`,
          );
        } else {
          this.logger.warn(
            `Failed to handle in-flight swap ${sw.swapNo} for restriction ${event.restrictionNo}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
      }
    }
  }

}
