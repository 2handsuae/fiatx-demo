import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  DepositTransactionQueryDto,
  DepositTransactionStatus,
  UpdateDepositTransactionStatusDto,
  DepositTransactionAction,
} from './dto/deposit-transaction.dto';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DepositStatusChangedEvent } from './events/deposit-transaction.events';
import { randomUUID } from 'crypto';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import { FundsOrderStatus } from '../../funds-orders/dto/funds-order.dto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { TransactionLimitRulesService } from '../../asset-treasury/transaction-limits/transaction-limit-rules.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';

type DepositWriteClient = Prisma.TransactionClient | PrismaService;

// 客户面筛选桶：必须与 client-web/src/utils/depositStatusView.ts 渲染出的
// label 一一对应。ACTION_PENDING 按「是否已提交」劈成两半——已提交的渲染成
// PROCESSING，就必须归进 PROCESSING 桶；否则该单被冻时会从 ACTION_REQUIRED
// 桶里消失，客户用筛选器就能看出自己这单出事了。仅 customerScope 生效，
// admin 侧的 status 参数行为不受影响。
const CUSTOMER_BUCKETS: Record<string, any> = {
  PROCESSING: {
    OR: [
      { status: { in: ['PAYIN_PENDING', 'COMPLIANCE_PENDING', 'FROZEN', 'SEIZING', 'SEIZED', 'MANUAL_CHECKING'] } },
      { status: 'ACTION_PENDING', actionSubmittedAt: { not: null } },
    ],
  },
  ACTION_REQUIRED: { status: 'ACTION_PENDING', actionSubmittedAt: null },
  RETURNING: { status: 'RETURNING' },
  RETURNED: { status: 'RETURNED' },
  SUCCESS: { status: 'SUCCESS' },
  FAILED: { status: 'FAILED' },
};

export interface DepositStatusUpdateActorContext {
  actorType: string;
  actorId: string;
  actorNo?: string;
  actorRole?: string;
  sourcePlatform?: string;
}

export interface DepositStatusUpdateOptions {
  tx?: Prisma.TransactionClient;
  actor?: DepositStatusUpdateActorContext;
  traceId?: string;
  workflowType?: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  statusHistoryContext?: Record<string, unknown>;
  sourcePlatform?: string;
  // Additional deposit columns to persist in the same update as the status change
  // (e.g. manualReason on COMPLIANCE_PENDING → ACTION_PENDING). Single-table, single-write.
  extraData?: Record<string, unknown>;
}

@Injectable()
export class DepositTransactionsService {
  private readonly logger = new Logger(DepositTransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly fundsOrders: FundsOrderService,
    private readonly auditLogsService: AuditLogsService,
    private readonly limitRulesService: TransactionLimitRulesService,
    private readonly approvalsService: ApprovalsService,
  ) {}

  private getDb(tx?: Prisma.TransactionClient): DepositWriteClient {
    return tx ?? this.prisma;
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  }

  private deriveDepositType(assetType?: string | null): 'crypto' | 'fiat' {
    return String(assetType || '').toUpperCase() === 'CRYPTO' ? 'crypto' : 'fiat';
  }

  async findAll(
    query: DepositTransactionQueryDto,
    options?: { customerScope?: boolean },
  ) {
    const {
      skip,
      take,
      depositNo,
      ownerId,
      ownerType,
      assetId,
      toWalletId,
      status,
      startDate,
      endDate,
      bucket,
    } = query;
    const where: any = {};

    if (depositNo) where.depositNo = { contains: depositNo };
    if (ownerId) where.ownerId = ownerId;
    if (ownerType) where.ownerType = ownerType;
    if (assetId) where.assetId = assetId;
    if (toWalletId) where.toWalletId = toWalletId;
    if (status) where.status = Array.isArray(status) ? { in: status } : status;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    // BELOW_MIN deposits are hold-pending admin disposition; the customer
    // must never see them (server-side, not a frontend hide).
    if (options?.customerScope) where.limitHoldReason = null;

    // 客户面筛选桶，仅 customerScope 生效。未知桶名 → 忽略（等同 All
    // Status），不报错——报错本身又是一个可探测面。
    if (options?.customerScope && bucket) {
      const bucketWhere = CUSTOMER_BUCKETS[bucket];
      if (bucketWhere) Object.assign(where, bucketWhere);
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).depositTransaction.findMany({
        skip: skip ? Number(skip) : 0,
        take: take ? Number(take) : 20,
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          asset: true,
          wallet: true,
          customer: {
            select: {
              customerNo: true,
              firstName: true,
              lastName: true,
              email: true,
              onboardingStatus: true,
              adminStatus: true,
              complianceStatus: true,
            },
          },
        },
      }),
      (this.prisma as any).depositTransaction.count({ where }),
    ]);

    return {
      items: items.map((item: any) => ({
        ...item,
        ownerNo:
          item.ownerNo ||
          (item.ownerType === 'CUSTOMER' ? item.customer?.customerNo || null : null),
        type: this.deriveDepositType(item.asset?.type),
      })),
      total,
    };
  }

  /** Customer-facing list: same query, scoped to the caller's own deposits with BELOW_MIN hold-pending rows hidden. */
  async findAllForCustomer(customerId: string, query: DepositTransactionQueryDto) {
    const result = await this.findAll(
      { ...query, ownerId: customerId },
      { customerScope: true },
    );
    return {
      ...result,
      items: result.items.map((item: any) => this.toCustomerDepositView(item)),
    };
  }

  /**
   * Customer-facing field whitelist (tipping-off guard). The raw Prisma row
   * carries investigation-only fields — statusHistory entries quote sanctions,
   * seizure and KYT verdicts verbatim (e.g. "Seizure approved (funds in transit
   * to government custody)"), plus manualReason, the sumsub, kyt and
   * travelRule metadata fields, limitHoldReason, slaDeadline/slaBreached —
   * that must never reach
   * a customer's browser: a DevTools inspection of the JSON response would be
   * enough to tip off a person under investigation. Only whitelisted fields
   * are returned; this list must stay in lockstep with the `Transaction`
   * interface in client-web/src/pages/Deposit.tsx, which is the actual field
   * contract the client reads.
   *
   * 例外 —— `actionSubmittedAt` 是本白名单唯一有意开的口子：它记录的是
   * **客户自己的动作**（客户本就知道自己交没交，不构成新信息），且对执法态
   * 与正常态一视同仁地存在（提交过的单无论后来是 FROZEN 还是
   * COMPLIANCE_PENDING 该值都在），因此不产生新的可辨识信号。
   * `manualReason` 不可比照办理——它取值 EDD_PEP 时等同于告知客户其 PEP 判定。
   */
  private toCustomerDepositView(item: any) {
    return {
      id: item.id,
      depositNo: item.depositNo,
      status: item.status,
      amount: item.amount,
      createdAt: item.createdAt,
      completedAt: item.completedAt,
      txHash: item.txHash,
      referenceNo: item.referenceNo,
      fromAddress: item.fromAddress,
      fromIban: item.fromIban,
      asset: item.asset
        ? {
            currency: item.asset.currency,
            code: item.asset.code,
            network: item.asset.network,
            decimals: item.asset.decimals,
          }
        : null,
      actionSubmittedAt: item.actionSubmittedAt,
    };
  }

  async findOne(id: string) {
    const item = await (this.prisma as any).depositTransaction.findUnique({
      where: { id },
      include: {
        asset: true,
        wallet: true,
        fromWallet: true,
        fundsOrders: true,
        customer: {
          select: {
            customerNo: true,
            firstName: true,
            lastName: true,
            email: true,
            onboardingStatus: true,
            adminStatus: true,
            complianceStatus: true,
            sumsubApplicantId: true,
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Deposit transaction not found');

    const deposit = item as any;
    let ownerNo = deposit.ownerNo;
    if (!ownerNo && deposit.ownerType === 'CUSTOMER' && deposit.customer) {
      ownerNo = deposit.customer.customerNo;
    }

    // Unified fund-order list for the detail page's "Linked Funds Orders".
    // A deposit's payin funds_order (legSeq=1) is the principal in. A
    // below-minimum confiscation books a second funds_order (legSeq>1) hung
    // under the same deposit — surface both so the confiscation leg is
    // visible on the detail page (三合一, deposits' fee leg = confiscation).
    const fundsOrders = deposit.fundsOrders ?? [];
    const payinOrder =
      fundsOrders.find((f: any) => !f.legSeq || f.legSeq === 1) ?? null;
    const linkedFundOrders: Array<{
      kind: 'PAYIN' | 'CONFISCATION';
      no: string;
      id: string;
      status: string;
      amount: string;
      role: 'principal' | 'fee';
    }> = fundsOrders.map((fo: any) => {
      const isConfiscation = fo.legSeq != null && fo.legSeq > 1;
      return {
        kind: isConfiscation ? 'CONFISCATION' : 'PAYIN',
        no: fo.fundsOrderNo,
        id: fo.id,
        status: fo.status,
        amount: String(fo.amount),
        role: isConfiscation ? 'fee' : 'principal',
      };
    });

    return {
      ...item,
      ownerNo,
      type: this.deriveDepositType(deposit.asset?.type),
      payinNo: payinOrder?.fundsOrderNo,
      payinStatus: payinOrder?.status || null,
      payinType: null,
      toWalletNo: deposit.wallet?.walletNo,
      fromWalletNo: deposit.fromWallet?.walletNo,
      linkedFundOrders,
    };
  }

  /**
   * Admin detail fetch = findOne + 该单最近一次 Sumsub webhook。
   *
   * 为什么单开一个方法而不是塞进 `findOne`:`findOne` 在状态机热路径里被反复调用
   * (applyKytVerdict / approveDeposit / 各处置弧),给它加一条 webhook 查询是白付
   * 的代价。只有 admin 详情页需要这段。
   *
   * 为什么需要:详情页的 "Sumsub References" 此前只展示提交时拿到的两个 txnId ——
   * 静态、提交后再不变;operator 看不到 Sumsub 最近一次说了什么(裁决事件、什么时候
   * 到的、有没有处理成功),排查只能翻库。
   */
  async findOneForAdmin(id: string) {
    const item: any = await this.findOne(id);

    // Sumsub getTxn 报文展示子集(Task 2 落库的原始报文 → 详情页可读字段)。
    const parseDetail = (json?: string | null) => {
      if (!json) return null;
      let d: any;
      try {
        d = JSON.parse(json);
      } catch {
        return null;
      }
      // JSON.parse 对合法但非对象的 JSON(如 "null"/"123"/'"str"')不抛,紧接着的
      // 属性访问会在 null 上炸 → 未捕获 500。这里挡住非对象结果。
      if (d === null || typeof d !== 'object') return null;
      const sr = d.scoringResult ?? {};
      return {
        // 生产 HttpSumsubTxnClient.getTxn 的 raw(SumsubKytTxnResponse)没有顶层 verdict
        // 字段,只有 scoringResult.action(Sumsub 规则动作:score/onHold/awaitUser/reject)
        // 和 review.reviewResult.reviewAnswer —— 只有 fixtures 的 buildRawDetail 才塞了
        // 顶层 verdict。回退到 scoringResult.action,否则生产环境下这里恒为 null,详情页
        // Verdict 行空白。
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
        // matchedRules/applicantActions 同理:含 null 元素的数组在 .map 前先 .filter(Boolean),
        // 防止 t.label 在 null 上炸出 TypeError。
        tags: (d.typedTags ?? []).filter(Boolean).map((t: any) => t.label),
        raw: d, // 供订单下方原文折叠
      };
    };

    const sumsubDetail = parseDetail(item.sumsubTxnDetailJson);

    // 内部审批单反查(仅单头,业主定:不含 step/steps)。四种充值审批发起时
    // entityRef 全部落 deposit.id,ApprovalsService.list 已支持 entityRef 过滤。
    const approvalPage = await this.approvalsService.list({ entityRef: item.id } as any);
    const approvals = (approvalPage.items ?? []).map((a: any) => ({
      approvalNo: a.approvalNo,
      actionType: a.actionType,
      status: a.status,
      createdAt: a.createdAt,
    }));

    if (!item.sumsubTxnId) {
      return { ...item, sumsubDetail, approvals, latestSumsubWebhook: null };
    }

    // webhook 事件表不挂 depositId 外键(它是全站 Sumsub 事件的落地表),只能靠
    // rawPayload 里的 txnId 反查 —— SQLite 无 JSON 索引,用 contains 足够:
    // 这是单条详情页读取,不是批量。
    const events = await (this.prisma as any).sumsubWebhookEvent.findMany({
      where: { rawPayload: { contains: `"${item.sumsubTxnId}"` } },
      orderBy: { receivedAt: 'desc' },
      take: 1,
      select: {
        eventNo: true,
        eventType: true,
        status: true,
        receivedAt: true,
        processedAt: true,
        lastErrorMessage: true,
        isSimulated: true,
      },
    });

    return { ...item, sumsubDetail, approvals, latestSumsubWebhook: events[0] ?? null };
  }

  /**
   * Customer-facing single-fetch. Two rows are treated as non-existent (same
   * NotFound as a missing id — never leak existence via a different error):
   *  1. a deposit owned by another customer (IDOR guard), and
   *  2. a BELOW_MIN hold-pending deposit (admin-only until disposed).
   */
  async findOneForCustomer(id: string, customerId: string) {
    const item = await this.findOne(id);
    const deposit = item as any;
    if (deposit.ownerId !== customerId) {
      throw new NotFoundException('Deposit transaction not found');
    }
    if (deposit.limitHoldReason != null) {
      throw new NotFoundException('Deposit transaction not found');
    }
    return this.toCustomerDepositView(item);
  }

  async updateStatus(
    id: string,
    dto: UpdateDepositTransactionStatusDto,
    options?: DepositStatusUpdateOptions,
  ) {
    const db = this.getDb(options?.tx);
    const transaction = await (db as any).depositTransaction.findUnique({
      where: { id },
    });
    if (!transaction) throw new NotFoundException('Deposit transaction not found');

    const currentStatus = transaction.status as DepositTransactionStatus;
    const action = dto.action;
    const nextStatus = this.getNextStatus(currentStatus, action);

    // States that post to TigerBeetle must only be reached via DepositWorkflowService
    // (SUCCESS via approveDeposit's Step2; CONFISCATING via startConfiscation's two
    // pending legs, then CONFISCATED via C3's settle post). A direct admin PATCH must never flip a
    // deposit into one of these, or it would carry the terminal semantics with no ledger
    // legs. The workflow's own updateStatus calls pass no ADMIN_API source, so they pass.
    const isAdminApi = options?.sourcePlatform === 'ADMIN_API';
    const ACCOUNTING_TERMINALS = new Set([
      DepositTransactionStatus.SUCCESS,
      DepositTransactionStatus.CONFISCATED,
      DepositTransactionStatus.CONFISCATING,
    ]);
    if (isAdminApi && ACCOUNTING_TERMINALS.has(nextStatus)) {
      throw new BadRequestException({
        code: 'DEPOSIT_APPROVE_WORKFLOW_ONLY',
        message:
          'Deposit progression that posts to TigerBeetle must go through DepositWorkflowService, not a direct admin status patch.',
        details: { nextStatus },
      });
    }

    const historyEntry = {
      status: nextStatus,
      timestamp: new Date().toISOString(),
      operatorId:
        options?.actor?.actorId ||
        this.normalizeOptionalString(options?.sourcePlatform) ||
        'SYSTEM',
      actorType: options?.actor?.actorType || 'SYSTEM',
      actorRole: options?.actor?.actorRole || null,
      reason: options?.reason || dto.reason || action,
      context: options?.statusHistoryContext || null,
    };

    let currentHistory = [];
    try {
      currentHistory = transaction.statusHistory
        ? JSON.parse(transaction.statusHistory)
        : [];
    } catch {
      currentHistory = [];
    }
    currentHistory.push(historyEntry);

    const updateData: any = {
      status: nextStatus,
      statusHistory: JSON.stringify(currentHistory),
      ...(options?.extraData || {}),
    };

    const TERMINAL = new Set([
      DepositTransactionStatus.SUCCESS,
      DepositTransactionStatus.FAILED,
      DepositTransactionStatus.CONFISCATED,
      DepositTransactionStatus.RETURNED,
      DepositTransactionStatus.SEIZED,
    ]);
    if (TERMINAL.has(nextStatus) || nextStatus === DepositTransactionStatus.FROZEN) {
      updateData.completedAt = new Date();
    }

    const updated = await (db as any).depositTransaction.update({
      where: { id },
      data: updateData,
    });

    this.eventEmitter.emit(
      'deposit.status.changed',
      new DepositStatusChangedEvent(
        updated.id,
        currentStatus,
        nextStatus,
        updated.ownerType,
        updated.ownerId,
        updated.assetId,
        updated.amount.toString(),
      ),
    );

    return updated;
  }

  private getNextStatus(
    current: DepositTransactionStatus,
    action: DepositTransactionAction,
  ): DepositTransactionStatus {
    const TERMINAL = new Set([
      DepositTransactionStatus.SUCCESS,
      DepositTransactionStatus.FAILED,
      DepositTransactionStatus.CONFISCATED,
      DepositTransactionStatus.RETURNED,
      DepositTransactionStatus.SEIZED,
    ]);

    if (TERMINAL.has(current)) {
      throw new BadRequestException(
        `Cannot apply action '${action}' to terminal status '${current}'`,
      );
    }

    // 状态机收窄(业主 2026-07-31 定稿,14 状态/15 动作/26 边)。每个终态都必须回答
    // 「钱去哪了」——REJECTED/EXPIRED 是仅有的说不出资金去向的终态(钱已到账却"拒绝"/
    // "过期",资金悬空),已删除。payin 结束就是钱到了,COMPLIANCE_PENDING 之后不再有
    // FAILED(FAIL 的唯一入口是 PAYIN_PENDING)。FROZEN 收窄为只剩两个合法归宿
    // (resume/seize)——直通没收/退回的边已删,处置须先 resume 回 COMPLIANCE_PENDING
    // 走正常弧。完整跃迁表与理由见 doc-final/reference/truth/v4-deposit.md 第 2 节。
    const transitions: Record<
      string,
      Partial<Record<DepositTransactionAction, DepositTransactionStatus>>
    > = {
      [DepositTransactionStatus.PAYIN_PENDING]: {
        [DepositTransactionAction.PAYIN_CONFIRMED]:
          DepositTransactionStatus.COMPLIANCE_PENDING,
        [DepositTransactionAction.FAIL]: DepositTransactionStatus.FAILED,
      },
      [DepositTransactionStatus.COMPLIANCE_PENDING]: {
        [DepositTransactionAction.APPROVE]: DepositTransactionStatus.SUCCESS,
        // 合规通过后才判金额(口径 2026-07-31 反转:旧=先判金额后合规)。
        // 低于下限 → OPERATION_PENDING 等运营处置,没收入口随之上移。
        [DepositTransactionAction.OPERATION_PENDING]:
          DepositTransactionStatus.OPERATION_PENDING,
        [DepositTransactionAction.ACTION_PENDING]:
          DepositTransactionStatus.ACTION_PENDING,
        [DepositTransactionAction.SLA_BREACH]:
          DepositTransactionStatus.MANUAL_CHECKING,
        [DepositTransactionAction.KYT_REJECTED]:
          DepositTransactionStatus.MANUAL_CHECKING,
        [DepositTransactionAction.FREEZE]: DepositTransactionStatus.FROZEN,
      },
      [DepositTransactionStatus.ACTION_PENDING]: {
        [DepositTransactionAction.APPROVE]: DepositTransactionStatus.SUCCESS,
        // 终审 Critical 2 回归闸:approveDeposit 的 oldStatus 白名单接受
        // ACTION_PENDING,金额闸(holdBelowMinIfNeeded)下沉到该唯一出口后会从这里
        // 调 operation_pending 动作——此边此前只从 COMPLIANCE_PENDING 出发存在,
        // 两边前置条件对不上,below-min 单补料后被 approve 翻案时在这里抛 Invalid action。
        [DepositTransactionAction.OPERATION_PENDING]:
          DepositTransactionStatus.OPERATION_PENDING,
        [DepositTransactionAction.SLA_BREACH]:
          DepositTransactionStatus.MANUAL_CHECKING,
        [DepositTransactionAction.KYT_REJECTED]:
          DepositTransactionStatus.MANUAL_CHECKING,
        [DepositTransactionAction.FREEZE]: DepositTransactionStatus.FROZEN,
        [DepositTransactionAction.RESUME]:
          DepositTransactionStatus.COMPLIANCE_PENDING,
      },
      [DepositTransactionStatus.OPERATION_PENDING]: {
        // 只有 2 条,Sumsub 已通过、异步反转暂不考虑(迟到的制裁裁决按业主口径不给边,
        // 见 BACKLOG)。放行:直接入账。没收:异步两阶段(C1)——OPERATION_PENDING →
        // CONFISCATING(资金在途、记账 pending 锁)→ ops 推资金单 → CONFISCATE_SETTLE
        // 落 CONFISCATED。
        [DepositTransactionAction.APPROVE]: DepositTransactionStatus.SUCCESS,
        [DepositTransactionAction.CONFISCATE_START]:
          DepositTransactionStatus.CONFISCATING,
      },
      [DepositTransactionStatus.MANUAL_CHECKING]: {
        [DepositTransactionAction.APPROVE]: DepositTransactionStatus.SUCCESS,
        // 同上(Critical 2):MANUAL_CHECKING 也在 approveDeposit 的 oldStatus 白名单里。
        [DepositTransactionAction.OPERATION_PENDING]:
          DepositTransactionStatus.OPERATION_PENDING,
        // Sumsub 侧 officer 可以把一笔已 completed/RED 的交易改回 awaitingUser
        // (reviewResult 被清空、新增 applicantActions 要客户补料)——2026-07-31 在沙盒
        // 实测过这条路径。改动会再发一个 webhook 过来,我方必须接得住:少了这条边,
        // applyKytAwaitUser 会抛 Invalid action → webhook 三次重试后 DEAD → 单子永久
        // 停在 MANUAL_CHECKING,而 Sumsub 那边其实早就改口了。
        [DepositTransactionAction.ACTION_PENDING]:
          DepositTransactionStatus.ACTION_PENDING,
        [DepositTransactionAction.FREEZE]: DepositTransactionStatus.FROZEN,
        [DepositTransactionAction.RETURN]: DepositTransactionStatus.RETURNING,
      },
      [DepositTransactionStatus.FROZEN]: {
        // 冻结的钱只有两个合法归宿:resume(解冻回 COMPLIANCE_PENDING 重走合规)或
        // seize(政府没收令)。没收/退回不再直通——NOTE: no APPROVE edge here either —
        // a sanctions/MLRO freeze must never be lifted by a single-operator approve.
        // See DepositWorkflowService.approveDeposit's oldStatus whitelist (FROZEN
        // excluded) and applyKytApproved's FROZEN guard.
        [DepositTransactionAction.RESUME]:
          DepositTransactionStatus.COMPLIANCE_PENDING,
        [DepositTransactionAction.SEIZE]: DepositTransactionStatus.SEIZING,
      },
      [DepositTransactionStatus.CONFISCATING]: {
        [DepositTransactionAction.CONFISCATE_SETTLE]:
          DepositTransactionStatus.CONFISCATED,
      },
      [DepositTransactionStatus.RETURNING]: {
        [DepositTransactionAction.RETURNED_DONE]:
          DepositTransactionStatus.RETURNED,
      },
      [DepositTransactionStatus.SEIZING]: {
        [DepositTransactionAction.SEIZED_DONE]:
          DepositTransactionStatus.SEIZED,
      },
    };

    const nextStatus = transitions[current]?.[action];
    if (!nextStatus) {
      throw new BadRequestException(
        `Invalid action '${action}' for status '${current}'`,
      );
    }

    return nextStatus;
  }

  async updateSumsubVerdict(id: string, verdict: string, score?: number | null) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: { sumsubVerdict: verdict, sumsubScore: score ?? null, sumsubScoredAt: new Date() },
    });
  }

  /** Sumsub getTxn 原始报文存证(乙口径落库)。 */
  async saveTxnDetail(id: string, json: string) {
    return (this.prisma as any).depositTransaction.update({ where: { id }, data: { sumsubTxnDetailJson: json } });
  }

  /**
   * Sets/refreshes the SLA deadline for a deposit sitting in onHold
   * (COMPLIANCE_PENDING) or ACTION_PENDING. No status change here — callers
   * manage the transition (or lack thereof) separately via updateStatus.
   */
  async setSlaDeadline(id: string, slaDeadline: Date) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: { slaDeadline },
    });
  }

  /**
   * 落 Sumsub applicant action 引用。三件事一次写完：换 action 引用、
   * 清掉上一轮的客户提交戳（新 action = 客户要重新交东西）、重置 SLA 表。
   * 缺任一件都会让客户端停在"已收到，审核中"而不知道又被要材料了。
   */
  async setActionRefs(
    id: string,
    actionId: string,
    externalActionId: string,
    slaDeadline: Date,
  ) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: {
        sumsubActionId: actionId,
        sumsubExternalActionId: externalActionId,
        actionSubmittedAt: null,
        slaDeadline,
        slaBreached: false,
      },
    });
  }

  /**
   * 客户提交材料。幂等——重复提交不刷新时间戳，避免客户狂点按钮把
   * SLA 表无限续期。**不碰 status**：客户的动作不驱动状态机（真实世界
   * 里也是等 Sumsub 重评后发 webhook 才动）。
   *
   * 用**单条带条件的 updateMany** 而非「先读后写」：调用方靠返回的 `changed`
   * 决定是否写审计，两步式在并发下两个请求都会读到 null、都返回 true，
   * 同一次提交会记出两条审计。条件放进 where 交给 DB 保证互斥后，
   * 只有一个请求能匹配到行。
   *
   * `resetSla`（评审 Important 2）：`actionSubmittedAt` 本身**无条件**盖上——
   * 客户端"已收到"的文案就绑它，冻结态若不盖会产生可观测差异，破坏不可区分性。
   * 但 `slaDeadline`/`slaBreached` 这两个 operator 可见字段只在调用方确认单子
   * 仍处于 ACTION_PENDING 时才重置：SLA 定时器会把超时单打成 MANUAL_CHECKING
   * 且 `slaBreached=true`，而 `findSlaBreachCandidates` 不扫 MANUAL_CHECKING——
   * 若这里无条件清 `slaBreached`，客户单方面一次提交就能把 operator 眼里的
   * 违约旗永久抹掉、且系统再也发现不了。调用方在同一次请求里已经读过该单的
   * status（就是判定要不要走这条提交逻辑的那次读），把判断结果以布尔值传进来，
   * 不引入新的读-改-写。
   */
  async markActionSubmitted(
    id: string,
    slaDeadline: Date,
    resetSla: boolean,
  ): Promise<{ changed: boolean }> {
    const data: Record<string, unknown> = { actionSubmittedAt: new Date() };
    if (resetSla) {
      data.slaDeadline = slaDeadline;
      data.slaBreached = false;
    }
    const res = await (this.prisma as any).depositTransaction.updateMany({
      where: { id, actionSubmittedAt: null },
      data,
    });
    return { changed: res.count > 0 };
  }

  /**
   * SLA timer (Task 10) scan: onHold(COMPLIANCE_PENDING) and ACTION_PENDING
   * deposits whose slaDeadline has passed and haven't been flagged yet.
   */
  async findSlaBreachCandidates(now: Date) {
    return (this.prisma as any).depositTransaction.findMany({
      where: {
        status: {
          in: [
            DepositTransactionStatus.COMPLIANCE_PENDING,
            DepositTransactionStatus.ACTION_PENDING,
          ],
        },
        slaDeadline: { lt: now },
        slaBreached: false,
      },
    });
  }

  /**
   * Persists the single Sumsub txn id + type returned by SumsubTxnClient.submitTxn at
   * Gate 0 submission time (DepositWorkflowService.submitSumsubTxns). One deposit → one txn.
   */
  async setSumsubTxn(
    id: string,
    data: { sumsubTxnId: string; sumsubTxnType: 'finance' | 'travelRule' },
  ) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: {
        sumsubTxnId: data.sumsubTxnId,
        sumsubTxnType: data.sumsubTxnType,
      },
    });
  }

  /**
   * Sumsub KYT webhooks carry the txn id we handed it at submission time
   * (sumsubTxnId). Not the deposit's own id, so this is a stable business-key
   * lookup, not an id-as-contract query.
   */
  async findBySumsubTxnId(txnId: string) {
    return (this.prisma as any).depositTransaction.findFirst({
      where: { sumsubTxnId: txnId },
    });
  }

  /** PASS (waive) disposition: clears the BELOW_MIN hold flag. Does not touch status. */
  async clearLimitHold(id: string) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: { limitHoldReason: null },
    });
  }

  async getOwnerComplianceStatus(depositId: string): Promise<string> {
    const deposit = await (this.prisma as any).depositTransaction.findUnique({
      where: { id: depositId },
      select: { ownerId: true },
    });
    if (!deposit) throw new NotFoundException('Deposit transaction not found');

    const customer = await (this.prisma as any).customerMain.findUnique({
      where: { id: deposit.ownerId },
      select: { complianceStatus: true },
    });
    return customer?.complianceStatus || 'UNKNOWN';
  }

  /**
   * Inbound detection entry (funds_order-driven, replaces the legacy payin.created
   * → orchestratePayinDetected path). Creates the deposit row (PAYIN_PENDING) and
   * its payin funds_order (crypto → SUBMITTED, fiat → CONFIRMED), then records the
   * DEPOSIT_CREATED business audit. DepositWorkflowService reacts to the funds_order's
   * status.changed events (the funds_order IS the payin now).
   *
   * The funds_order is created after the deposit row is persisted so the CONFIRMED-at-
   * birth event (fiat) reaches DepositWorkflowService.onPayinConfirmed with a visible
   * deposit row.
   */
  async detected(input: {
    assetId: string;
    toWalletId: string;
    amount: string;
    txHash?: string | null;
    fromAddress?: string | null;
    fromIban?: string | null;
    referenceNo?: string | null;
    providerTxnId?: string | null;
    traceId?: string;
    counterpartyIsVasp?: boolean | null;
  }) {
    const wallet = await (this.prisma as any).wallet.findUnique({
      where: { id: input.toWalletId },
      include: { asset: true },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.assetId !== input.assetId) {
      throw new BadRequestException('Wallet asset does not match deposit asset');
    }

    const isCrypto =
      String(wallet.asset?.type || '').toUpperCase() === 'CRYPTO';
    const resolvedTraceId = input.traceId ?? randomUUID();
    const depositNo = generateReferenceNo('DEP');

    // L1 金额下限判定(出生落标——deposit 是被动入金,低于 min 不拒绝,建单+隐藏+挂起)
    let limitHoldReason: string | undefined;
    const singleRule = await this.limitRulesService.getSingleRule('DEPOSIT', input.assetId);
    if (singleRule?.minAmount && new Prisma.Decimal(input.amount).lt(new Prisma.Decimal(singleRule.minAmount))) {
      limitHoldReason = 'BELOW_MIN';
    }

    const deposit = await (this.prisma as any).depositTransaction.create({
      data: {
        depositNo,
        traceId: resolvedTraceId,
        ownerType: wallet.ownerType,
        ownerId: wallet.ownerId || 'UNKNOWN',
        status: DepositTransactionStatus.PAYIN_PENDING,
        statusHistory: JSON.stringify([
          {
            status: DepositTransactionStatus.PAYIN_PENDING,
            timestamp: new Date().toISOString(),
            operatorId: 'SYSTEM',
            reason: 'Inbound transfer detected',
          },
        ]),
        assetId: input.assetId,
        toWalletId: input.toWalletId,
        amount: new Prisma.Decimal(input.amount),
        netAmount: new Prisma.Decimal(input.amount),
        feeAmount: new Prisma.Decimal(0),
        txHash: input.txHash ?? undefined,
        referenceNo: input.referenceNo ?? undefined,
        fromAddress: input.fromAddress ?? undefined,
        fromIban: input.fromIban ?? undefined,
        toAddress: wallet.address,
        toIban: wallet.iban,
        limitHoldReason,
        counterpartyIsVasp: input.counterpartyIsVasp ?? null,
      },
    });

    // Payin funds_order. Emitting CONFIRMED-at-birth (fiat) fires the workflow
    // handler synchronously; the deposit row above is already committed.
    const fundsOrder = await this.fundsOrders.create({
      depositTransactionId: deposit.id,
      assetId: input.assetId,
      amount: input.amount,
      toWalletId: input.toWalletId,
      toAddress: wallet.address ?? undefined,
      toIban: wallet.iban ?? undefined,
      fromAddress: input.fromAddress ?? undefined,
      fromIban: input.fromIban ?? undefined,
      txHash: input.txHash ?? undefined,
      referenceNo: input.referenceNo ?? undefined,
      providerTxnId: input.providerTxnId ?? undefined,
      initialStatus: isCrypto
        ? FundsOrderStatus.SUBMITTED
        : FundsOrderStatus.CONFIRMED,
      traceId: resolvedTraceId,
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_CREATED,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: resolvedTraceId,
      workflowType: 'DEPOSIT',
      reason: 'Deposit created from inbound transfer detection',
      metadata: {
        fundsOrderId: fundsOrder.id,
        fundsOrderNo: fundsOrder.fundsOrderNo,
        amount: input.amount,
        assetCurrency: input.assetId,
        txHash: input.txHash ?? null,
        referenceNo: input.referenceNo ?? null,
      },
      sourcePlatform: 'SYSTEM',
    });

    return { deposit, fundsOrder };
  }

  async createRandom(): Promise<any> {
    const results = [];
    for (let i = 0; i < 10; i++) {
      // 1. Get a random asset
      const assets = await (this.prisma as any).asset.findMany({
        where: { status: 'ACTIVE' },
      });
      if (assets.length === 0)
        throw new NotFoundException('No active asset found for demo');
      const asset = assets[Math.floor(Math.random() * assets.length)];

      // 2. Get a random wallet or create one
      let wallet = await (this.prisma as any).wallet.findFirst({
        where: { assetId: asset.id },
      });
      if (!wallet) {
        // Create a demo wallet
        wallet = await (this.prisma as any).wallet.create({
          data: {
            ownerType: 'CUSTOMER',
            ownerId: 'U_DEMO_' + Math.floor(Math.random() * 10000),
            type: asset.type === 'CRYPTO' ? 'CRYPTO_ADDRESS' : 'FIAT_BANK',
            assetId: asset.id,
            status: 'ACTIVE',
            address: asset.type === 'CRYPTO' ? 'T_DEMO_' + Date.now() + i : null,
            iban: asset.type === 'FIAT' ? 'US_DEMO_' + Date.now() + i : null,
          },
        });
      }

      // 3. Generate random amount
      const amount = (Math.random() * 1000 + 10).toFixed(2);

      // 4. Generate deposit no
      const depositNo = generateReferenceNo('DEP');

      // 5. Create
      const deposit = await (this.prisma as any).depositTransaction.create({
        data: {
          depositNo,
          ownerType: 'CUSTOMER',
          ownerId: wallet.ownerId || 'UNKNOWN',
          status: DepositTransactionStatus.PAYIN_PENDING,
          statusHistory: JSON.stringify([
            {
              status: DepositTransactionStatus.PAYIN_PENDING,
              timestamp: new Date().toISOString(),
              operatorId: 'SYSTEM',
              reason: 'Initial creation',
            },
          ]),
          assetId: asset.id,
          toWalletId: wallet.id,
          amount: new Prisma.Decimal(amount),
          netAmount: new Prisma.Decimal(amount),
          feeAmount: new Prisma.Decimal(0),
          fromAddress: asset.type === 'CRYPTO' ? 'T_SENDER_' + Date.now() + i : null,
          fromIban: asset.type === 'FIAT' ? 'US_SENDER_' + Date.now() + i : null,
          txHash:
            asset.type === 'CRYPTO'
              ? '0x' +
                Date.now().toString(16) +
                Math.random().toString(16).substr(2)
              : null,
          referenceNo: asset.type === 'FIAT' ? 'REF_' + Date.now() + i : null,
          toAddress: wallet.address,
          toIban: wallet.iban,
        },
      });
      results.push(deposit);
    }
    return results;
  }
}
