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

type DepositWriteClient = Prisma.TransactionClient | PrismaService;

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
    } = query;
    const where: any = {};

    if (depositNo) where.depositNo = { contains: depositNo };
    if (ownerId) where.ownerId = ownerId;
    if (ownerType) where.ownerType = ownerType;
    if (assetId) where.assetId = assetId;
    if (toWalletId) where.toWalletId = toWalletId;
    if (status) where.status = status;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    // BELOW_MIN deposits are hold-pending admin disposition; the customer
    // must never see them (server-side, not a frontend hide).
    if (options?.customerScope) where.limitHoldReason = null;

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
    return this.findAll({ ...query, ownerId: customerId }, { customerScope: true });
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
    // A deposit's fund order is its payin funds_order (principal in); no fee
    // (deposits are free). The payin IS a funds_order now (三合一).
    const payinOrder = (deposit.fundsOrders ?? [])[0] ?? null;
    const linkedFundOrders = payinOrder
      ? [
          {
            kind: 'PAYIN' as const,
            no: payinOrder.fundsOrderNo,
            id: payinOrder.id,
            status: payinOrder.status,
            amount: String(payinOrder.amount),
            role: 'principal' as const,
          },
        ]
      : [];

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
    return item;
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

    const isAdminApi = options?.sourcePlatform === 'ADMIN_API';
    const ACCOUNTING_TERMINALS = new Set([DepositTransactionStatus.SUCCESS]);
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
    };

    const TERMINAL = new Set([
      DepositTransactionStatus.SUCCESS,
      DepositTransactionStatus.REJECTED,
      DepositTransactionStatus.FAILED,
      DepositTransactionStatus.EXPIRED,
      DepositTransactionStatus.CONFISCATED,
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
      DepositTransactionStatus.REJECTED,
      DepositTransactionStatus.FAILED,
      DepositTransactionStatus.EXPIRED,
      DepositTransactionStatus.CONFISCATED,
    ]);

    if (TERMINAL.has(current)) {
      throw new BadRequestException(
        `Cannot apply action '${action}' to terminal status '${current}'`,
      );
    }

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
        [DepositTransactionAction.REJECT]: DepositTransactionStatus.REJECTED,
        [DepositTransactionAction.FREEZE]: DepositTransactionStatus.FROZEN,
        [DepositTransactionAction.ACTION_PENDING]:
          DepositTransactionStatus.ACTION_PENDING,
        // Below-min confiscation (D7) goes COMPLIANCE_PENDING → CONFISCATED — the
        // held deposit never entered FROZEN. Distinct from the FROZEN→CONFISCATE
        // path below (compliance-frozen confiscation), same terminal state.
        [DepositTransactionAction.CONFISCATE]:
          DepositTransactionStatus.CONFISCATED,
        [DepositTransactionAction.FAIL]: DepositTransactionStatus.FAILED,
      },
      [DepositTransactionStatus.ACTION_PENDING]: {
        [DepositTransactionAction.APPROVE]: DepositTransactionStatus.SUCCESS,
        [DepositTransactionAction.REJECT]: DepositTransactionStatus.REJECTED,
        [DepositTransactionAction.FREEZE]: DepositTransactionStatus.FROZEN,
        [DepositTransactionAction.RESUME]:
          DepositTransactionStatus.COMPLIANCE_PENDING,
        [DepositTransactionAction.EXPIRE]: DepositTransactionStatus.EXPIRED,
      },
      [DepositTransactionStatus.FROZEN]: {
        [DepositTransactionAction.APPROVE]: DepositTransactionStatus.SUCCESS,
        [DepositTransactionAction.CONFISCATE]:
          DepositTransactionStatus.CONFISCATED,
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

  async initializeComplianceGates(id: string) {
    const deposit = await (this.prisma as any).depositTransaction.findUnique({
      where: { id },
      include: { asset: true },
    });
    const isCrypto = deposit?.asset?.type === 'CRYPTO';

    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: {
        travelRuleRequired: isCrypto,
        travelRuleStatus: isCrypto ? 'PENDING' : 'NOT_REQUIRED',
      },
    });
  }

  async updateKytStatus(id: string, status: string, riskScore?: number | null) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: {
        kytStatus: status,
        kytRiskScore: riskScore ?? null,
        kytCheckedAt: new Date(),
      },
    });
  }

  async updateTravelRuleStatus(id: string, status: string) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: {
        travelRuleStatus: status,
        travelRuleCheckedAt: new Date(),
      },
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
