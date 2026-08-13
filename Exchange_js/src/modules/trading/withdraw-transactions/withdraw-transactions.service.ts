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
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
  buildStateTransitionAction,
} from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
export type WithdrawStatusUpdateSource = 'ADMIN_API' | 'WORKFLOW' | 'SYSTEM';

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

  private createAccountingContext(withdrawal: {
    ownerId: string;
    ownerType: string;
    assetId: string;
    amount: Prisma.Decimal;
    netAmount: Prisma.Decimal;
    feeAmount: Prisma.Decimal;
    withdrawNo: string;
    fromWalletId?: string | null;
    fromWalletNo?: string | null;
    toWalletId?: string | null;
    toWalletNo?: string | null;
  }) {
    return {
      src: {
        ownerId: withdrawal.ownerId,
        ownerType: withdrawal.ownerType,
        assetId: withdrawal.assetId,
        amount: withdrawal.amount.toString(),
        netAmount: withdrawal.netAmount.toString(),
        feeAmount: withdrawal.feeAmount.toString(),
        withdrawNo: withdrawal.withdrawNo,
        fromWalletId: withdrawal.fromWalletId ?? null,
        fromWalletNo: withdrawal.fromWalletNo ?? null,
        toWalletId: withdrawal.toWalletId ?? null,
        toWalletNo: withdrawal.toWalletNo ?? null,
      },
    };
  }

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
        actorId: event.actorId || null,
        actorNo: event.actorNo || null,
        reason: event.reason || null,
        occurredAt: event.occurredAt || event.createdAt || null,
        result: event.result || null,
        oldStatus,
        newStatus,
        operatorId: event.actorId || null,
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
            entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
            entityId: withdrawId,
          },
          withdrawNo
            ? {
                workflowType: AuditWorkflowTypes.WITHDRAW,
                entityNo: withdrawNo,
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
          applicantActions: { select: { seq: true, submittedAt: true }, orderBy: { seq: 'asc' } },
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
   * `actions`（Task 3, action-embed）是本白名单开的口子，与充值
   * `toCustomerDepositView` 的 `actions` 同一套理由：只记录客户自己的
   * 动作（seq/submittedAt），不构成新信息，对执法态/正常态一视同仁地
   * 存在。**只有这两个键**——无 id、无类型、无理由，没有顶层聚合字段
   * `actionSubmittedAt`（那是查子表 select 出来的关系数组，非同名列）。
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
      actions: (item.applicantActions ?? []).map((a: any) => ({
        seq: a.seq,
        submittedAt: a.submittedAt,
      })),
    };
  }

  async findOneInternal(id: string) {
    const item = await (this.prisma as any).withdrawTransaction.findUnique({
      where: { id },
      include: {
        asset: true,
        customer: true,
        applicantActions: { select: { seq: true, submittedAt: true }, orderBy: { seq: 'asc' } },
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
   * where 条件只有 `withdrawNo` + `ownerId`——与
   * `withdraw-verification-session.service.ts` 的 `mustFindOwn` 同一套
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
   *  No events, no audit, no accounting — the workflow owns those. */
  async insertRecord(
    tx: Prisma.TransactionClient,
    data: Record<string, any>,
  ) {
    return (tx as any).withdrawTransaction.create({ data });
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
          ...(context?.extraData || {}),
        },
      });

      const eventSource = updated;

      await this.auditLogsService.recordByActor(
        {

          action: buildStateTransitionAction('WITHDRAW', currentStatus, nextStatus),
          entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
          entityId: updated.id,
          entityNo: updated.withdrawNo,
          entityOwnerType: updated.ownerType,
          entityOwnerId: updated.ownerId,
          reason: reason || `Action: ${action}`,
          sourcePlatform: statusContext.sourcePlatform,
        },
        {
          actorType: statusContext.actorType,
          actorId: statusContext.actorId,
          actorRole: statusContext.actorRole,
        },
        client,
      );

      const postCommitEvents: Array<{ eventName: string; payload: any }> = [];

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

  async createMockData() {
    const assets = await (this.prisma as any).asset.findMany();
    if (assets.length === 0) {
      throw new BadRequestException('No assets found. Please seed assets first.');
    }

    const customers = await (this.prisma as any).customerMain.findMany({
      take: 20,
      select: {
        id: true,
        customerNo: true,
      },
    });
    if (customers.length === 0) {
      throw new BadRequestException('No customers found. Please seed customers first.');
    }

    const records = [];
    for (let i = 0; i < 10; i++) {
      const asset = assets[Math.floor(Math.random() * assets.length)];
      const customer = customers[Math.floor(Math.random() * customers.length)];
      const amount = (Math.random() * 1000 + 10).toFixed(2);
      
      const isCrypto = asset.type !== 'FIAT';
      const created = await (this.prisma as any).withdrawTransaction.create({
        data: {
          withdrawNo: `WDR-${Date.now()}-${i}`,
          ownerType: 'CUSTOMER',
          ownerId: customer.id,
          ownerNo: customer.customerNo,
          status: WithdrawTransactionStatus.PENDING_APPROVAL,
          assetId: asset.id,
          amount: new Prisma.Decimal(amount),
          netAmount: new Prisma.Decimal(amount),
          feeAmount: new Prisma.Decimal(0),
          toAddress: isCrypto ? '0x' + Math.random().toString(16).slice(2) : null,
          toIban: !isCrypto ? 'IBAN' + Math.random().toString().slice(2) : null,
          statusHistory: JSON.stringify([{
            from: 'NONE',
            to: WithdrawTransactionStatus.PENDING_APPROVAL,
            action: 'CREATE',
            timestamp: new Date(),
          }]),
        },
      });
      records.push({
        ...created,
        type: this.deriveWithdrawType(asset.type),
      });

      await this.auditLogsService.recordSystem({

        action: AuditActions.WITHDRAW_CREATED,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: created.id,
        entityNo: created.withdrawNo,
        entityOwnerType: created.ownerType,
        entityOwnerId: created.ownerId,
        reason: 'Initial creation',
        sourcePlatform: 'SYSTEM',
      });
    }

    return records;
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
   * Sets/refreshes the SLA deadline for a withdrawal sitting in onHold
   * (COMPLIANCE_PENDING). No status change here — callers manage the
   * transition (or lack thereof) separately via updateStatus.
   */
  async setSlaDeadline(id: string, slaDeadline: Date) {
    return (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: { slaDeadline },
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
   * SLA timer (WithdrawSlaService) scan: onHold(COMPLIANCE_PENDING) and
   * ACTION_PENDING withdrawals whose slaDeadline has passed and haven't been
   * flagged yet.
   */
  async findSlaBreachCandidates(now: Date) {
    return (this.prisma as any).withdrawTransaction.findMany({
      where: {
        status: {
          in: [
            WithdrawTransactionStatus.COMPLIANCE_PENDING,
            WithdrawTransactionStatus.ACTION_PENDING,
          ],
        },
        slaDeadline: { lt: now },
        slaBreached: false,
      },
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
        statusHistory: JSON.stringify(history),
      },
    });
  }

  async getOwnerComplianceStatus(withdrawId: string): Promise<string> {
    const item = await (this.prisma as any).withdrawTransaction.findUnique({
      where: { id: withdrawId },
      include: { customer: { select: { complianceStatus: true } } },
    });
    if (!item) throw new NotFoundException('Withdraw transaction not found');
    return item.customer?.complianceStatus || 'UNKNOWN';
  }
}
