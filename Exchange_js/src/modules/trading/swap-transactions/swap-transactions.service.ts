import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  SwapTransactionQueryDto,
  SwapTransactionStatus,
  SwapTransactionAction,
  SwapRejectReason,
} from './dto/swap-transaction.dto';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { SwapQuoteService } from '../swap-fee-level/swap-quote.service';
import { BinanceRateProvider } from '../pricing-center/providers/binance-rate.provider';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditCategory, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { MATERIAL_REQUEST_LIVE_STATUSES } from '../../identity/material-requests/constants/material-request.constant';
import {
  AuditActions,
  AuditEntityTypes,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';

interface SwapMatchedInfo {
  pairId: string;
  pairName: string;
  tierId: string;
  tierName: string;
}

interface SwapPricingSourceInfo {
  provider: 'BINANCE';
  endpoint: 'api/v3/ticker/bookTicker';
  symbol: string;
  bid: string;
  ask: string;
  sideUsed: 'BID' | 'INVERSE_ASK';
  aedPegApplied: boolean;
  aedPegRate: string;
  formula: string;
  effectiveBaseRate: string;
  fetchedAt: string;
}

export interface SwapExecutableRateResult {
  fromAssetId: string;
  toAssetId: string;
  fromAssetCurrency: string;
  toAssetCurrency: string;
  fromAssetDecimals: number;
  toAssetDecimals: number;
  marketRate: number;
  spreadPercent: number;
  executableRate: number;
  spreadBps: number;
  rateSource: string;
  fetchedAt: string;
  quoteLockSeconds: number;
  pairId: string;
  pairName: string;
  tierId: string;
  tierName: string;
  matched: SwapMatchedInfo;
  pricingSource: SwapPricingSourceInfo;
  feeBreakdown: any[];
  feeTotals: Record<string, string>;
  grossAmountOut: number;
  netAmountOut: number;
  feeTotal: number;
  feeCurrency: string | null;
  policyRef: {
    policyCode: string;
    policyId: string;
    business: 'SWAP';
    channel: 'ONLINE';
  };
}

export interface SwapQuoteComputationResult extends SwapExecutableRateResult {
  fromAmount: number;
  toAmount: number;
  exchangeRate: number;
  amountOut: number;
  createdAt: string;
  expiresAt: string;
}

/**
 * 「单据生命周期已结束」—— 材料请求作废监听器（material-request-order-cancel.
 * listener.ts）与 admin 材料请求列表读这一份。
 * ⚠️ FROZEN 刻意**不在**内：被制裁调查的客户，他在途的材料请求要留着不撕。
 * 撕掉 = 客户端"请上传XX"的卡片突然消失 = 一个可感知的变化 = tipping-off。
 */
export const SWAP_TERMINAL_STATUSES: ReadonlySet<string> = new Set<string>([
  SwapTransactionStatus.SUCCESS,
  SwapTransactionStatus.REJECTED,
  SwapTransactionStatus.FAILED,
  SwapTransactionStatus.REVERSED,
]);

/**
 * 兑换域 SLA 配置（2026-08-21 第三批）。只有一格：等 Sumsub 回裁决。
 * 兑换**没有软 SLA** —— 它没有「等自己人」的状态（无人工复核态、无审批门）。
 *
 * 合规超时是独立时钟 —— 与 quote TTL 无关。quote 一旦被 initiateSwap 消费，价格
 * 就已经锁定；之后 Sumsub 回 verdict 慢，是平台自己的问题，不能拿它去废掉客户
 * 已经接受的报价，所以这里另起一条计时线，不复用 quote 的过期逻辑。
 *
 * 2026-08-21：60 秒 → 5 分钟（业主裁定），与充值/提现的 COMPLIANCE_PENDING 对齐。
 * 三域等的都是同一件事——Sumsub 回裁决——没有理由分三个数。
 */
const SWAP_SLA_MINUTES_BY_STATUS: Partial<Record<SwapTransactionStatus, number>> = {
  [SwapTransactionStatus.COMPLIANCE_PENDING]: 5,
};

/**
 * 「不需要再被冻结广播捞起」—— findNonTerminalByOwner 专用。
 * ⚠️ FROZEN **在**内：已经冻了的单不需要再冻一次。
 * 与上面那份的 FROZEN 归属**故意相反**，两个判据回答的是不同问题，
 * 不要因为"看起来能合并成一个"就合并。
 */
export const SWAP_FREEZE_SCAN_EXCLUDED: ReadonlySet<string> = new Set<string>([
  ...SWAP_TERMINAL_STATUSES,
  SwapTransactionStatus.FROZEN,
]);

/**
 * 客户面 passthrough 白名单 —— 只有这几个「客户本就该看到真实结果」的态原样
 * 输出，其余任何状态（现在的、遗留的、未来新增的）一律收敛。
 *
 * 方向抄自 deposit-transactions.service.ts:82-91 的成文教训：黑名单必然滞后，
 * 新增的执法态只要没人记得手工加进去就会原样下发给客户。白名单反过来，
 * 新增状态天生落在收敛侧。宁可错杀，不可放过。
 */
const SWAP_CUSTOMER_STATUS_PASSTHROUGH = new Set<string>([
  SwapTransactionStatus.COMPLIANCE_PENDING,
  SwapTransactionStatus.PROCESSING,
  SwapTransactionStatus.SUCCESS,
  SwapTransactionStatus.REJECTED,
]);

@Injectable()
export class SwapTransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly swapQuoteService: SwapQuoteService,
    private readonly binanceRateProvider: BinanceRateProvider,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private async getSwapAssetsOrThrow(fromAssetId: string, toAssetId: string) {
    const [fromAsset, toAsset] = await Promise.all([
      (this.prisma as any).asset.findUnique({
        where: { id: fromAssetId },
      }),
      (this.prisma as any).asset.findUnique({
        where: { id: toAssetId },
      }),
    ]);

    if (!fromAsset || !toAsset) {
      throw new NotFoundException('Asset not found');
    }

    if (fromAsset.type === 'FIAT' && toAsset.type === 'FIAT') {
      throw new BadRequestException('Fiat to Fiat swap is not supported');
    }

    return { fromAsset, toAsset };
  }

  async getExecutableRate(
    fromAssetId: string,
    toAssetId: string,
    options: {
      amount: number | string | Prisma.Decimal;
      ownerType?: string;
      ownerId?: string;
    },
  ): Promise<SwapExecutableRateResult> {
    const { fromAsset, toAsset } = await this.getSwapAssetsOrThrow(
      fromAssetId,
      toAssetId,
    );

    const amount = new Prisma.Decimal(options.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('amount must be greater than 0');
    }

    const resolved = await this.swapQuoteService.resolveBestLevel({
      fromAssetId,
      toAssetId,
      amount,
      customerId: options.ownerId || '',
    });

    if (!resolved) {
      throw new BadRequestException('No applicable fee level found for this currency pair and amount');
    }

    const rateResult = await this.binanceRateProvider.fetchRate(
      fromAsset.currency,
      toAsset.currency,
    );

    const marketRate = rateResult.rate;
    // Spread is the platform margin: customer receives a worse-than-market rate.
    const markupMultiplier = new Prisma.Decimal(1).sub(
      new Prisma.Decimal(resolved.rateMarkupBps).div(10000),
    );
    const executableRate = marketRate.mul(markupMultiplier);
    const grossAmountOut = amount.mul(executableRate);
    const netAmountOut = grossAmountOut.minus(resolved.totalFee);
    const spreadPercent = new Prisma.Decimal(resolved.rateMarkupBps).div(100);

    return {
      fromAssetId: fromAsset.id,
      toAssetId: toAsset.id,
      fromAssetCurrency: fromAsset.currency,
      toAssetCurrency: toAsset.currency,
      fromAssetDecimals: fromAsset.decimals,
      toAssetDecimals: toAsset.decimals,
      marketRate: marketRate.toNumber(),
      spreadPercent: spreadPercent.toNumber(),
      executableRate: executableRate.toNumber(),
      spreadBps: resolved.rateMarkupBps,
      rateSource: 'BINANCE',
      fetchedAt: rateResult.fetchedAt.toISOString(),
      quoteLockSeconds: 30,
      pairId: resolved.feeLevelCode,
      pairName: resolved.feeLevelCode,
      tierId: resolved.matchedTierId,
      tierName: resolved.matchedTierName,
      matched: {
        pairId: resolved.feeLevelCode,
        pairName: resolved.feeLevelCode,
        tierId: resolved.matchedTierId,
        tierName: resolved.matchedTierName,
      },
      pricingSource: {
        provider: 'BINANCE' as const,
        endpoint: 'api/v3/ticker/bookTicker' as const,
        symbol: rateResult.symbol,
        bid: rateResult.bid,
        ask: rateResult.ask,
        sideUsed: rateResult.sideUsed,
        aedPegApplied: rateResult.aedPegApplied,
        aedPegRate: rateResult.aedPegRate,
        formula: rateResult.formula,
        effectiveBaseRate: rateResult.rate.toString(),
        fetchedAt: rateResult.fetchedAt.toISOString(),
      },
      feeBreakdown: resolved.fees,
      feeTotals: resolved.totals,
      grossAmountOut: grossAmountOut.toNumber(),
      netAmountOut: netAmountOut.toNumber(),
      feeTotal: resolved.totalFee.toNumber(),
      feeCurrency: Object.keys(resolved.totals).find((k) => !['amountIn', 'amountOutGross', 'amountOutNet', 'feeTotal', 'feeCurrency'].includes(k)) || null,
      policyRef: {
        policyCode: `LEVEL:${resolved.feeLevelCode}`,
        policyId: resolved.feeLevelId,
        business: 'SWAP' as const,
        channel: 'ONLINE' as const,
      },
    };
  }

  async findAll(query: SwapTransactionQueryDto, options?: { customerScope?: boolean }) {
    const {
      skip,
      take,
      swapNo,
      ownerId,
      ownerNo,
      ownerType,
      status,
      startDate,
      endDate,
    } = query;
    const where: any = {};

    if (swapNo) where.swapNo = { contains: swapNo };
    if (ownerId) where.ownerId = ownerId;
    // 客户详情页 → 三域交易跳转（第二幕波一）：按客户业务键过滤，见铁律⑥。
    if (ownerNo) where.ownerNo = ownerNo;
    if (ownerType) where.ownerType = ownerType;
    // customerScope 下 status 查询参数按客户可见值展开成原始状态集合再过滤
    // （对齐充值 deposit-transactions.service.ts:191 的「评审 Important 1(a)」，
    // 但落法不同——见下方注释）。admin 侧（非 customerScope）照常按原始值
    // 精确过滤，不受影响。
    if (status) {
      if (options?.customerScope) {
        // 早前（Task 10）这里是「customerScope 下完全忽略 status」——堵住了
        // ?status=FROZEN 的 tipping-off 探测面，但也打哑了 client-web 真在用
        // 的 History 筛选下拉（Swap.tsx 的 Transaction History 状态筛选
        // <select>，SUCCESS/REJECTED 两档）：客户
        // 选「Completed」，列表照旧吐出全部，控件形同虚设且无任何提示。
        //
        // 正确语义：客户面筛选问的是「客户可见状态 = X」，不是「原始
        // status = X」。把 X 展开成所有会被 toCustomerSwapStatus 收敛成 X 的
        // 原始状态集合，再拿这个集合去过滤 —— 不能手工维护一张
        // 「REJECTED → [REJECTED, FROZEN]」平行表：手写表必然跟收敛函数
        // 漂移（教训见 deposit-transactions.service.ts:25-50 那段「白名单
        // 枚举必然滞后于状态机」）。改成从收敛函数反推后，任何新增状态天生
        // 落进正确的桶，没人需要记得同步两处。
        //
        // FROZEN 是特例：它的客户可见值是 REJECTED，不是 FROZEN 自己 ——
        // 展开集合恒为空，`{ in: [] }` 让 Prisma 精确返回零行。这与「筛了一
        // 个真实存在但恰好没有命中记录的状态」返回值完全相同：不报错（报错
        // 本身是可探测面）、不退化成全量（那会变成「传 FROZEN 就看到全部」
        // 的另一种可探测信号）。
        const expanded = Object.values(SwapTransactionStatus).filter(
          (raw) => this.toCustomerSwapStatus(raw) === status,
        );
        where.status = { in: expanded };
      } else {
        where.status = status;
      }
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).swapTransaction.findMany({
        skip: skip ? Number(skip) : 0,
        take: take ? Number(take) : 20,
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          fromAsset: true,
          toAsset: true,
          customer: true,
        },
      }),
      (this.prisma as any).swapTransaction.count({ where }),
    ]);

    return { items, total };
  }

  /** Customer-facing list: same query, scoped to the caller's own swaps. */
  async findAllForCustomer(customerId: string, query: SwapTransactionQueryDto) {
    const result = await this.findAll(
      {
        ...query,
        ownerId: customerId,
        ownerType: 'CUSTOMER',
      },
      { customerScope: true },
    );
    return {
      ...result,
      items: result.items.map((item: any) => this.toCustomerSwapView(item)),
    };
  }

  async findByNoInternal(swapNo: string, tx?: Prisma.TransactionClient) {
    const client: any = tx ?? this.prisma;
    return client.swapTransaction.findUniqueOrThrow({
      where: { swapNo },
      include: { fromAsset: true, toAsset: true },
    });
  }

  /**
   * Load a swap by id with the asset relations ctxFromSwap needs. Nullable.
   * `customer` was added by Task 9 (demo-scenario.service.ts needs
   * customer.sumsubApplicantId / customer.customerNo to build simulated
   * webhook payloads) — existing callers only read asset/status/etc. fields
   * and are unaffected by the extra relation.
   */
  async findByIdInternal(id: string, tx?: Prisma.TransactionClient) {
    const client: any = tx ?? this.prisma;
    return client.swapTransaction.findUnique({
      where: { id },
      include: { fromAsset: true, toAsset: true, customer: true },
    });
  }

  /**
   * 5 态状态机的合法迁移表：COMPLIANCE_PENDING(出生态) → PROCESSING → SUCCESS，
   * 或 COMPLIANCE_PENDING → REJECTED(终态)，或 COMPLIANCE_PENDING → FROZEN(终态)。
   * FROZEN 零出边：制裁冻结只能由 MLRO 撕便签后人工处理，系统不提供解冻边。
   * PROCESSING 刻意没有 FREEZE 出边（腿已开跑，冻结会留半截账）。
   * FAILED/REVERSED 是不可达死枚举（历史行兼容，见 BACKLOG「V6 兑换
   * FAILED/REVERSED 死枚举」），不出现在此表中。
   */
  private readonly transitions: Record<string, Partial<Record<SwapTransactionAction, SwapTransactionStatus>>> = {
    [SwapTransactionStatus.COMPLIANCE_PENDING]: {
      [SwapTransactionAction.KYT_APPROVED]: SwapTransactionStatus.PROCESSING,
      [SwapTransactionAction.KYT_REJECTED]: SwapTransactionStatus.REJECTED,
      [SwapTransactionAction.SLA_BREACH]: SwapTransactionStatus.REJECTED,
      [SwapTransactionAction.FREEZE]: SwapTransactionStatus.FROZEN,
    },
    [SwapTransactionStatus.PROCESSING]: {
      [SwapTransactionAction.SUCCESS]: SwapTransactionStatus.SUCCESS,
    },
    [SwapTransactionStatus.SUCCESS]: {},
    [SwapTransactionStatus.REJECTED]: {},
    // 零出边是**故意的**，不是忘了写。
    [SwapTransactionStatus.FROZEN]: {},
    [SwapTransactionStatus.FAILED]: {},
    [SwapTransactionStatus.REVERSED]: {},
  };

  /**
   * 进入 nextStatus 时该带的 SLA 字段。有配置就起新计时，没配置就清空。
   * slaBreached 一律归 false —— 换了状态就是换了等待对象，旧的破线记录不该跟过来。
   */
  private resolveSlaFields(nextStatus: SwapTransactionStatus) {
    const minutes = SWAP_SLA_MINUTES_BY_STATUS[nextStatus];
    return minutes === undefined
      ? { slaDeadline: null, slaBreached: false }
      : { slaDeadline: new Date(Date.now() + minutes * 60_000), slaBreached: false };
  }

  /**
   * SLA 破线候选扫描。兑换**没有软 SLA** —— 它没有「等自己人」的状态。
   * 扫出来的一律是硬破线（COMPLIANCE_PENDING → REJECTED）。
   */
  async findSlaBreachCandidates(now: Date) {
    return (this.prisma as any).swapTransaction.findMany({
      where: {
        status: SwapTransactionStatus.COMPLIANCE_PENDING,
        slaDeadline: { lt: now },
        slaBreached: false,
      },
    });
  }

  /**
   * 演示用：把 slaDeadline 拨到过去，下一次 cron 扫描即破线。
   * 按业务号查（铁律③：有稳定业务键就别用 id 当查询合同）。
   * `slaDeadline === null` 时拒绝——那说明单子当前状态不计时（终态 /
   * FROZEN / PROCESSING 等外部执行的态），硬拨会让扫描器捞出一个本不该
   * 计时的单去处置。
   *
   * operator 点按钮触发、改了持久字段 → 必须写审计（规则①），走
   * recordByActor（不是 recordSystem——这是人触发的，不是 cron）。
   */
  async setSlaDeadlineByNo(
    swapNo: string,
    slaDeadline: Date,
    actor: { actorId?: string; actorRole?: string },
  ) {
    const row = await (this.prisma as any).swapTransaction.findFirst({
      where: { swapNo },
      select: { id: true, slaDeadline: true, correlationId: true, ownerNo: true },
    });
    if (!row) throw new NotFoundException(`Swap not found: ${swapNo}`);
    if (row.slaDeadline === null) {
      throw new BadRequestException(
        `Swap ${swapNo} is not in an SLA-timed state — nothing to time out`,
      );
    }

    const updated = await (this.prisma as any).swapTransaction.update({
      where: { id: row.id },
      data: { slaDeadline },
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.SWAP_SLA_TIMEOUT_SIMULATED,
        actionDomain: 'SWAP',
        category: AuditCategory.BUSINESS,
        primarySubjectType: AuditEntityTypes.SWAP_TRANSACTION,
        primarySubjectNo: swapNo,
        ownerCustomerNo: row.ownerNo ?? undefined,
        correlationId: row.correlationId ?? undefined,
        subjects: [
          { subjectType: AuditEntityTypes.SWAP_TRANSACTION, subjectNo: swapNo, subjectRole: AuditSubjectRole.PRIMARY },
          ...(row.ownerNo ? [{ subjectType: 'CUSTOMER', subjectNo: row.ownerNo, subjectRole: AuditSubjectRole.OWNER }] : []),
        ],
        reason: 'Demo: SLA deadline moved to the past to trigger an immediate breach on the next scan',
        metadata: { previousSlaDeadline: row.slaDeadline, newSlaDeadline: slaDeadline },
        requestId: `SWAP_SLA_TIMEOUT_SIMULATED_${swapNo}_${randomUUID()}`,
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorNo: actor?.actorId || 'ADMIN_SYSTEM',
        actorDisplayName: actor?.actorId || 'ADMIN_SYSTEM',
        actorRolesAtTime: [actor?.actorRole || 'UNKNOWN'],
      },
    );

    return updated;
  }

  async markStatus(
    swapId: string,
    action: SwapTransactionAction,
    tx: Prisma.TransactionClient,
    opts?: { rejectReason?: SwapRejectReason },
  ): Promise<string> {
    const swap = await (tx as any).swapTransaction.findUnique({ where: { id: swapId } });
    if (!swap) throw new NotFoundException(`Swap not found: ${swapId}`);
    const next = this.transitions[swap.status]?.[action];
    if (!next) {
      throw new BadRequestException(`Invalid transition: ${swap.status} + ${action}`);
    }

    let statusHistory: any[] = [];
    try {
      if (swap.statusHistory) {
        statusHistory = JSON.parse(swap.statusHistory);
        if (!Array.isArray(statusHistory)) statusHistory = [];
      }
    } catch {
      statusHistory = [];
    }
    statusHistory.push({
      status: next,
      timestamp: new Date().toISOString(),
      operator: 'SYSTEM',
      note: `Swap settlement status → ${next}`,
    });

    const updated = await (tx as any).swapTransaction.update({
      where: { id: swapId },
      data: {
        status: next,
        ...this.resolveSlaFields(next),
        ...(opts?.rejectReason ? { rejectReason: opts.rejectReason } : {}),
        completedAt: next === SwapTransactionStatus.SUCCESS ? new Date() : undefined,
        statusHistory: JSON.stringify(statusHistory),
      },
    });

    this.eventEmitter.emit(DomainEventNames.SWAP_STATUS_CHANGED, {
      swapId: updated.id,
      swapNo: updated.swapNo,
      ownerId: updated.ownerId,
      previousStatus: swap.status,
      status: next,
      traceId: updated.traceId,
    });

    return next;
  }

  /** Sumsub KYT webhook 按出账交易 id 认领对应的兑换单（走 @@index([sumsubTxnIdOut])）。 */
  async findBySumsubTxnId(txnId: string) {
    return this.prisma.swapTransaction.findFirst({ where: { sumsubTxnIdOut: txnId } });
  }

  async findOne(id: string) {
    const item = await (this.prisma as any).swapTransaction.findUnique({
      where: { id },
      include: {
        fromAsset: true,
        toAsset: true,
        // 第四批：限制从 CustomerMain 上一个**不存在的列**（`restrictions`）改读真正的
        // 限制账。关系名是 `restrictionRows`（schema.prisma:CustomerMain）。
        // 数据模型是**一行一个 scope**：一张便签一个 restrictionNo，卡多个能力
        // = 同号多行不同 scope，同贴同撕同事务。所以这里拿到的是扁平的行集合，
        // 不是嵌套数组。只取 OPEN，含 SILENT —— admin 面要看全（客户面另有白名单收敛）。
        customer: {
          include: {
            restrictionRows: {
              where: { status: 'OPEN' },
              select: { restrictionNo: true, cause: true, scope: true, visibility: true },
            },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Swap transaction not found');

    // Real-time model: the swap's InternalFund legs are hung directly on the
    // swap via swapTransactionId. Surface them (ordered by legSeq then attempt)
    // so the detail page can list + link through to each fund order, including
    // failed-attempt history rows.
    const internalFunds = await (this.prisma as any).fundsOrder.findMany({
      where: { swapTransactionId: item.id },
      orderBy: [{ legSeq: 'asc' }, { attempt: 'asc' }],
      select: {
        id: true,
        fundsOrderNo: true,
        legSeq: true,
        attempt: true,
        status: true,
        amount: true,
        asset: { select: { currency: true, decimals: true } },
        fromWallet: { select: { walletRole: true } },
        toWallet: { select: { walletRole: true } },
      },
    });

    return { ...item, internalFunds };
  }

  /**
   * 客户面状态收敛。
   *
   * FROZEN 显式收敛成 REJECTED —— 与充值收敛成 COMPLIANCE_PENDING 的选择
   * **故意不同**：充值的 FROZEN 是可逆的（RESUME → COMPLIANCE_PENDING），
   * 收敛成"处理中"是诚实的；兑换的 FROZEN 是零出边终态，收敛成"处理中"就是
   * 一个永远不会兑现的谎，还会让客户端的自刷定时器（client-web/src/pages/
   * Swap.tsx:543 的 hasNonTerminal）永不停止。收敛成 REJECTED 后客户看到
   * 'Unsuccessful'，与普通 KYT 拒绝**逐字相同**，分不出 —— 这正是 tipping-off
   * 要求的。
   *
   * 其余未列入白名单的状态（含未来新增）一律收敛成 COMPLIANCE_PENDING，
   * 与充值同一条「宁可错杀」的兜底。
   */
  toCustomerSwapStatus(status: string): string {
    if (SWAP_CUSTOMER_STATUS_PASSTHROUGH.has(status)) return status;
    if (status === SwapTransactionStatus.FROZEN) return SwapTransactionStatus.REJECTED;
    return SwapTransactionStatus.COMPLIANCE_PENDING;
  }

  /**
   * Customer-facing field whitelist (tipping-off guard). The raw `findOne`
   * row carries investigation-only fields — complianceVerdict/
   * complianceAction/complianceRuleNames (matched Sumsub rule names),
   * sumsubDetailJson (the raw Sumsub getTxn payload), rejectReason,
   * sumsubTxnIdOut/sumsubTxnIdIn, plus internal bookkeeping (traceId,
   * ownerId/ownerNo, quoteSnapshotRef, tbFromTransferId/tbToTransferId/
   * tbFeeTransferId/tbSpreadTransferId, grossAedValue, riskDecisionRef,
   * failureCode/failureReason, statusHistory, needsReview, currentStage) —
   * that must never reach a customer's browser: a DevTools inspection of the
   * JSON response would be enough to tip off a person under sanctions
   * investigation. Only whitelisted fields are returned; this list must stay
   * in lockstep with the `SwapTransaction` interface in
   * client-web/src/pages/Swap.tsx, which is the actual field contract the
   * client reads. Mirrors WithdrawTransactionsService#toCustomerWithdrawView.
   *
   * ⚠️ 2026-08-20 订正：上面这段曾说 swap 的可达状态集里没有 FROZEN 之类会
   * tipping-off 的字面量，所以 status 原样透传——Task 8 加了 FROZEN（零出边
   * 终态，客户本人命中制裁）之后这句话已经过期。status 现在必须经
   * `toCustomerSwapStatus` 收敛，见该方法上的注释。
   *
   * Public (not private): Task 11 defence-in-depth — SwapWorkflowService
   * .initiateSwap also routes its create-response through this allow-list
   * before returning it to the customer controller, so a future edit that
   * reassigns the `swap` local there (e.g. rebinding it to a richer row)
   * can't silently reopen a leak on that route.
   */
  toCustomerSwapView(item: any) {
    return {
      id: item.id,
      swapNo: item.swapNo,
      status: this.toCustomerSwapStatus(item.status),
      fromAmount: item.fromAmount,
      toAmount: item.toAmount,
      netToAmount: item.netToAmount,
      feeAmount: item.feeAmount,
      feeCurrency: item.feeCurrency,
      exchangeRate: item.exchangeRate,
      createdAt: item.createdAt,
      completedAt: item.completedAt,
      fromAsset: item.fromAsset
        ? {
            currency: item.fromAsset.currency,
            code: item.fromAsset.code,
            network: item.fromAsset.network,
            decimals: item.fromAsset.decimals,
          }
        : null,
      toAsset: item.toAsset
        ? {
            currency: item.toAsset.currency,
            code: item.toAsset.code,
            network: item.toAsset.network,
            decimals: item.toAsset.decimals,
          }
        : null,
    };
  }

  /**
   * Customer-facing single-fetch (IDOR guard + tipping-off whitelist).
   * Mirrors WithdrawTransactionsService#findOneForCustomer — moves the
   * ownership check out of the controller (swap-transactions-customer.
   * controller.ts previously threw a bare `Error`, which NestJS turns into a
   * 500 instead of a proper 403) and applies the field whitelist above.
   */
  async findOneForCustomer(id: string, customerId: string) {
    const item = await this.findOne(id);
    if (item.ownerId !== customerId) {
      throw new ForbiddenException('Not your swap transaction');
    }
    return this.toCustomerSwapView(item);
  }

  /**
   * 详情独立页用：客户面按业务键 `swapNo` 取单条（规则 3，禁止以 id 作对外
   * 主查询合同）。镜像 DepositTransactionsService#findOneForCustomerByDepositNo /
   * WithdrawTransactionsService#findOneForCustomerByWithdrawNo：先按
   * `swapNo` + `ownerId` 解出内部 id，再复用 `findOneForCustomer`
   * （IDOR 校验 + `toCustomerSwapView` 白名单）。兑换无充值那种
   * `limitHoldReason` 隐藏单，where 条件只有这两项。
   *
   * 白名单是唯一出口——绝不在这里另拼一份响应体，否则
   * complianceVerdict / sumsubTxnIdOut / rejectReason / needsReview /
   * statusHistory 会从这条新路径漏到客户浏览器。
   */
  async findOneForCustomerBySwapNo(swapNo: string, customerId: string) {
    const row = await (this.prisma as any).swapTransaction.findFirst({
      where: { swapNo, ownerId: customerId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Swap transaction not found');
    return this.findOneForCustomer(row.id, customerId);
  }

  /**
   * Admin detail fetch = findOne + parsed Sumsub compliance detail (Task 10,
   * mirror of WithdrawTransactionsService#findOneForAdmin). Kept separate from
   * `findOne` — that method is also called by the customer-facing controller
   * (swap-transactions-customer.controller.ts), and the raw compliance fields
   * (rule names, reject reason, full Sumsub payload) must not leak there.
   */
  async findOneForAdmin(id: string) {
    const item: any = await this.findOne(id);

    // Sumsub getTxn 报文展示子集 —— parity 2026-08-14：与提现
    // findOneForAdmin 的 parseDetail 逐字同源（withdraw-transactions.service.ts），
    // 废弃此前自造的 {scoringAction, matchedRules: string[]} 形状。
    const parseDetail = (json?: string | null) => {
      if (!json) return null;
      let d: any;
      try {
        d = JSON.parse(json);
      } catch {
        return null;
      }
      // JSON.parse 对合法但非对象的 JSON("null"/"123")不抛,属性访问才炸——挡住。
      if (d === null || typeof d !== 'object') return null;
      const sr = d.scoringResult ?? {};
      return {
        verdict: d.verdict ?? sr.action ?? null,
        reviewStatus: d?.review?.reviewStatus ?? null,
        reviewAnswer: d.review?.reviewResult?.reviewAnswer ?? d.reviewAnswer ?? null,
        score: sr.score ?? null,
        matchedRules: (sr.matchedRules ?? []).filter(Boolean).map((r: any) => ({
          id: r.id,
          name: r.name,
          action: r.action,
          score: r.score,
        })),
        applicantActionIds: (sr.applicantActions ?? [])
          .filter(Boolean)
          .map((a: any) => a.applicantActionId)
          .filter(Boolean),
        tags: (d.typedTags ?? []).filter(Boolean).map((t: any) => t.label),
        raw: d,
      };
    };

    const parsed = parseDetail(item.sumsubDetailJson);
    // swap 补充字段：双腿 txnId（提现单腿没有）。行级 rejectReason/complianceVerdict
    // 走 item 顶层裸列（References 卡消费），不塞进 detail。
    const sumsubDetail = parsed
      ? { ...parsed, txnIdOut: item.sumsubTxnIdOut, txnIdIn: item.sumsubTxnIdIn }
      : null;

    // 第四批：侧栏/References 卡的 `Pending Action` 此前读 CustomerMain 上一个
    // 不存在的列（pendingActionExternalId，该指针随材料请求账重写退役），恒 `—`。
    // 改接材料请求账的活行（PENDING_SUBMISSION / SUBMITTED = 客户还欠着材料）。
    // 只在 admin 投影里查：findOne 是客户面共用的（findOneForCustomer），
    // 材料请求的存在本身属于调查信息，客户面根本不该查它。
    const materialRequests = item.swapNo
      ? await this.prisma.materialRequest.findMany({
          where: {
            orderDomain: 'SWAP',
            orderRef: item.swapNo,
            status: { in: [...MATERIAL_REQUEST_LIVE_STATUSES] },
          },
          select: { requestNo: true, materialType: true, status: true },
        })
      : [];

    return { ...item, sumsubDetail, materialRequests };
  }

  /**
   * Sumsub KYT 裁决证据一次原子写 —— mirror of withdraw saveSumsubVerdict
   * (deliberate fork)。verdict 落 complianceVerdict（swap 既有列名，审计/列表
   * 查询已依赖），score/scoredAt/detailJson 落 parity 三列。tx 必传：与
   * markStatus 同事务，避免"状态回滚而证据留存"。
   */
  async saveSumsubVerdict(
    swapId: string,
    data: { verdict: string; score: number | null; scoredAt: Date; detailJson?: string },
    tx: Prisma.TransactionClient,
  ) {
    return tx.swapTransaction.update({
      where: { id: swapId },
      data: {
        complianceVerdict: data.verdict,
        sumsubScore: data.score,
        sumsubScoredAt: data.scoredAt,
        ...(data.detailJson !== undefined && { sumsubDetailJson: data.detailJson }),
      },
    });
  }

  /** Active leg per legSeq = the row with the MAX attempt for that legSeq. */
  async activeLegsBySeq(swapId: string, tx?: Prisma.TransactionClient) {
    const client: any = tx ?? this.prisma;
    const rows = await client.fundsOrder.findMany({
      where: { swapTransactionId: swapId },
      orderBy: [{ legSeq: 'asc' }, { attempt: 'desc' }],
    });
    const seen = new Set<number>();
    const active: any[] = [];
    for (const r of rows) {
      const seq = r.legSeq ?? 0;
      if (!seen.has(seq)) { seen.add(seq); active.push(r); }
    }
    return active; // one row per legSeq (max attempt)
  }

  /**
   * Recompute the currentStage projection from the active legs and persist it.
   * currentStage = stage of the lowest-legSeq active leg that is NOT yet CLEARED
   * (null when all legs CLEARED). stageOf maps a legSeq → a display stage string.
   *
   * needsReview is NOT derived here — funds_orders have no NEEDS_REVIEW status
   * (the STUCK state is a swap-level flag). It is owned solely by
   * setNeedsReview (raised on SWAP_LEG_STUCK, cleared on resume/SUCCESS).
   */
  async recomputeProjections(
    swapId: string,
    stageOf: (legSeq: number) => string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const active = await this.activeLegsBySeq(swapId, tx);
    const working = active
      .filter((l) => l.status !== 'CLEARED')
      .sort((a, b) => (a.legSeq ?? 0) - (b.legSeq ?? 0))[0];
    const currentStage = working ? stageOf(working.legSeq) : null;
    await (tx as any).swapTransaction.update({
      where: { id: swapId },
      data: { currentStage },
    });
  }

  /** Raise/lower the swap-level STUCK flag (SWAP_LEG_STUCK ↔ resume). */
  async setNeedsReview(swapId: string, needsReview: boolean, tx?: Prisma.TransactionClient) {
    const client: any = tx ?? this.prisma;
    return client.swapTransaction.update({
      where: { id: swapId },
      data: { needsReview },
    });
  }

  async create(
    input: {
      swapNo: string;
      correlationId?: string;
      quoteId: string;
      quoteNo: string | null;
      ownerType: string;
      ownerId: string;
      ownerNo: string | null;
      fromAssetId: string;
      fromAssetCode: string | null;
      fromAmount: Prisma.Decimal;
      toAssetId: string;
      toAssetCode: string | null;
      toAmount: Prisma.Decimal;
      netToAmount: Prisma.Decimal;
      feeAmount: Prisma.Decimal;
      feeCurrency: string | null;
      feeBreakdown: string | null;
      spreadAmount: Prisma.Decimal;
      exchangeRate: Prisma.Decimal;
      tbFromTransferId?: string | null;
      tbToTransferId?: string | null;
      tbFeeTransferId?: string | null;
      tbSpreadTransferId?: string | null;
      traceId: string;
      grossAedValue?: Prisma.Decimal | null;
      /** B2：建单当时的 L1 判定快照（JSON.stringify(L1Snapshot)）。 */
      l1Snapshot?: string;
      status: SwapTransactionStatus;
    },
    tx: Prisma.TransactionClient,
  ) {
    return tx.swapTransaction.create({
      data: {
        swapNo: input.swapNo,
        correlationId: input.correlationId,
        quoteId: input.quoteId,
        quoteNo: input.quoteNo,
        quoteSnapshotRef: input.quoteId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        ownerNo: input.ownerNo,
        status: input.status,
        // 建单不走 markStatus，收口处覆盖不到 —— 这里按同一张配置表补上，
        // 保证「进入 COMPLIANCE_PENDING 就开始计时」对建单这条路也成立。
        ...this.resolveSlaFields(input.status),
        fromAssetId: input.fromAssetId,
        fromAssetCode: input.fromAssetCode,
        fromAmount: input.fromAmount,
        toAssetId: input.toAssetId,
        toAssetCode: input.toAssetCode,
        toAmount: input.toAmount,
        netToAmount: input.netToAmount,
        feeAmount: input.feeAmount,
        feeCurrency: input.feeCurrency,
        feeBreakdown: input.feeBreakdown,
        spreadAmount: input.spreadAmount,
        exchangeRate: input.exchangeRate,
        tbFromTransferId: input.tbFromTransferId ?? null,
        tbToTransferId: input.tbToTransferId ?? null,
        tbFeeTransferId: input.tbFeeTransferId ?? null,
        tbSpreadTransferId: input.tbSpreadTransferId ?? null,
        traceId: input.traceId,
        grossAedValue: input.grossAedValue ?? null,
        l1Snapshot: input.l1Snapshot ?? null,
        completedAt: null,
        statusHistory: JSON.stringify([
          {
            status: input.status,
            timestamp: new Date().toISOString(),
            operator: input.ownerId,
            source: 'CUSTOMER',
            note: `Swap created; status=${input.status}`,
          },
        ]),
      },
      include: { fromAsset: true, toAsset: true },
    });
  }
  /**
   * 某客户名下所有非终态单（供客户级限制冻结在途单用，Task 9）。
   * 终态集合：兑换终态（FAILED/REVERSED 是不可达死枚举）。
   */
  async findNonTerminalByOwner(ownerId: string) {
    return this.prisma.swapTransaction.findMany({
      where: { ownerId, status: { notIn: [...SWAP_FREEZE_SCAN_EXCLUDED] } },
      // ownerNo：Review Fix 4（Minor，2026-08-20）—— 监听器驱动的 SWAP_FROZEN
      // 审计要带业务键（entityOwnerNo），与本单裁决驱动那条对齐，同时满足铁律③
      // （有业务键就别只用 id）。
      // 站3·出生锁：+fromAmount——批量冻单的 SWAP_FROZEN 留痕要携退还金额。
      // 站3·词表：+correlationId——SWAP_FROZEN 是 INHERIT 码，信封不带旅程号会被机器闸拒收。
      select: { id: true, swapNo: true, ownerType: true, ownerId: true, ownerNo: true, status: true, traceId: true, fromAmount: true, correlationId: true },
    });
  }

}
