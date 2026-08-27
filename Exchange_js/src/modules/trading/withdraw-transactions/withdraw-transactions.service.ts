import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  WithdrawTransactionQueryDto,
  WithdrawTransactionStatus,
  WithdrawTransactionAction,
  UpdateWithdrawTransactionStatusDto,
} from './dto/withdraw-transaction.dto';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditCategory, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
export type WithdrawStatusUpdateSource = 'ADMIN_API' | 'WORKFLOW' | 'SYSTEM';

/**
 * updateStatus 落库成功后广播的提现单状态变更事件。此前 WITHDRAWAL_STATUS_CHANGED
 * 全仓零 emit 点（死事件）——材料账的作废监听器订了它但从来收不到。补发时字段形状
 * 对齐 SWAP_STATUS_CHANGED（同批新加，三域对称），不沿用 domain-events.constants.ts
 * 里那份从未被满足过的旧 payload 文档（oldStatus/assetId 等）。
 */
export interface WithdrawStatusChangedEvent {
  withdrawId: string;
  withdrawNo: string;
  ownerId: string;
  previousStatus: string;
  status: string;
  traceId: string | null;
}

/** 提现终态。零出边（状态机收窄后不再有 SUCCESS→RETURNED 或终态自环）。 */
export const WITHDRAW_TERMINAL_STATUSES: ReadonlySet<string> = new Set<string>([
  WithdrawTransactionStatus.SUCCESS,
  WithdrawTransactionStatus.REJECTED,
  WithdrawTransactionStatus.FAILED,
  WithdrawTransactionStatus.RETURNED,
]);

/**
 * 提现域 SLA 配置（2026-08-21 第三批）。与充值域各写一份（deliberate fork）。
 * ⚠️ SLA 按「状态」计时——不要把它绑到 onHold 之类的 webhook 上。
 */
const WITHDRAW_SLA_MINUTES_BY_STATUS: Partial<Record<WithdrawTransactionStatus, number>> = {
  [WithdrawTransactionStatus.COMPLIANCE_PENDING]: 5,            // 等 Sumsub 回裁决
  [WithdrawTransactionStatus.ACTION_PENDING]: 7 * 24 * 60,      // 等客户交材料
  [WithdrawTransactionStatus.MANUAL_CHECKING]: 3 * 24 * 60,     // 软:等合规官
  [WithdrawTransactionStatus.PENDING_APPROVAL]: 1 * 24 * 60,    // 软:等审批人
};

export const WITHDRAW_SLA_SOFT_STATUSES: ReadonlySet<string> = new Set<string>([
  WithdrawTransactionStatus.MANUAL_CHECKING,
  WithdrawTransactionStatus.PENDING_APPROVAL,
]);

export interface WithdrawStatusUpdateContext {
  source: WithdrawStatusUpdateSource;
  actorType?: string;
  actorId?: string;
  actorRole?: string;
  sourcePlatform?: string;
  // Additional withdraw columns to persist in the same update as the status change
  // (e.g. manualReason on COMPLIANCE_PENDING → ACTION_PENDING). Single-table, single-write
  // — mirrors DepositStatusUpdateOptions#extraData.
  extraData?: Record<string, unknown>;
}

@Injectable()
export class WithdrawTransactionsService {
  private readonly logger = new Logger(WithdrawTransactionsService.name);
  private readonly systemStatusUpdateContext: WithdrawStatusUpdateContext = {
    source: 'SYSTEM',
    actorType: 'SYSTEM',
    actorId: 'SYSTEM',
    actorRole: 'SYSTEM',
    sourcePlatform: 'SYSTEM',
  };

  private deriveWithdrawType(assetType?: string | null): 'crypto' | 'fiat' {
    return String(assetType || '').toUpperCase() === 'FIAT' ? 'fiat' : 'crypto';
  }

  // 状态机收窄(10 状态/13 动作/21 边,定稿于 .superpowers/sdd/task-1-brief.md Step 1;
  // 2026-08-13 补 PENDING_APPROVAL --freeze--> FROZEN 一条,20→21)。
  // 终态集合 TERMINAL = SUCCESS/REJECTED/FAILED/RETURNED,零出边——不再有 SUCCESS→
  // RETURNED 或终态自环(旧表里"for logging"的边全删)。守则性测试见
  // withdraw-transactions.service.spec.ts 的「state machine integrity guard」。
  private readonly transitions: Record<WithdrawTransactionStatus, Partial<Record<WithdrawTransactionAction, WithdrawTransactionStatus>>> = {
    [WithdrawTransactionStatus.PENDING_APPROVAL]: {
      [WithdrawTransactionAction.GATE_APPROVE]: WithdrawTransactionStatus.COMPLIANCE_PENDING,
      [WithdrawTransactionAction.REJECT]: WithdrawTransactionStatus.REJECTED,
      // 大额审批可挂数天,期间客户可能被冻(材料到期是定时任务自动触发,无人干预即可发生)。
      // 客户的钱此刻已在 TB pending 锁里 → 冻得住、也该冻。
      // (PAYOUT_PENDING 不给这条边:钱已广播上链/发了银行指令,冻不回来——那里保持
      //  既有的「只记 WITHDRAW_POST_BROADCAST_VERDICT 审计 + markNeedsReview」。)
      [WithdrawTransactionAction.FREEZE]: WithdrawTransactionStatus.FROZEN,
    },
    [WithdrawTransactionStatus.COMPLIANCE_PENDING]: {
      [WithdrawTransactionAction.APPROVE]: WithdrawTransactionStatus.PAYOUT_PENDING,
      [WithdrawTransactionAction.ACTION_PENDING]: WithdrawTransactionStatus.ACTION_PENDING,
      [WithdrawTransactionAction.KYT_REJECTED]: WithdrawTransactionStatus.MANUAL_CHECKING,
      [WithdrawTransactionAction.SLA_BREACH]: WithdrawTransactionStatus.MANUAL_CHECKING,
      [WithdrawTransactionAction.FREEZE]: WithdrawTransactionStatus.FROZEN,
    },
    [WithdrawTransactionStatus.ACTION_PENDING]: {
      [WithdrawTransactionAction.APPROVE]: WithdrawTransactionStatus.PAYOUT_PENDING,
      [WithdrawTransactionAction.KYT_REJECTED]: WithdrawTransactionStatus.MANUAL_CHECKING,
      [WithdrawTransactionAction.FREEZE]: WithdrawTransactionStatus.FROZEN,
      [WithdrawTransactionAction.SLA_BREACH]: WithdrawTransactionStatus.MANUAL_CHECKING,
    },
    [WithdrawTransactionStatus.MANUAL_CHECKING]: {
      [WithdrawTransactionAction.APPROVE]: WithdrawTransactionStatus.PAYOUT_PENDING,
      [WithdrawTransactionAction.ACTION_PENDING]: WithdrawTransactionStatus.ACTION_PENDING,
      [WithdrawTransactionAction.FREEZE]: WithdrawTransactionStatus.FROZEN,
      [WithdrawTransactionAction.REJECT_REFUND]: WithdrawTransactionStatus.REJECTED,
    },
    [WithdrawTransactionStatus.FROZEN]: {
      [WithdrawTransactionAction.RESUME]: WithdrawTransactionStatus.COMPLIANCE_PENDING,
      [WithdrawTransactionAction.REJECT_REFUND]: WithdrawTransactionStatus.REJECTED,
    },
    [WithdrawTransactionStatus.PAYOUT_PENDING]: {
      [WithdrawTransactionAction.SUCCESS]: WithdrawTransactionStatus.SUCCESS,
      [WithdrawTransactionAction.FAIL]: WithdrawTransactionStatus.FAILED,
      [WithdrawTransactionAction.RETURN]: WithdrawTransactionStatus.RETURNED,
    },
    [WithdrawTransactionStatus.SUCCESS]: {},
    [WithdrawTransactionStatus.REJECTED]: {},
    [WithdrawTransactionStatus.FAILED]: {},
    [WithdrawTransactionStatus.RETURNED]: {},
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditLogsService: AuditLogsService,
    private readonly approvalsService: ApprovalsService,
  ) {}

  private normalizeStatusUpdateContext(
    context?: WithdrawStatusUpdateContext,
  ): Required<Omit<WithdrawStatusUpdateContext, 'extraData'>> {
    const normalized = context ?? this.systemStatusUpdateContext;
    const source = normalized.source || 'SYSTEM';
    if (source === 'ADMIN_API') {
      return {
        source,
        actorType: normalized.actorType || 'ADMIN',
        actorId: normalized.actorId || 'ADMIN_SYSTEM',
        actorRole: normalized.actorRole || 'ADMIN',
        sourcePlatform: normalized.sourcePlatform || 'ADMIN_API',
      };
    }
    return {
      source,
      actorType: normalized.actorType || 'SYSTEM',
      actorId: normalized.actorId || 'SYSTEM',
      actorRole: normalized.actorRole || 'SYSTEM',
      sourcePlatform: normalized.sourcePlatform || 'SYSTEM',
    };
  }

  private deriveWithdrawComplianceStatusFromStatus(
    status?: string | null,
  ): 'PENDING' | 'CLEAR' | 'HOLD' | 'REJECT' {
    const current = String(status || '').trim().toUpperCase();

    if (current === WithdrawTransactionStatus.MANUAL_CHECKING) {
      return 'HOLD';
    }

    if (current === WithdrawTransactionStatus.REJECTED) {
      return 'REJECT';
    }

    if (
      current === WithdrawTransactionStatus.PAYOUT_PENDING ||
      current === WithdrawTransactionStatus.SUCCESS ||
      current === WithdrawTransactionStatus.FAILED ||
      current === WithdrawTransactionStatus.RETURNED
    ) {
      return 'CLEAR';
    }

    return 'PENDING';
  }

  private mapCanonicalAuditLogs(events: any[]) {
    return events.map((event: any) => {
      // Parse status transition from action string (format: WITHDRAW_FROM_TO_TO)
      const { from: oldStatus, to: newStatus } = this.parseStatusTransitionFromAction(event.action);
      return {
        id: event.id,
        action: event.action || null,
        statusFrom: oldStatus,
        statusTo: newStatus,
        actorType: event.actorType || null,
        actorNo: event.actorNo || null,
        reason: event.reason || null,
        occurredAt: event.occurredAt || event.createdAt || null,
        result: event.result || null,
        oldStatus,
        newStatus,
        operatorId: event.actorNo || null,
        createdAt: event.occurredAt || event.createdAt || null,
      };
    });
  }

  private parseStatusTransitionFromAction(action?: string): { from: string | null; to: string | null } {
    if (!action) return { from: null, to: null };
    const match = action.match(/^WITHDRAW_(.+)_TO_(.+)$/);
    if (!match) return { from: null, to: null };
    return { from: match[1], to: match[2] };
  }

  private async getCanonicalWithdrawAuditLogs(
    withdrawId: string,
    withdrawNo?: string | null,
  ) {
    const events = await (this.prisma as any).auditLogEvent.findMany({
      where: {
        OR: [
          {
            primarySubjectType: AuditEntityTypes.WITHDRAW_TRANSACTION,
            primarySubjectNo: withdrawId,
          },
          withdrawNo
            ? {
                workflowType: AuditWorkflowTypes.WITHDRAW,
                primarySubjectNo: withdrawNo,
              }
            : undefined,
          {
            traceId: `${AuditWorkflowTypes.WITHDRAW}:${withdrawId}`,
          },
        ].filter(Boolean),
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });

    return this.mapCanonicalAuditLogs(events);
  }

  private assertStatusUpdateSourceAllowed(
    nextStatus: WithdrawTransactionStatus,
    context: Required<Omit<WithdrawStatusUpdateContext, 'extraData'>>,
  ) {
    if (
      context.source === 'ADMIN_API' &&
      nextStatus === WithdrawTransactionStatus.PAYOUT_PENDING
    ) {
      throw new BadRequestException({
        code: 'WITHDRAW_APPROVE_WORKFLOW_ONLY',
        message:
          'Withdraw progression to payout pending is driven by risk workflow callback, not direct admin approval.',
        details: {
          source: context.source,
          nextStatus,
        },
      });
    }

    if (
      context.source === 'ADMIN_API' &&
      [
        WithdrawTransactionStatus.SUCCESS,
        WithdrawTransactionStatus.FAILED,
        WithdrawTransactionStatus.RETURNED,
      ].includes(nextStatus)
    ) {
      throw new BadRequestException({
        code: 'WITHDRAW_TERMINAL_ACTION_SYSTEM_ONLY',
        message:
          'Direct withdraw terminal actions are reserved for workflow/system execution.',
        details: {
          source: context.source,
          nextStatus,
        },
      });
    }
  }

  async findAll(query: WithdrawTransactionQueryDto) {
    const {
      skip,
      take,
      withdrawNo,
      ownerId,
      ownerType,
      assetId,
      status,
      startDate,
      endDate,
    } = query;
    const where: any = {};

    if (withdrawNo) where.withdrawNo = { contains: withdrawNo };
    if (ownerId) where.ownerId = ownerId;
    if (ownerType) where.ownerType = ownerType;
    if (assetId) where.assetId = assetId;
    if (status) where.status = Array.isArray(status) ? { in: status } : status;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).withdrawTransaction.findMany({
        skip: skip ? Number(skip) : 0,
        take: take ? Number(take) : 20,
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          asset: true,
          customer: true,
        },
      }),
      (this.prisma as any).withdrawTransaction.count({ where }),
    ]);

    return {
      items: items.map((item: any) => ({
        ...item,
        type: this.deriveWithdrawType(item.asset?.type),
        derivedComplianceStatus: this.deriveWithdrawComplianceStatusFromStatus(
          item.status,
        ),
      })),
      total,
    };
  }

  /** Customer-facing list: same query, scoped to the caller's own withdrawals. */
  async findAllForCustomer(customerId: string, query: WithdrawTransactionQueryDto) {
    const result = await this.findAll({ ...query, ownerId: customerId });
    return {
      ...result,
      items: result.items.map((item: any) => this.toCustomerWithdrawView(item)),
    };
  }

  /**
   * Customer-facing field whitelist (tipping-off guard). The raw Prisma row
   * carries investigation-only fields — sumsubTxnId/sumsubTxnType/
   * sumsubVerdict/sumsubScore/sumsubTxnDetailJson (KYT evidence),
   * counterpartyIsVasp, manualReason, slaDeadline/slaBreached, needsReview,
   * feeSettleAttempts, statusHistory (quotes sanctions/freeze reasons
   * verbatim), tbPendingNetId/tbPendingFeeId, grossAedValue,
   * approvalCaseId/approvalNo, traceId — that must never reach a customer's
   * browser: a DevTools inspection of the JSON response would be enough to
   * tip off a person under investigation. Only whitelisted fields are
   * returned; this list must stay in lockstep with the `WithdrawTransaction`
   * interface in client-web/src/pages/Withdraw.tsx, which is the actual
   * field contract the client reads. Mirrors
   * DepositTransactionsService#toCustomerDepositView (Task 11).
   *
   * 2026-08-18 材料请求账 Task 12：本视图曾开过一个 `actions`（Task 3,
   * action-embed）口子，随专属子表一起物理删除——客户端从未消费过这个字段
   * （`client-web/src/pages/Withdraw.tsx` 的 `WithdrawTransaction` 接口里
   * 没有它），"补料交齐没交齐"这件事现在只活在材料请求账自己的读面
   * （`client/me/material-requests`），不再走这个端点。
   */
  private toCustomerWithdrawView(item: any) {
    return {
      id: item.id,
      withdrawNo: item.withdrawNo,
      status: item.status,
      amount: item.amount,
      feeAmount: item.feeAmount,
      netAmount: item.netAmount,
      createdAt: item.createdAt,
      completedAt: item.completedAt,
      txHash: item.txHash,
      referenceNo: item.referenceNo,
      toAddress: item.toAddress,
      toIban: item.toIban,
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

  async findOneInternal(id: string) {
    const item = await (this.prisma as any).withdrawTransaction.findUnique({
      where: { id },
      include: {
        asset: true,
        customer: true,
      },
    });
    if (!item) throw new NotFoundException('Withdraw transaction not found');
    return item;
  }

  /**
   * Customer-facing single-fetch (IDOR guard + tipping-off whitelist).
   * Mirrors DepositTransactionsService#findOneForCustomer's shape; keeps the
   * existing ForbiddenException semantics the controller previously enforced
   * itself (Task 11 only moves the check + adds the field whitelist).
   */
  async findOneForCustomer(id: string, customerId: string) {
    const item = await this.findOneInternal(id);
    if (item.ownerId !== customerId) {
      throw new ForbiddenException('Not your withdrawal');
    }
    return this.toCustomerWithdrawView(item);
  }

  /**
   * 详情独立页用：客户面按业务键 `withdrawNo` 取单条（规则 3，禁止以 id
   * 作对外主查询合同）。提现无 `limitHoldReason`（无 below-min 隐藏单），
   * where 条件只有 `withdrawNo` + `ownerId`——与已删除的补料会话 service 旧版
   * `mustFindOwn` 同一套
   * 判据。先解出内部 id 再复用 `findOneForCustomer`（IDOR 校验 + 白名单）。
   */
  async findOneForCustomerByWithdrawNo(withdrawNo: string, customerId: string) {
    const row = await (this.prisma as any).withdrawTransaction.findFirst({
      where: { withdrawNo, ownerId: customerId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Withdraw transaction not found');
    return this.findOneForCustomer(row.id, customerId);
  }

  /**
   * Sumsub KYT webhooks carry the txn id we handed it at submission time
   * (sumsubTxnId). Not the withdrawal's own id, so this is a stable business-key
   * lookup, not an id-as-contract query. Mirrors DepositTransactionsService's
   * findBySumsubTxnId; used by WithdrawKytVerdictHandler (Task 4/5).
   */
  async findBySumsubTxnId(txnId: string) {
    return (this.prisma as any).withdrawTransaction.findFirst({
      where: { sumsubTxnId: txnId },
      include: { asset: true },
    });
  }

  /** Resolve a customer's source wallet for a withdrawal (C_DEP for crypto, C_VIBAN for fiat).
   *  Used by the workflow at PAYOUT_PENDING to stamp from-wallet info on the fee InternalFund
   *  without depending on the orchestrator's async fromWalletId binding. */
  async findCustomerWallet(
    ownerId: string,
    assetId: string,
    walletRole: 'C_DEP' | 'C_VIBAN',
  ): Promise<{ id: string; address: string | null; iban: string | null } | null> {
    return (this.prisma as any).wallet.findFirst({
      where: { walletRole, ownerType: 'CUSTOMER', ownerId, assetId, status: 'ACTIVE' },
      select: { id: true, address: true, iban: true },
    });
  }

  /** Pure persistence: insert a withdrawal row inside a caller-owned tx.
   *  No events, no audit, no accounting — the workflow owns those.
   *  ⚠️ 出生态写入不经过 updateStatus（brief 收口处覆盖不到）——每笔提现出生即落
   *  COMPLIANCE_PENDING（"出生即着陆"），这里按同一张配置表补上 SLA 字段，否则
   *  「进入 COMPLIANCE_PENDING 就开始计时」对提现建单这条路会落空。 */
  async insertRecord(
    tx: Prisma.TransactionClient,
    data: Record<string, any>,
  ) {
    return (tx as any).withdrawTransaction.create({
      data: { ...this.resolveSlaFields(data.status), ...data },
    });
  }

  /** Persist TB pending transfer ids on a withdrawal inside a caller-owned tx. */
  async setPendingIds(
    tx: Prisma.TransactionClient,
    id: string,
    tbPendingNetId: string,
    tbPendingFeeId: string | null,
  ) {
    return (tx as any).withdrawTransaction.update({
      where: { id },
      data: { tbPendingNetId, tbPendingFeeId },
    });
  }

  /**
   * Unified fund-order list for the detail page's "Linked Funds Orders".
   * A withdrawal's funds_orders are the payout principal (legSeq=1) plus any
   * fee legs (legSeq>1). Both are funds_orders now (三合一); the principal is
   * flagged PAYOUT for display, the fee legs INTERNAL_FUND. Each carries the
   * business key (`no`); `id` is only for the detail route.
   */
  private buildLinkedFundOrders(item: any) {
    const orders: Array<{
      kind: 'PAYOUT' | 'INTERNAL_FUND';
      no: string;
      id: string;
      status: string;
      amount: string;
      role: 'principal' | 'fee';
    }> = [];
    for (const f of item.fundsOrders ?? []) {
      const isPrincipal = (f.legSeq ?? 1) === 1;
      orders.push({
        kind: isPrincipal ? 'PAYOUT' : 'INTERNAL_FUND',
        no: f.fundsOrderNo,
        id: f.id,
        status: f.status,
        amount: String(f.amount),
        role: isPrincipal ? 'principal' : 'fee',
      });
    }
    return orders;
  }

  async findOne(id: string) {
    const item = await (this.prisma as any).withdrawTransaction.findUnique({
      where: { id },
      include: {
        asset: true,
        customer: true,
        fundsOrders: { include: { asset: true } },
      },
    });
    if (!item) throw new NotFoundException('Withdraw transaction not found');

    const auditLogs = await this.getCanonicalWithdrawAuditLogs(
      item.id,
      item.withdrawNo,
    );

    return {
      ...item,
      type: this.deriveWithdrawType(item.asset?.type),
      auditLogs,
      linkedFundOrders: this.buildLinkedFundOrders(item),
    };
  }

  /**
   * Admin detail fetch = findOne + parsed Sumsub txn detail + internal approvals
   * reverse lookup. Mirrors DepositTransactionsService#findOneForAdmin (Task 10).
   *
   * Unlike deposit, this does not do a separate `latestSumsubWebhook` reverse
   * lookup against the webhook events table — a withdrawal already carries
   * `sumsubScoredAt` (set atomically by saveSumsubVerdict alongside the verdict
   * itself), which answers the same "when did Sumsub last respond" question
   * without an extra query.
   */
  async findOneForAdmin(id: string) {
    const item: any = await this.findOne(id);

    // Sumsub getTxn 报文展示子集(与充值 findOneForAdmin 的 parseDetail 逐字同源)。
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
        // 生产 HttpSumsubTxnClient.getTxn 的 raw 没有顶层 verdict 字段,只有
        // scoringResult.action —— 回退到它,否则生产环境下这里恒为 null。
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
        raw: d, // 供详情页原文折叠
      };
    };

    const sumsubDetail = parseDetail(item.sumsubTxnDetailJson);

    // 内部审批单反查(仅单头,不含 step/steps)——withdraw 的三种审批(大额闸/解冻/
    // 制裁退款)发起时 entityRef 全部落 withdraw.id。
    const approvalPage = await this.approvalsService.list({ entityRef: item.id } as any);
    const approvals = (approvalPage.items ?? []).map((a: any) => ({
      approvalNo: a.approvalNo,
      actionType: a.actionType,
      status: a.status,
      createdAt: a.createdAt,
    }));

    return { ...item, sumsubDetail, approvals };
  }

  /**
   * 进入 nextStatus 时该带的 SLA 字段。有配置就起新计时，没配置就清空。
   * slaBreached 一律归 false —— 换了状态就是换了等待对象，旧的破线记录不该跟过来。
   *
   * 公开的原因：reissue 路径（Sumsub 重发 applicant actions，客户要重新交材料）
   * 状态不变、不走 updateStatus，收口处盖不到它，只能由调用方显式取一次。
   * 这是**唯一**的例外出口 —— 不要因为"方便"从别处调它绕过收口处。
   */
  resolveSlaFields(nextStatus: WithdrawTransactionStatus) {
    const minutes = WITHDRAW_SLA_MINUTES_BY_STATUS[nextStatus];
    return minutes === undefined
      ? { slaDeadline: null, slaBreached: false }
      : { slaDeadline: new Date(Date.now() + minutes * 60_000), slaBreached: false };
  }

  async updateStatus(
    id: string,
    dto: UpdateWithdrawTransactionStatusDto,
    context?: WithdrawStatusUpdateContext,
    tx?: Prisma.TransactionClient,
  ) {
    const { action, reason } = dto;
    const statusContext = this.normalizeStatusUpdateContext(context);

    const executeUpdate = async (client: Prisma.TransactionClient) => {
      const item = await (client as any).withdrawTransaction.findUnique({
        where: { id },
        include: {
          asset: {
            select: {
              type: true,
            },
          },
        },
      });
      if (!item) {
        throw new NotFoundException('Withdraw transaction not found');
      }

      const withdrawType = this.deriveWithdrawType(item.asset?.type);
      const currentStatus = item.status as WithdrawTransactionStatus;
      const nextStatus = this.transitions[currentStatus]?.[action];

      if (!nextStatus) {
        throw new BadRequestException(
          `Invalid action "${action}" for current status "${currentStatus}"`,
        );
      }

      this.assertStatusUpdateSourceAllowed(nextStatus, statusContext);

      let history: any[] = [];
      try {
        if (item.statusHistory) {
          history = JSON.parse(item.statusHistory);
        }
      } catch {
        history = [];
      }

      history.push({
        status: nextStatus,
        timestamp: new Date().toISOString(),
        operator: statusContext.actorId,
        note: reason || `Status changed from ${currentStatus} to ${nextStatus}`,
      });

      const updated = await client.withdrawTransaction.update({
        where: { id },
        data: {
          status: nextStatus,
          approvedAt:
            nextStatus === WithdrawTransactionStatus.PAYOUT_PENDING &&
            !item.approvedAt
              ? new Date()
              : item.approvedAt,
          completedAt: [
            WithdrawTransactionStatus.SUCCESS,
            WithdrawTransactionStatus.FAILED,
            WithdrawTransactionStatus.REJECTED,
            WithdrawTransactionStatus.RETURNED,
          ].includes(nextStatus)
            ? new Date()
            : item.completedAt,
          statusHistory: JSON.stringify(history),
          // SLA 字段必须在 extraData 之前展开 —— 调用方显式传的值优先级更高。
          ...this.resolveSlaFields(nextStatus),
          ...(context?.extraData || {}),
        },
      });

      const eventSource = updated;

      // 站2-β：状态机内建的动态迁移留痕（WITHDRAW_<从>_TO_<到>，每流转双写）整族废除。
      // 每条边由工作流层的具名业务码携「从/到」两列接手（边×码覆盖对照见词表设计稿）；
      // 操作人归因走各具名码的 recordByActor 通道，行级 operator 仍在 statusHistory。

      const postCommitEvents: Array<{ eventName: string; payload: any }> = [];

      const statusChangedPayload: WithdrawStatusChangedEvent = {
        withdrawId: updated.id,
        withdrawNo: updated.withdrawNo,
        ownerId: updated.ownerId,
        previousStatus: currentStatus,
        status: nextStatus,
        traceId: updated.traceId ?? null,
      };
      postCommitEvents.push({
        eventName: DomainEventNames.WITHDRAWAL_STATUS_CHANGED,
        payload: statusChangedPayload,
      });

      return {
        updated: {
          ...eventSource,
          type: withdrawType,
        },
        postCommitEvents,
      };
    };

    const emitEvents = (events: Array<{ eventName: string; payload: any }>) => {
      for (const event of events) {
        this.eventEmitter.emit(event.eventName, event.payload);
      }
    };

    if (tx) {
      const result = await executeUpdate(tx);
      emitEvents(result.postCommitEvents);
      return result.updated;
    }

    const result = await (this.prisma as any).$transaction(
      async (client: Prisma.TransactionClient) => executeUpdate(client),
    );
    emitEvents(result.postCommitEvents);
    return result.updated;
  }


  /**
   * Persists the single Sumsub txn id + type returned by SumsubTxnClient.submitTxn at
   * COMPLIANCE_PENDING submission time (WithdrawWorkflowService.submitSumsubTxn). One
   * withdrawal → one txn. Mirrors DepositTransactionsService#setSumsubTxn.
   */
  async setSumsubTxn(
    id: string,
    data: { sumsubTxnId: string; sumsubTxnType: 'finance' | 'travelRule' },
  ) {
    return (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: {
        sumsubTxnId: data.sumsubTxnId,
        sumsubTxnType: data.sumsubTxnType,
      },
    });
  }

  /**
   * Sumsub KYT verdict evidence write (applyKytVerdict) — sumsubVerdict/sumsubScore/
   * sumsubScoredAt/sumsubTxnDetailJson in one atomic write (unlike deposit's two
   * separate calls). Skipped entirely by the caller for the FROZEN-late-approved
   * no-op case (protects sanctions evidence from being overwritten).
   */
  async saveSumsubVerdict(
    id: string,
    data: { verdict: string; score: number | null; scoredAt: Date; detailJson?: string },
  ) {
    return (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: {
        sumsubVerdict: data.verdict,
        sumsubScore: data.score,
        sumsubScoredAt: data.scoredAt,
        ...(data.detailJson !== undefined && { sumsubTxnDetailJson: data.detailJson }),
      },
    });
  }

  /**
   * 按 id 直接改写一条 withdrawal 的 slaDeadline；不碰状态。
   *
   * 目前零调用方——Task 3 把计时收拢到进入状态时统一设（见
   * WithdrawTransactionsService.resolveSlaFields，挂在 updateStatus 等状态
   * 机收口处）之后，业务流程里再没人调它。留着是给后面「模拟超时」端点
   * 用的（按 id 直接推 deadline 演示破线），不是死代码。**不要**在业务
   * 流程里用它设 deadline，会绕开收口处、重新制造"漏计时"的窗口。
   */
  async setSlaDeadline(id: string, slaDeadline: Date) {
    return (this.prisma as any).withdrawTransaction.update({
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
    withdrawNo: string,
    slaDeadline: Date,
    actor: { actorId?: string; actorRole?: string },
  ) {
    const row = await (this.prisma as any).withdrawTransaction.findFirst({
      where: { withdrawNo },
      select: { id: true, slaDeadline: true, correlationId: true, customer: { select: { customerNo: true } } },
    });
    if (!row) throw new NotFoundException(`Withdraw not found: ${withdrawNo}`);
    if (row.slaDeadline === null) {
      throw new BadRequestException(
        `Withdraw ${withdrawNo} is not in an SLA-timed state — nothing to time out`,
      );
    }

    const updated = await this.setSlaDeadline(row.id, slaDeadline);

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.WITHDRAW_SLA_TIMEOUT_SIMULATED,
        actionDomain: 'WITHDRAW',
        category: AuditCategory.BUSINESS,
        primarySubjectType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        primarySubjectNo: withdrawNo,
        ownerCustomerNo: row.customer?.customerNo,
        correlationId: row.correlationId ?? undefined,
        subjects: [
          { subjectType: AuditEntityTypes.WITHDRAW_TRANSACTION, subjectNo: withdrawNo, subjectRole: AuditSubjectRole.PRIMARY },
          ...(row.customer?.customerNo
            ? [{ subjectType: 'CUSTOMER', subjectNo: row.customer.customerNo, subjectRole: AuditSubjectRole.OWNER }]
            : []),
        ],
        reason: 'Demo: SLA deadline moved to the past to trigger an immediate breach on the next scan',
        metadata: { previousSlaDeadline: row.slaDeadline, newSlaDeadline: slaDeadline },
        requestId: `WITHDRAW_SLA_TIMEOUT_SIMULATED_${withdrawNo}_${randomUUID()}`,
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

  /**
   * 软 SLA 破线：只置标记，**不碰 status**。
   * 业主裁定（2026-08-21）：等自己人的状态超时了，超时的是我们自己，
   * 不能把怠工转嫁给客户——单子该怎么判还得人判，系统只负责把它标红催人。
   */
  async markSlaBreached(id: string) {
    return (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: { slaBreached: true },
    });
  }

  /**
   * Flags a withdrawal for operator review without touching its status.
   * Used by WithdrawWorkflowService.applyKytVerdict's PAYOUT_PENDING
   * post-broadcast branch (review Fix 2): a rejected KYT verdict arriving
   * after the payout already broadcast has no state-machine action to take
   * (the funds are already in flight), so it's surfaced via this flag instead.
   */
  async markNeedsReview(id: string) {
    return (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: { needsReview: true },
    });
  }

  /**
   * Clears needsReview flag on SUCCESS settle completion (ops-hygiene).
   */
  async clearNeedsReview(id: string) {
    return (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: { needsReview: false },
    });
  }

  /**
   * Task 6 settle-failure retry (three-rung ladder rung 1): increments
   * feeSettleAttempts on a transient TB failure inside
   * WithdrawWorkflowService#onFeeLegConfirmed's settlement body. Returns the
   * new count so the caller can decide retry (< 3) vs STUCK (=== 3).
   */
  async incrementFeeSettleAttempts(id: string): Promise<number> {
    const row = await (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: { feeSettleAttempts: { increment: 1 } },
      select: { feeSettleAttempts: true },
    });
    return row.feeSettleAttempts;
  }

  /**
   * Resets feeSettleAttempts to 0 after a successful fee settle, so a later
   * unrelated failure starts counting fresh.
   */
  async resetFeeSettleAttempts(id: string) {
    return (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: { feeSettleAttempts: 0 },
    });
  }

  /**
   * SLA 破线候选扫描。硬软两类都扫，由 WithdrawSlaService 按状态分流：
   *   硬（COMPLIANCE_PENDING / ACTION_PENDING）→ 推 MANUAL_CHECKING
   *   软（MANUAL_CHECKING / PENDING_APPROVAL）→ 只置 slaBreached
   */
  async findSlaBreachCandidates(now: Date) {
    return (this.prisma as any).withdrawTransaction.findMany({
      where: {
        status: {
          in: [
            WithdrawTransactionStatus.COMPLIANCE_PENDING,
            WithdrawTransactionStatus.ACTION_PENDING,
            WithdrawTransactionStatus.MANUAL_CHECKING,
            WithdrawTransactionStatus.PENDING_APPROVAL,
          ],
        },
        slaDeadline: { lt: now },
        slaBreached: false,
      },
      include: { customer: { select: { customerNo: true } } },
    });
  }

  async saveValuationSnapshot(
    id: string,
    snapshot: {
      grossAedValue: Prisma.Decimal | null;
      aedRate: Prisma.Decimal | null;
      rateFetchedAt: Date | null;
      rateFetchFailed: boolean;
    },
  ) {
    // No-clobber guard (B-sum integrity): a FAILED re-valuation must NOT downgrade
    // a good birth snapshot to null. The row still counts toward the B cumulative
    // window (status CREATED/PENDING_APPROVAL ∈ counted), so nulling grossAedValue
    // would make it contribute 0 to sumUsage → a sibling withdrawal under-counts and
    // silently slips past the AED cap. When the incoming valuation failed AND the row
    // already carries a non-null grossAedValue, preserve the existing columns.
    // (A successful re-valuation still overwrites — a fresher rate is fine. The ADMIN
    // path has no birth-value, so a failed re-valuation there writes as before.)
    if (snapshot.rateFetchFailed) {
      const existing = await (this.prisma as any).withdrawTransaction.findUnique({
        where: { id },
        select: { grossAedValue: true },
      });
      if (existing?.grossAedValue != null) {
        return;
      }
    }

    await (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: {
        grossAedValue: snapshot.grossAedValue,
        aedRate: snapshot.aedRate,
        rateFetchedAt: snapshot.rateFetchedAt,
        rateFetchFailed: snapshot.rateFetchFailed,
      },
    });
  }

  async linkApprovalCase(id: string, approvalCaseId: string, approvalNo: string) {
    await (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: { approvalCaseId, approvalNo },
    });
  }

  /**
   * COMPLIANCE_PENDING → PENDING_APPROVAL "birth routing" write. Called only from
   * WithdrawWorkflowService.openApprovalGate() AFTER the approval case exists and
   * is linked. This is NOT a business state transition — every withdrawal is BORN
   * on COMPLIANCE_PENDING (Task 2, "出生即着陆"); a large-value one is routed up to
   * PENDING_APPROVAL right after birth once the gate confirms it needs approval.
   * The 10-state/20-edge `transitions` table deliberately has no edge for this, so
   * this bypasses updateStatus/transitions and writes status + statusHistory
   * directly. No audit here — the workflow owns WITHDRAW_APPROVAL_REQUESTED.
   */
  async landOnPendingApproval(id: string) {
    const item = await (this.prisma as any).withdrawTransaction.findUnique({
      where: { id },
      select: { statusHistory: true },
    });

    let history: any[] = [];
    try {
      if (item?.statusHistory) {
        history = JSON.parse(item.statusHistory);
      }
    } catch {
      history = [];
    }

    history.push({
      status: WithdrawTransactionStatus.PENDING_APPROVAL,
      timestamp: new Date().toISOString(),
      operator: 'SYSTEM',
      note: 'Large-value approval gate opened — routed to PENDING_APPROVAL',
    });

    return (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: {
        status: WithdrawTransactionStatus.PENDING_APPROVAL,
        // 同样绕过 updateStatus——落地 PENDING_APPROVAL 时按配置表重起 SLA 计时，
        // 顶掉出生时留下的 COMPLIANCE_PENDING deadline（换了状态就是换了等待对象）。
        ...this.resolveSlaFields(WithdrawTransactionStatus.PENDING_APPROVAL),
        statusHistory: JSON.stringify(history),
      },
    });
  }

  /**
   * 某客户名下所有非终态单（供客户级限制冻结在途单用，Task 9）。
   * 终态集合：提现终态（10 态中后 4 个零出边）。
   */
  async findNonTerminalByOwner(ownerId: string) {
    return this.prisma.withdrawTransaction.findMany({
      // FROZEN 在排除之列 —— 理由见 deposit-transactions.service.ts 同名方法。
      where: { ownerId, status: { notIn: ['SUCCESS', 'REJECTED', 'FAILED', 'RETURNED', 'FROZEN'] } },
      select: { id: true, withdrawNo: true, ownerType: true, ownerId: true, status: true, traceId: true },
    });
  }

}
