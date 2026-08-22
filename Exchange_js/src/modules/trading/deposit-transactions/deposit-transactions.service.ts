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
// label 一一对应。仅 customerScope 生效，admin 侧的 status 参数行为不受
// 影响。
//
// PROCESSING 桶用补集定义（评审 Important 2），不是白名单枚举。白名单式
// 定义曾经漏掉 OPERATION_PENDING——它是合规已通过、金额低于下限等运营处置
// 的中间态，渲染层 getDepositStatusView 靠 DEFAULT_VIEW 兜底把它渲染成
// PROCESSING，但它不在任何桶里：客户在 All Status 里看得到这单（badge 显示
// PROCESSING），切到 PROCESSING 筛选却找不到它——这本身就是一个可探测信号。
// CONFISCATING/CONFISCATED 同理，只是恰好总是带 limitHoldReason 才没在
// 客户面暴露过。根因是白名单枚举必然滞后于状态机：新增状态时如果没人记得
// 手工把它加进 PROCESSING，它就自动落在桶外。改成补集——PROCESSING =
// 「不落在另外五个桶里的一切」——后，这类状态（含未来任何新增状态）天生
// 落进 PROCESSING，与前端 DEFAULT_VIEW 兜底行为天然对齐，不需要再靠人记得
// 同步两处。
//
// 业主定稿（2026-08-06，减法）：ACTION_REQUIRED 桶不再按 actionSubmittedAt
// 拆成"已提交/未提交"两半——渲染层已经不再有这个二元判据（见
// depositStatusView.ts），筛选桶必须跟着一起收口，否则筛选器会重新暴露一个
// 渲染层刻意抹掉的区分：全部 ACTION_PENDING 的单，不论客户交没交材料，一律
// 落在这个桶。
const ACTION_REQUIRED_BUCKET_WHERE = { status: 'ACTION_PENDING' };
const RETURNING_BUCKET_WHERE = { status: 'RETURNING' };
const RETURNED_BUCKET_WHERE = { status: 'RETURNED' };
const SUCCESS_BUCKET_WHERE = { status: 'SUCCESS' };
const FAILED_BUCKET_WHERE = { status: 'FAILED' };

const CUSTOMER_BUCKETS: Record<string, any> = {
  PROCESSING: {
    NOT: {
      OR: [
        ACTION_REQUIRED_BUCKET_WHERE,
        RETURNING_BUCKET_WHERE,
        RETURNED_BUCKET_WHERE,
        SUCCESS_BUCKET_WHERE,
        FAILED_BUCKET_WHERE,
      ],
    },
  },
  ACTION_REQUIRED: ACTION_REQUIRED_BUCKET_WHERE,
  RETURNING: RETURNING_BUCKET_WHERE,
  RETURNED: RETURNED_BUCKET_WHERE,
  SUCCESS: SUCCESS_BUCKET_WHERE,
  FAILED: FAILED_BUCKET_WHERE,
};

// 客户面 status 白名单（复审 Important 1：黑名单反转成白名单）。见
// toCustomerDepositView 的注释——原样下发真实状态字符串会让客户开
// DevTools 直接读到，即便渲染层已经把它们都渲染成同一个 "PROCESSING" 标签。
//
// 为什么是白名单而不是黑名单：`status` 在 DB 里是自由 String 列，不是受约束
// 的枚举。之前这里叫 CUSTOMER_STATUS_COLLAPSE，是个七态黑名单——但黑名单
// 必然滞后：遗留的 REJECTED/EXPIRED 行（状态机收窄前的产物，见
// doc-final/reference/truth/v4-deposit.md 第 2 节）、以及状态机将来任何新增
// 的执法态，只要没人记得手工把它加进黑名单，就会原样下发。这与刚做完的
// CUSTOMER_BUCKETS.PROCESSING 补集化（评审 Important 2，见上方注释）方向直接
// 矛盾——那边刚把"新状态默认落在桶外"的滞后洞堵上，这里的黑名单还是同一种
// 会滞后的设计，必须反过来：只有下面这七个"客户本就该看到真实结果"的态
// 原样输出，其余任何状态——现在的、遗留的、未来新增的——一律收敛成
// 'COMPLIANCE_PENDING'。宁可错杀（未来某个良性新状态也被暂时收敛成"处理
// 中"），不可放过（未来某个执法新状态原样吐给客户）。
const CUSTOMER_STATUS_PASSTHROUGH = new Set<string>([
  'PAYIN_PENDING',
  'COMPLIANCE_PENDING',
  'ACTION_PENDING',
  'SUCCESS',
  'FAILED',
  'RETURNING',
  'RETURNED',
]);

// 客户面 completedAt 白名单（终审 Critical，见 toCustomerDepositView 文档
// 注释）：只有这几个态,「完成时间」对客户才是真实且应当可见的事实。不能
// 反过来问"status 有没有被收敛"——那个判据只在单子仍处于敏感态时成立,
// 单子冻结后又被解冻回 COMPLIANCE_PENDING 时会失效,把冻结期间写下的
// completedAt 原样漏给客户。
const CUSTOMER_COMPLETED_STATUSES = new Set<string>(['SUCCESS', 'FAILED', 'RETURNED']);

/** 充值终态。零出边 —— 材料账的作废监听器也读这一份，不另立第二份定义。 */
export const DEPOSIT_TERMINAL_STATUSES: ReadonlySet<string> = new Set<string>([
  DepositTransactionStatus.SUCCESS,
  DepositTransactionStatus.FAILED,
  DepositTransactionStatus.CONFISCATED,
  DepositTransactionStatus.RETURNED,
  DepositTransactionStatus.SEIZED,
]);

/**
 * 充值域 SLA 配置（2026-08-21 第三批）。key = 进入该状态后开始计时，value = 分钟数。
 * 不在表里的状态 = 不计时（终态、等外部执行的态、FROZEN）。
 *
 * ⚠️ SLA 按「状态」计时，与状态内部发生了什么无关。此前把计时挂在 onHold 回调上
 * 是错的挂法——没收到 onHold 的单永远不计时，那正是「Sumsub 不回、单子永远挂着」
 * 的成因。不要再把任何 SLA 逻辑绑到某个 webhook 上。
 */
const DEPOSIT_SLA_MINUTES_BY_STATUS: Partial<Record<DepositTransactionStatus, number>> = {
  [DepositTransactionStatus.COMPLIANCE_PENDING]: 5,            // 等 Sumsub 回裁决
  [DepositTransactionStatus.ACTION_PENDING]: 7 * 24 * 60,      // 等客户交材料
  [DepositTransactionStatus.MANUAL_CHECKING]: 3 * 24 * 60,     // 软:等合规官
  [DepositTransactionStatus.OPERATION_PENDING]: 1 * 24 * 60,   // 软:等运营
};

/**
 * 软 SLA：破线只置 slaBreached 标记、**不推状态**。
 * 业主裁定：超时的是我们自己人，不能把怠工转嫁给客户——单子该怎么判还得人判。
 */
export const DEPOSIT_SLA_SOFT_STATUSES: ReadonlySet<string> = new Set<string>([
  DepositTransactionStatus.MANUAL_CHECKING,
  DepositTransactionStatus.OPERATION_PENDING,
]);

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
    // 评审 Important 1(a)，安全洞：customerScope 下完全忽略 status 查询参数
    // （客户面只认 bucket）。不这样做的话 GET /deposit-transactions/my?
    // status=FROZEN 直接把状态过滤器交给客户操控——返回非空就等于确认自己
    // 被冻，是比响应体里原样输出 status（见 toCustomerDepositView）更直接
    // 的一个探测面。静默忽略、不报错——报错本身又是一个可探测面。admin 侧
    // 行为不受影响。
    if (status && !options?.customerScope) {
      where.status = Array.isArray(status) ? { in: status } : status;
    }

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
              lifecycle: true,
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
   * `manualReason` 不可比照放行——它取值 EDD_PEP 时等同于告知客户其 PEP 判定。
   *
   * ⚠️ 2026-08-06 已删掉顶层 `actionSubmittedAt`（"全部交齐"缓存）这个口子：
   * 它此前唯一的消费者是客户端拿去改写徽章/收起区块（`getDepositStatusView`
   * 的 submitted 短路 + 详情页的显隐判据），业主定稿拆掉那套机制后，前端
   * 已经不读这个字段——客户面每多一个键就多一分泄漏面，没有消费者就删，
   * 不留着"以防将来用得上"。
   *
   * 2026-08-18 材料请求账 Task 12：本视图曾开过一个 `actions`（子表逐条 action
   * 的 `{seq, submittedAt}`）口子，随专属子表一起物理删除——客户端从未消费过
   * 这个字段（`client-web/src/pages/Deposit.tsx` 的 `Transaction` 接口里没有
   * 它），"补料交齐没交齐"这件事现在只活在材料请求账自己的读面
   * （`client/me/material-requests`），不再走这个端点。
   *
   * `status`（评审 Important 1，安全洞）—— 这是白名单里唯一一个原样值本身
   * 就可能泄密的字段：`id`/`depositNo`/`amount`/`createdAt` 这些字段的取值
   * 对客户不构成新信息，但 `status` 的原始取值直接就是 FROZEN/SEIZED/…，
   * 等同于把"这单被制裁/在办案"这件事写进 JSON。渲染层
   * （client-web/src/utils/depositStatusView.ts）已经把这些状态渲染成和
   * COMPLIANCE_PENDING 一样的 "PROCESSING"，但客户打开 DevTools → Network
   * 面板能直接看到这个接口吐出的原始响应体，不需要依赖前端有没有正确渲染
   * ——设计 §5.2：接口必须服从和渲染层一样的不可区分规则。所以 `status`
   * 在进入这个白名单前必须先经 `CUSTOMER_STATUS_PASSTHROUGH` 收敛，不能
   * 直接透传 `item.status`。
   *
   * 白名单为什么恰好是这七个（`PAYIN_PENDING`/`COMPLIANCE_PENDING`/
   * `ACTION_PENDING`/`SUCCESS`/`FAILED`/`RETURNING`/`RETURNED`）——即为什么
   * 除它们以外的一切都要收敛（`FROZEN`/`SEIZING`/`SEIZED`/`MANUAL_CHECKING`/
   * `CONFISCATING`/`CONFISCATED`/`OPERATION_PENDING`，以及任何未来新增状态）：
   *   - FROZEN / SEIZING / SEIZED —— 制裁/执法处置弧，规则 A（tipping-off
   *     防线）保护的核心对象。
   *   - MANUAL_CHECKING —— 人工复核态，同样不能让客户知道自己的单被单独
   *     拎出来复核。
   *   - CONFISCATING / CONFISCATED —— 没收弧的两个状态；这两个态本来就不在
   *     depositStatusView.ts 的 VIEW_MAP 里，靠 DEFAULT_VIEW 兜底渲染成
   *     "PROCESSING"——如果接口层不提前收敛，会先于前端把原始状态字符串
   *     泄漏出去，服务端必须比前端更早挡住，不能指望"前端不认识这个态就
   *     不显示"当防线。
   *   - OPERATION_PENDING —— 合规已通过、金额低于下限等运营处置的中间态，
   *     同样不在 VIEW_MAP 里、同样渲染成 PROCESSING，同样要提前收敛。
   *   - 白名单以外的任何状态（REJECTED/EXPIRED 这类遗留行、以及状态机将来
   *     任何新增的执法态）——同样收敛，不需要等人手工把它加进黑名单，
   *     这正是复审要求把黑名单反转成白名单的原因，见上方
   *     `CUSTOMER_STATUS_PASSTHROUGH` 的定义处注释。
   * 收敛后统一输出字符串 `'COMPLIANCE_PENDING'`——前端拿到后走 VIEW_MAP 的
   * 显式映射（PROCESSING / neutral），与数据库里原生就是 COMPLIANCE_PENDING
   * 的单逐字节相同的呈现，不会分叉出第三种路径。
   * ⚠️ 别把这条"修回去"：下一个人如果看见"服务端返回的 status 字符串跟
   * 数据库存的不一样"觉得像 bug、想改成原样输出——那正是这段注释要拦住的
   * 那次修改。
   *
   * `completedAt`（复审 Critical 1，规则 A 的另一处漏洞；终审二次修复）——
   * `status` 被收敛掉之后，`completedAt` 若仍原样透传就会重新捅穿规则 A：
   * 真实 `adminFreeze`/没收/没收结算走的是 `updateStatus`，其中
   * FROZEN/SEIZED/CONFISCATED 都会把 `completedAt` 写成 `new Date()`
   * （见下方 `updateStatus` 里 `TERMINAL.has(nextStatus) || nextStatus ===
   * DepositTransactionStatus.FROZEN` 那段），且**从不清除**。
   *
   * ⚠️ 判据不能用 `statusWasCollapsed`（即 `customerStatus !== item.status`，
   * 判 `status` 是否被 `toCustomerStatus` 改写过）——这只在单子**仍处于**
   * 敏感态时成立，解冻之后就会失效：`deposit-workflow.service.ts` 的
   * `onUnfreezeApproved` 批准解冻后调 `updateStatus(RESUME)`，单子从
   * `FROZEN` 回到 `COMPLIANCE_PENDING`，没有传 `extraData` 去清
   * `completedAt`；而 `COMPLIANCE_PENDING` 本身在 `CUSTOMER_STATUS_PASSTHROUGH`
   * 白名单里原样放行，此时 `customerStatus === item.status`（都是
   * `COMPLIANCE_PENDING`），`statusWasCollapsed` 判 false，冻结期间写下的
   * 时间戳就原样漏给客户——"被冻过又解冻"的客户由此能看出自己被冻过，
   * 恰恰是最不该被通风报信的人群。
   *
   * 改为白名单 `CUSTOMER_COMPLETED_STATUSES`（`SUCCESS`/`FAILED`/
   * `RETURNED`）：只有这几个态,「完成时间」对客户才是真实且应当可见的
   * 事实，其余情况（含"仍在敏感态"与"被冻过又解冻回 COMPLIANCE_PENDING"
   * 这两类）一律输出 null，不能把正常的完成时间也吞掉。
   */
  private toCustomerDepositView(item: any) {
    const customerStatus = this.toCustomerStatus(item.status);
    return {
      id: item.id,
      depositNo: item.depositNo,
      status: customerStatus,
      amount: item.amount,
      createdAt: item.createdAt,
      completedAt: CUSTOMER_COMPLETED_STATUSES.has(customerStatus) ? item.completedAt : null,
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
    };
  }

  /**
   * `status` 收敛的具体实现（白名单放行制，评审 Important 1），见上方
   * `toCustomerDepositView` 文档注释。刻意不是 `private`——
   * inbound-transfer-signals.service.ts 的 scan 端点（复审 Critical 2）
   * 复用这同一个判据收敛它自己返回的 `depositStatus`，不再另写第二份
   * 状态清单。
   *
   * 业主定稿（2026-08-06，减法）：此前这里在 `actionSubmittedAt` 非空时对
   * `ACTION_PENDING` 单独加过一道短路（收敛成 `COMPLIANCE_PENDING`），是为
   * 了追平渲染层 `depositStatusView.ts` 当时的"已提交即收敛"短路——两层各
   * 写一份、必须逐字保持同步的判据，正是最近两轮 Critical 的根源。渲染层
   * 那套机制已被业主拆掉（见 depositStatusView.ts 文件头），这里的短路失去
   * 了存在理由，一并删除：`status` 就是白名单判据本身，`ACTION_PENDING`
   * 不论客户交没交材料，原样下发。
   */
  toCustomerStatus(status: string): string {
    return CUSTOMER_STATUS_PASSTHROUGH.has(status)
      ? status
      : DepositTransactionStatus.COMPLIANCE_PENDING;
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
            lifecycle: true,
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

  /**
   * 详情独立页用：客户面按业务键 `depositNo` 取单条（规则 3，禁止以 id 作
   * 对外主查询合同）。先按 `depositNo` + `ownerId` + `limitHoldReason: null`
   * 解出内部 id 再复用 `findOneForCustomer`，与已删除的补料会话 service 旧版
   * `mustFindOwn` 同一套判据——BELOW_MIN 隐藏单同样当不存在
   * 处理，否则本端点会成为「我有一笔列表里看不到的单」的探测面。
   */
  async findOneForCustomerByDepositNo(depositNo: string, customerId: string) {
    const row = await (this.prisma as any).depositTransaction.findFirst({
      where: { depositNo, ownerId: customerId, limitHoldReason: null },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Deposit transaction not found');
    return this.findOneForCustomer(row.id, customerId);
  }

  /**
   * 进入 nextStatus 时该带的 SLA 字段。有配置就起新计时，没配置就清空。
   * slaBreached 一律归 false —— 换了状态就是换了等待对象，旧的破线记录不该跟过来。
   *
   * 公开的原因：reissue 路径（Sumsub 重发 applicant actions，客户要重新交材料）
   * 状态不变、不走 updateStatus，收口处盖不到它，只能由调用方显式取一次。
   * 这是**唯一**的例外出口 —— 不要因为"方便"从别处调它绕过收口处。
   */
  resolveSlaFields(nextStatus: DepositTransactionStatus) {
    const minutes = DEPOSIT_SLA_MINUTES_BY_STATUS[nextStatus];
    return minutes === undefined
      ? { slaDeadline: null, slaBreached: false }
      : { slaDeadline: new Date(Date.now() + minutes * 60_000), slaBreached: false };
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
      // SLA 字段必须在 extraData 之前展开 —— 调用方显式传的值优先级更高。
      ...this.resolveSlaFields(nextStatus),
      ...(options?.extraData || {}),
    };

    if (DEPOSIT_TERMINAL_STATUSES.has(nextStatus) || nextStatus === DepositTransactionStatus.FROZEN) {
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
    if (DEPOSIT_TERMINAL_STATUSES.has(current)) {
      throw new BadRequestException(
        `Cannot apply action '${action}' to terminal status '${current}'`,
      );
    }

    // 状态机收窄(业主 2026-07-31 定稿;含 2026-08-13 增两条、2026-08-22 退役
    // confiscate_failed 一条、2026-08-22(C1) 增 OPERATION_PENDING--return-->RETURNING
    // 一条后为 14 状态/15 动作/28 边)。每个终态都必须回答
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
        // ACTION_PENDING,挂起闸(holdIfHeld,原 holdBelowMinIfNeeded)下沉到该唯一出口后会从这里
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
        // Sumsub 已通过、异步反转暂不考虑(迟到的 rejected/awaitUser 裁决按业主口径不给边,
        // 见 BACKLOG)。放行:直接入账。没收:异步两阶段(C1)——OPERATION_PENDING →
        // CONFISCATING(资金在途、记账 pending 锁)→ ops 推资金单 → CONFISCATE_SETTLE
        // 落 CONFISCATED。
        [DepositTransactionAction.APPROVE]: DepositTransactionStatus.SUCCESS,
        [DepositTransactionAction.CONFISCATE_START]:
          DepositTransactionStatus.CONFISCATING,
        // 钱躺在 DEPOSIT_SUSPENSE 里等运营处置 → 制裁/MLRO 命中必须冻得住。
        // (判据:钱在哪决定能不能冻。PAYIN_PENDING 不给边——那时 SUSPENSE 是空的,
        //  冻了下游 seize 反冲空账户走不通。)
        [DepositTransactionAction.FREEZE]: DepositTransactionStatus.FROZEN,
        // 2026-08-22(C1):原路退回汇款人。此前 OPERATION_PENDING 只有放行(不该放行)、
        // 上缴(小额充值专属)、冻结(执法级)三条出边——L1 行政级挂起(客户账户已暂停/
        // 生命周期非 ACTIVE)的单在这里无路可走。退回走 MLRO maker-checker 审批,
        // 批准后才由 onReturnApproved 走到这条边(与 MANUAL_CHECKING 同一条落地路径)。
        [DepositTransactionAction.RETURN]: DepositTransactionStatus.RETURNING,
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
        // 2026-08-22(A3):唯一出边。没收腿 FAILED/TIMEOUT 不再退状态——改重试三级梯,
        // 耗尽后单子原地留 CONFISCATING + 置 needsReview 红标(业主定稿:「卡住了」是一
        // 面旗,不是一个状态),与 RETURNING/SEIZING 两条处置弧完全同形状。
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

  /**
   * L1 闸门快照落库(B4)。Gate 0 每跑一次求值就覆盖写一次 —— 快照是「这一刻
   * 九格分别判成什么」的存证,不是流水,只留最近一次。
   *
   * 由本 service 提供而不是让 workflow 直接 update:铁律⑤(workflow 禁止直接写
   * domain 实体的 Prisma 表)。形状照抄 saveTxnDetail —— 只写这一列,不碰状态、
   * 不碰挂起原因。
   *
   * ⚠️ 这一列**不在** toCustomerDepositView 的白名单里,客户面拿不到(它是构造式
   * 白名单,新增列天生不外泄)。业主 2026-08-22:后端不做 tipping-off 脱敏,快照
   * 可以带 cause/holdReason 明细,页面不漏字即可。别把它加进任何客户面视图。
   */
  async saveL1Snapshot(id: string, json: string) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: { l1Snapshot: json },
    });
  }

  /** Sumsub getTxn 原始报文存证(乙口径落库)。 */
  async saveTxnDetail(id: string, json: string) {
    return (this.prisma as any).depositTransaction.update({ where: { id }, data: { sumsubTxnDetailJson: json } });
  }

  /**
   * 按 id 直接设置/刷新一条 deposit 的 slaDeadline，不触发状态变更。
   *
   * ⚠️ 2026-08-21：Task 3 把计时改为进入状态时统一设（见 resolveSlaFields，
   * 在 updateStatus 等状态机收口处调用）之后，这个方法**已无任何调用方**。
   * 保留是有意的——后续「模拟超时」端点需要按 id 直接改 deadline 来演示
   * 破线，到时会调它。**不要**拿它在正常业务流程里设 deadline——那是状态
   * 机收口处（resolveSlaFields）的职责，绕过收口处设 deadline 又会重蹈
   * Task 3 刚修掉的覆盖面缺口。
   */
  async setSlaDeadline(id: string, slaDeadline: Date) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: { slaDeadline },
    });
  }

  /**
   * 演示用：把 slaDeadline 拨到过去，下一次 cron 扫描即破线。
   * 按业务号查（铁律③：有稳定业务键就别用 id 当查询合同），内部解出 id 后
   * 复用 setSlaDeadline。`slaDeadline === null` 时拒绝——那说明单子当前
   * 状态不计时（终态 / FROZEN / 等外部执行的态），硬拨会让扫描器捞出一个
   * 本不该计时的单去处置。
   *
   * operator 点按钮触发、改了持久字段 → 必须写审计（规则①），走
   * recordByActor（不是 recordSystem——这是人触发的，不是 cron）。
   */
  async setSlaDeadlineByNo(
    depositNo: string,
    slaDeadline: Date,
    actor: { actorId?: string; actorRole?: string },
  ) {
    const row = await (this.prisma as any).depositTransaction.findFirst({
      where: { depositNo },
      select: { id: true, slaDeadline: true, ownerType: true, ownerId: true },
    });
    if (!row) throw new NotFoundException(`Deposit not found: ${depositNo}`);
    if (row.slaDeadline === null) {
      throw new BadRequestException(
        `Deposit ${depositNo} is not in an SLA-timed state — nothing to time out`,
      );
    }

    const updated = await this.setSlaDeadline(row.id, slaDeadline);

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.DEPOSIT_SLA_TIMEOUT_SIMULATED,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: row.id,
        entityNo: depositNo,
        entityOwnerType: row.ownerType,
        entityOwnerId: row.ownerId,
        workflowType: 'DEPOSIT',
        reason: 'Demo: SLA deadline moved to the past to trigger an immediate breach on the next scan',
        metadata: { previousSlaDeadline: row.slaDeadline, newSlaDeadline: slaDeadline },
        requestId: `DEPOSIT_SLA_TIMEOUT_SIMULATED_${depositNo}_${randomUUID()}`,
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor?.actorId || 'ADMIN_SYSTEM',
        actorRole: actor?.actorRole,
      },
    );

    return updated;
  }

  /**
   * 软 SLA 破线：只置标记，**不碰 status**。
   * 业主裁定（2026-08-21）：等自己人的状态超时了，超时的是我们自己，
   * 不能把怠工转嫁给客户——单子该怎么判还得人判，系统只负责把它标红催人。
   */
  async markSlaBreached(id: string) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: { slaBreached: true },
    });
  }

  /**
   * 红标：资金腿重试耗尽后由 workflow 置起。**只写这一列，绝不碰状态** ——
   * 三个在途处置态（CONFISCATING/RETURNING/SEIZING）卡死时单子留在原地，
   * 「卡住了」这件事靠这面旗表达，不靠状态迁移（业主 2026-08-22 定稿）。
   * 与 WithdrawTransactionsService.markNeedsReview/clearNeedsReview 同构；
   * 兑换域是单个切换方法 SwapTransactionsService.setNeedsReview(id, bool, tx)
   * —— 三域故意分叉，各写各的形状，不抽 helper。
   */
  async markNeedsReview(id: string) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: { needsReview: true },
    });
  }

  /** 处置成功落地后清旗（运营卫生）。 */
  async clearNeedsReview(id: string) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: { needsReview: false },
    });
  }

  /**
   * SLA 破线候选扫描。硬软两类都扫，由 DepositSlaService 按状态分流：
   *   硬（COMPLIANCE_PENDING / ACTION_PENDING）→ 推 MANUAL_CHECKING
   *   软（MANUAL_CHECKING / OPERATION_PENDING）→ 只置 slaBreached
   */
  async findSlaBreachCandidates(now: Date) {
    return (this.prisma as any).depositTransaction.findMany({
      where: {
        status: {
          in: [
            DepositTransactionStatus.COMPLIANCE_PENDING,
            DepositTransactionStatus.ACTION_PENDING,
            DepositTransactionStatus.MANUAL_CHECKING,
            DepositTransactionStatus.OPERATION_PENDING,
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

  /**
   * Clears the hold flag (whatever the reason was). Does not touch status.
   * Two callers, each picking its own reasons in the workflow layer:
   *   waiveLimitHold          — ops 手动解除，认任何非空挂起原因（B4 §3）
   *   clearAdministrativeHold — 退回落地，只认行政级（C1 复审，BELOW_MIN 继续藏）
   */
  async clearLimitHold(id: string) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: { limitHoldReason: null },
    });
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
  /**
   * 某客户名下所有非终态单（供客户级限制冻结在途单用，Task 9）。
   * 终态集合：充值终态（v4-deposit truth §2）。
   */
  async findNonTerminalByOwner(ownerId: string) {
    return this.prisma.depositTransaction.findMany({
      // FROZEN 在排除之列（2026-08-20）：本方法唯一的调用方是
      // onCustomerRestrictionOpened，已经冻了的单不需要再冻一次。不排除的话
      // 制裁路径「先冻人→广播→自己的监听器扫到自己刚冻的这笔」会走到无 FREEZE
      // 自环边的 FROZEN 行上抛 BadRequest，被吞成一条与事实不符的 warn。
      where: { ownerId, status: { notIn: ['SUCCESS', 'FAILED', 'CONFISCATED', 'RETURNED', 'SEIZED', 'FROZEN'] } },
      select: { id: true, depositNo: true, ownerType: true, ownerId: true, status: true, traceId: true },
    });
  }

}
