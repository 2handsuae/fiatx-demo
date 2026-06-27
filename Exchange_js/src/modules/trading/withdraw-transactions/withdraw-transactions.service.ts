import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
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
import { InternalTransferService } from '../../funds-layer/domain/internal-transfer.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';

export type WithdrawStatusUpdateSource = 'ADMIN_API' | 'WORKFLOW' | 'SYSTEM';

export interface WithdrawStatusUpdateContext {
  source: WithdrawStatusUpdateSource;
  actorType?: string;
  actorId?: string;
  actorRole?: string;
  sourcePlatform?: string;
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

  // Define state machine transitions
  private readonly transitions: Record<WithdrawTransactionStatus, Partial<Record<WithdrawTransactionAction, WithdrawTransactionStatus>>> = {
    // Legacy compatibility branch: retained for historical replay/query readability only.
    [WithdrawTransactionStatus.CREATED]: {
      [WithdrawTransactionAction.REQUIRE_APPROVAL]: WithdrawTransactionStatus.PENDING_APPROVAL,
      [WithdrawTransactionAction.CHECK]: WithdrawTransactionStatus.PENDING_COMPLIANCE,
      [WithdrawTransactionAction.CANCEL]: WithdrawTransactionStatus.CANCELLED,
    },
    [WithdrawTransactionStatus.PENDING_APPROVAL]: {
      [WithdrawTransactionAction.GATE_APPROVE]: WithdrawTransactionStatus.PENDING_COMPLIANCE,
      [WithdrawTransactionAction.REJECT]: WithdrawTransactionStatus.REJECTED,
      [WithdrawTransactionAction.CANCEL]: WithdrawTransactionStatus.CANCELLED,
    },
    [WithdrawTransactionStatus.PENDING_COMPLIANCE]: {
      [WithdrawTransactionAction.FLAG]: WithdrawTransactionStatus.UNDER_REVIEW,
      [WithdrawTransactionAction.REJECT]: WithdrawTransactionStatus.REJECTED,
      [WithdrawTransactionAction.APPROVE]: WithdrawTransactionStatus.PAYOUT_PENDING,
      [WithdrawTransactionAction.CANCEL]: WithdrawTransactionStatus.CANCELLED,
    },
    [WithdrawTransactionStatus.UNDER_REVIEW]: {
      [WithdrawTransactionAction.APPROVE]: WithdrawTransactionStatus.PAYOUT_PENDING,
      [WithdrawTransactionAction.REJECT]: WithdrawTransactionStatus.REJECTED,
      [WithdrawTransactionAction.CANCEL]: WithdrawTransactionStatus.CANCELLED,
    },
    [WithdrawTransactionStatus.APPROVED]: {
      // Legacy compatibility transition. New withdraw flows should not settle here.
      [WithdrawTransactionAction.APPROVE]: WithdrawTransactionStatus.PAYOUT_PENDING,
    },
    [WithdrawTransactionStatus.PAYOUT_PENDING]: {
      [WithdrawTransactionAction.FLAG]: WithdrawTransactionStatus.UNDER_REVIEW,
      [WithdrawTransactionAction.REJECT]: WithdrawTransactionStatus.REJECTED,
      [WithdrawTransactionAction.SUCCESS]: WithdrawTransactionStatus.SUCCESS,
      [WithdrawTransactionAction.FAIL]: WithdrawTransactionStatus.FAILED,
      [WithdrawTransactionAction.APPROVE]: WithdrawTransactionStatus.PAYOUT_PENDING, // Allow re-approval for logging
    },
    [WithdrawTransactionStatus.SUCCESS]: {
      [WithdrawTransactionAction.RETURN]: WithdrawTransactionStatus.RETURNED,
      [WithdrawTransactionAction.SUCCESS]: WithdrawTransactionStatus.SUCCESS, // For logging
    },
    [WithdrawTransactionStatus.FAILED]: {
      [WithdrawTransactionAction.FAIL]: WithdrawTransactionStatus.FAILED, // For logging
    },
    [WithdrawTransactionStatus.REJECTED]: {},
    [WithdrawTransactionStatus.CANCELLED]: {},
    [WithdrawTransactionStatus.RETURNED]: {},
    // Legacy compatibility state only.
    [WithdrawTransactionStatus.HELD]: {},
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditLogsService: AuditLogsService,
    private readonly internalTransferService: InternalTransferService,
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
  ): Required<WithdrawStatusUpdateContext> {
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

  private deriveWithdrawComplianceSnapshotFromStatus(
    status?: string | null,
  ): 'PENDING' | 'CLEAR' | 'UNDER_REVIEW' | 'REJECTED' {
    const current = String(status || '').trim().toUpperCase();

    if (current === WithdrawTransactionStatus.UNDER_REVIEW) {
      return 'UNDER_REVIEW';
    }

    if (current === WithdrawTransactionStatus.REJECTED) {
      return 'REJECTED';
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

  private deriveWithdrawComplianceStatusFromStatus(
    status?: string | null,
  ): 'PENDING' | 'CLEAR' | 'HOLD' | 'REJECT' {
    const current = String(status || '').trim().toUpperCase();

    if (current === WithdrawTransactionStatus.UNDER_REVIEW) {
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
    context: Required<WithdrawStatusUpdateContext>,
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
    if (status) where.status = status;

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

  async findOneInternal(id: string) {
    const item = await (this.prisma as any).withdrawTransaction.findUnique({
      where: { id },
      include: { asset: true, customer: true },
    });
    if (!item) throw new NotFoundException('Withdraw transaction not found');
    return item;
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
   * Unified fund-order list for the detail page's "Linked Funds Orders":
   * the Payout (principal) + the fee InternalFund. Both carry the business key
   * (`no`) for display; `id` is only for the payout's detail route.
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
    if (item.payout) {
      orders.push({
        kind: 'PAYOUT',
        no: item.payout.payoutNo,
        id: item.payout.id,
        status: item.payout.status,
        amount: String(item.payout.amount),
        role: 'principal',
      });
    }
    for (const f of item.internalFunds ?? []) {
      orders.push({
        kind: 'INTERNAL_FUND',
        no: f.internalFundNo,
        id: f.id,
        status: f.status,
        amount: String(f.amount),
        role: 'fee',
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
        payout: true,
        internalFunds: { include: { asset: true } },
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
          complianceStatus:
            this.deriveWithdrawComplianceSnapshotFromStatus(nextStatus),
          approvedAt:
            (nextStatus === WithdrawTransactionStatus.APPROVED ||
              nextStatus === WithdrawTransactionStatus.PAYOUT_PENDING) &&
            !item.approvedAt
              ? new Date()
              : item.approvedAt,
          payoutRequestedAt:
            nextStatus === WithdrawTransactionStatus.PAYOUT_PENDING
              ? new Date()
              : item.payoutRequestedAt,
          completedAt: [
            WithdrawTransactionStatus.SUCCESS,
            WithdrawTransactionStatus.FAILED,
            WithdrawTransactionStatus.REJECTED,
            WithdrawTransactionStatus.CANCELLED,
            WithdrawTransactionStatus.RETURNED,
          ].includes(nextStatus)
            ? new Date()
            : item.completedAt,
          statusHistory: JSON.stringify(history),
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
          status: WithdrawTransactionStatus.CREATED,
          assetId: asset.id,
          amount: new Prisma.Decimal(amount),
          netAmount: new Prisma.Decimal(amount),
          feeAmount: new Prisma.Decimal(0),
          toAddress: isCrypto ? '0x' + Math.random().toString(16).slice(2) : null,
          toIban: !isCrypto ? 'IBAN' + Math.random().toString().slice(2) : null,
          preKytStatus: isCrypto ? 'PENDING' : '',
          kytStatus: '',
          travelRuleRequired: isCrypto,
          travelRuleStatus: isCrypto ? 'PENDING' : '',
          complianceStatus: 'PENDING',
          statusHistory: JSON.stringify([{
            from: 'NONE',
            to: WithdrawTransactionStatus.CREATED,
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

  async updateKytStatus(
    id: string,
    kytStatus: string,
    kytScreeningId: string | null,
    kytRiskScore: number | null,
    phase: number,
  ) {
    const item = await (this.prisma as any).withdrawTransaction.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Withdraw transaction not found');

    // Phase 1 = pre-broadcast KYT → preKyt* fields
    // Phase 2 = post-broadcast KYT → kyt* fields
    const data = phase === 1
      ? {
          preKytStatus: kytStatus,
          preKytId: kytScreeningId ?? item.preKytId,
          preKytRiskScore: kytRiskScore ?? item.preKytRiskScore,
          preKytCheckedAt: new Date(),
        }
      : {
          kytStatus,
          kytScreeningId: kytScreeningId ?? item.kytScreeningId,
          kytRiskScore: kytRiskScore ?? item.kytRiskScore,
          kytCheckedAt: new Date(),
        };

    const updated = await (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data,
    });

    this.eventEmitter.emit(DomainEventNames.WITHDRAWAL_KYT_UPDATED, {
      withdrawId: id,
      kytStatus,
      phase,
    });

    return updated;
  }

  async updateTravelRuleStatus(
    id: string,
    travelRuleStatus: string,
    travelRuleTransferId: string | null,
  ) {
    const item = await (this.prisma as any).withdrawTransaction.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Withdraw transaction not found');

    const updated = await (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: {
        travelRuleStatus,
        travelRuleTransferId: travelRuleTransferId ?? item.travelRuleTransferId,
        travelRuleCheckedAt: new Date(),
      },
    });

    this.eventEmitter.emit(DomainEventNames.WITHDRAWAL_TRAVELRULE_UPDATED, {
      withdrawId: id,
      travelRuleStatus,
    });

    return updated;
  }

  async linkPayout(withdrawId: string, payoutId: string, payoutNo: string) {
    await (this.prisma as any).withdrawTransaction.update({
      where: { id: withdrawId },
      data: { payoutId, payoutNo },
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

  async getOwnerComplianceStatus(withdrawId: string): Promise<string> {
    const item = await (this.prisma as any).withdrawTransaction.findUnique({
      where: { id: withdrawId },
      include: { customer: { select: { complianceStatus: true } } },
    });
    if (!item) throw new NotFoundException('Withdraw transaction not found');
    return item.customer?.complianceStatus || 'UNKNOWN';
  }
}
