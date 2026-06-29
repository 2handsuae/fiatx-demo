import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  MockPayinEventDto,
  PayinMockEvent,
  PayinQueryDto,
  PayinSimulationMode,
  PayinStatus,
  PayinAction,
  PayinType,
} from './dto/payin.dto';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  PayinStatusChangedEvent,
  PayinCreatedEvent,
} from './events/payin.events';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { WalletBalanceService } from '../wallets/wallet-balance.service';
import { PayoutFinalizationIncompleteError } from '../payouts/errors';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
  buildStateTransitionAction,
} from '../../audit-logging/constants/audit-actions.constant';

export interface CreateDetectedPayinInput {
  assetId: string;
  toWalletId: string;
  type: PayinType;
  amount: string;
  txHash?: string;
  fromAddress?: string;
  fromIban?: string;
  referenceNo?: string;
  providerTxnId?: string;
  receivedAt?: Date;
  reason?: string;
}

interface UpdatePayinStatusOptions {
  simulationMode?: PayinSimulationMode | null;
}

/**
 * INGESTION / ADAPTER LAYER — inbound rail detection.
 *
 * PayinsService detects on-chain / bank inbound transfers and normalises them
 * into internal domain events (`payin.created`, `payin.status.changed`) consumed
 * by DepositWorkflowService. Per backend-platform rules the ingestion/adapter
 * layer MAY emit internal events and record detection audit (PAYIN_CREATED + rail
 * state transitions) — this is NOT a pure domain service, and the audit it writes
 * is rail-detection evidence, consistent with the SumsubIngestion pattern.
 */
@Injectable()
export class PayinsService {
  private readonly logger = new Logger(PayinsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditLogsService: AuditLogsService,
    private readonly walletBalance: WalletBalanceService,
  ) {}

  private normalizeOptionalString(value?: string | null): string | null {
    const normalized = String(value || '').trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeAdminPayinType(type?: string | null): string | null {
    const normalized = String(type || '').trim().toUpperCase();
    if (!normalized) return null;
    if (normalized === 'CRYPTO' || normalized === 'FIAT') {
      return normalized;
    }
    return normalized;
  }

  private normalizeRailDisplayStatus(status?: string | null): string | null {
    const normalized = String(status || '').trim().toUpperCase();
    if (!normalized) return null;
    if (normalized === 'CLEAR') return 'CLEARED';
    return normalized;
  }

  private normalizeStoredPayinType(type?: string | null): PayinType | null {
    const normalized = this.normalizeAdminPayinType(type);
    if (normalized === PayinType.CRYPTO || normalized === PayinType.FIAT) {
      return normalized as PayinType;
    }
    return null;
  }

  private expandPayinTypeFilter(type?: PayinType | null): { in: string[] } | undefined {
    if (!type) return undefined;
    const legacyLowercase = String(type).toLowerCase();
    return { in: Array.from(new Set([type, legacyLowercase])) };
  }

  private mapCanonicalAuditLogs(events: any[]) {
    return events.map((event: any) => ({
      id: event.id,
      action: event.action || null,
      statusFrom: event.statusFrom || null,
      statusTo: event.statusTo || null,
      actorType: event.actorType || null,
      actorId: event.actorId || null,
      actorNo: event.actorNo || null,
      reason: event.reason || null,
      occurredAt: event.occurredAt || event.createdAt || null,
      result: event.result || null,
      oldStatus: event.statusFrom || null,
      newStatus: event.statusTo || null,
      operatorId: event.actorId || null,
      createdAt: event.occurredAt || event.createdAt || null,
    }));
  }

  private async getCanonicalPayinAuditLogs(
    payinId: string,
    payinNo?: string | null,
    depositId?: string | null,
    depositNo?: string | null,
  ) {
    const normalizedPayinNo = this.normalizeOptionalString(payinNo);
    const normalizedDepositId = this.normalizeOptionalString(depositId);
    const normalizedDepositNo = this.normalizeOptionalString(depositNo);
    const events = await (this.prisma as any).auditLogEvent.findMany({
      where: {
        OR: [
          {
            entityType: AuditEntityTypes.PAYIN,
            entityId: payinId,
          },
          normalizedPayinNo
            ? {
                entityType: AuditEntityTypes.PAYIN,
                entityNo: normalizedPayinNo,
              }
            : undefined,
          normalizedDepositId
            ? {
                workflowType: AuditWorkflowTypes.DEPOSIT,
              }
            : undefined,
          normalizedDepositNo
            ? {
                workflowType: AuditWorkflowTypes.DEPOSIT,
              }
            : undefined,
        ].filter(Boolean),
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });

    return this.mapCanonicalAuditLogs(events);
  }

  private async emitPayinEvent(eventName: string, payload: unknown) {
    if (typeof (this.eventEmitter as any).emitAsync === 'function') {
      return (this.eventEmitter as any).emitAsync(eventName, payload);
    }

    return this.eventEmitter.emit(eventName, payload);
  }

  async createDetected(input: CreateDetectedPayinInput) {
    const {
      assetId,
      toWalletId,
      type,
      amount,
      txHash,
      fromAddress,
      fromIban,
      referenceNo,
      providerTxnId,
      receivedAt,
      reason,
    } = input;
    const wallet = await (this.prisma as any).wallet.findUnique({
      where: { id: toWalletId },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.assetId !== assetId) {
      throw new BadRequestException('Wallet asset does not match payin asset');
    }

    const initialStatus = PayinStatus.DETECTED;
    const initialReason = reason || 'Inbound transfer detected';
    const initialHistory = [
      {
        status: initialStatus,
        changedAt: new Date(),
        reason: initialReason,
        operatorId: 'SYSTEM',
      },
    ];

    const traceId = randomUUID();

    const payin = await (this.prisma as any).payin.create({
      data: {
        payinNo: generateReferenceNo('PI'),
        type,
        status: initialStatus,
        amount: new Prisma.Decimal(amount),
        assetId,
        toWalletId,
        ownerId: wallet.ownerType === 'CUSTOMER' ? wallet.ownerId : undefined,
        toAddress: wallet.address,
        toIban: wallet.iban,
        fromAddress,
        fromIban,
        txHash,
        referenceNo,
        providerTxnId,
        receivedAt: receivedAt || new Date(),
        statusHistory: JSON.stringify(initialHistory),
        traceId,
      },
    });

    await this.emitPayinEvent(
      'payin.created',
      new PayinCreatedEvent(
        payin.id,
        payin.status as PayinStatus,
        payin.type as PayinType,
        payin.depositId,
        payin.assetId,
        payin.amount.toString(),
      ),
    );

    await this.auditLogsService.recordSystem({

      action: AuditActions.PAYIN_CREATED,
      entityType: AuditEntityTypes.PAYIN,
      entityId: payin.id,
      entityNo: payin.payinNo,
      entityOwnerType: wallet.ownerType,
      entityOwnerId: wallet.ownerId || undefined,
      workflowType: 'DEPOSIT',
      reason: initialReason,
      sourcePlatform: 'SYSTEM',
      traceId,
    });

    return payin;
  }

  async findAll(query: PayinQueryDto) {
    const { skip, take, status, type, assetId, txHash, depositId } = query;
    const where: Prisma.PayinWhereInput = {};

    if (status) where.status = status;
    if (type) where.type = this.expandPayinTypeFilter(type);
    if (assetId) where.assetId = assetId;
    if (txHash) where.txHash = { contains: txHash };
    if (depositId) where.depositId = depositId;

    const [items, total] = await Promise.all([
      (this.prisma as any).payin.findMany({
        skip: skip ? Number(skip) : 0,
        take: take ? Number(take) : 20,
        where,
        orderBy: { receivedAt: 'desc' },
        include: {
          deposit: {
            select: {
              kytStatus: true,
              travelRuleStatus: true,
              depositNo: true,
            },
          },
          asset: {
            select: {
              code: true,
              type: true,
              network: true,
              decimals: true,
            },
          },
          toWallet: {
            select: {
              ownerType: true,
              ownerId: true,
              address: true,
              accountName: true,
            },
          },
          customer: {
            select: {
              customerNo: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
      (this.prisma as any).payin.count({ where }),
    ]);

    const mappedItems = items.map((item: any) => ({
      ...item,
      ownerNo: item.customer?.customerNo || item.ownerNo || null,
      transactionType: 'DEPOSIT',
      transactionId: item.depositId || null,
      transactionNo: item.deposit?.depositNo || null,
      type: this.normalizeStoredPayinType(item.type),
      displayStatus: this.normalizeRailDisplayStatus(item.status),
    }));

    return { items: mappedItems, total };
  }

  async findOne(id: string) {
    const item = await (this.prisma as any).payin.findUnique({
      where: { id },
      include: {
        asset: true,
        toWallet: true,
        fromWallet: true,
        deposit: true,
        customer: { select: { customerNo: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!item) throw new NotFoundException('Payin not found');

    const inboundSignal = item.providerTxnId
      ? await (this.prisma as any).inboundTransferSignal.findUnique({
          where: { id: item.providerTxnId },
          select: {
            id: true,
            signalNo: true,
            simulationRiskLevel: true,
            simulationRiskReason: true,
          },
        })
      : null;
    
    // Manually map ownerNo from relations if available
    // Use type assertion because Prisma types might not perfectly infer the include result for 'customer' in all contexts
    const payinWithCustomer = item as any;
    let ownerNo = payinWithCustomer.ownerNo;
    
    if (!ownerNo && payinWithCustomer.customer) {
        ownerNo = payinWithCustomer.customer.customerNo;
    }

    // Map fields to match the requested API response format
    const auditLogs = await this.getCanonicalPayinAuditLogs(
      item.id,
      item.payinNo,
      item.depositId,
      payinWithCustomer.deposit?.depositNo || null,
    );

    const response = {
        ...item,
        ownerNo,
        ownerType: payinWithCustomer.toWallet?.ownerType || 'CUSTOMER',
        transactionType: 'DEPOSIT',
        transactionId: item.depositId,
        transactionNo: payinWithCustomer.deposit?.depositNo,
        displayStatus: this.normalizeRailDisplayStatus(item.status),
        type: this.normalizeStoredPayinType(item.type),
        toWalletNo: payinWithCustomer.toWallet?.walletNo,
        fromWalletNo: payinWithCustomer.fromWallet?.walletNo,
        simulationProfile: inboundSignal
          ? {
              signalId: inboundSignal.id,
              signalNo: inboundSignal.signalNo,
              riskLevel: inboundSignal.simulationRiskLevel || 'LOW',
              riskReason: inboundSignal.simulationRiskReason || null,
            }
          : null,
        auditLogs,
    };

    return response;
  }

  async updateStatus(
    id: string,
    action: PayinAction,
    options?: UpdatePayinStatusOptions,
  ) {
    const payin = await this.findOne(id);
    const currentStatus = payin.status as PayinStatus;
    const type = this.normalizeStoredPayinType(payin.type);

    if (!type) {
      throw new BadRequestException(
        `Unsupported payin type for ${id}: ${String(payin.type || '').trim() || 'UNKNOWN'}`,
      );
    }

    let nextStatus: PayinStatus | null = null;

    if (type === PayinType.FIAT) {
      // Fiat State Machine
      // [*] --> DETECTED
      // DETECTED --> CONFIRMED: confirm
      // DETECTED --> FAILED: fail
      // CONFIRMED --> CLEARED: clear

      switch (currentStatus) {
        case PayinStatus.DETECTED:
          if (action === PayinAction.CONFIRM) nextStatus = PayinStatus.CONFIRMED;
          if (action === PayinAction.FAIL) nextStatus = PayinStatus.FAILED;
          break;
        case PayinStatus.CONFIRMED:
          if (action === PayinAction.CLEAR) nextStatus = PayinStatus.CLEARED;
          break;
      }
    } else {
      // Crypto State Machine
      // [*] --> DETECTED
      // DETECTED --> CONFIRMING: block
      // DETECTED --> FAILED: fail (mempool dropped / RBF replaced)
      // CONFIRMING --> CONFIRMED: confirm
      // CONFIRMING --> FAILED: fail
      // CONFIRMING --> DETECTED: reorg (shallow reorg → back to mempool)
      // CONFIRMED --> CLEARED: clear

      switch (currentStatus) {
        case PayinStatus.DETECTED:
          if (action === PayinAction.BLOCK) nextStatus = PayinStatus.CONFIRMING;
          if (action === PayinAction.FAIL) nextStatus = PayinStatus.FAILED; // mempool dropped / RBF replaced
          break;
        case PayinStatus.CONFIRMING:
          if (action === PayinAction.CONFIRM) nextStatus = PayinStatus.CONFIRMED;
          if (action === PayinAction.FAIL) nextStatus = PayinStatus.FAILED;
          if (action === PayinAction.REORG) nextStatus = PayinStatus.DETECTED; // shallow reorg → back to mempool
          break;
        case PayinStatus.CONFIRMED:
          if (action === PayinAction.CLEAR) nextStatus = PayinStatus.CLEARED;
          break;
      }
    }

    if (!nextStatus) {
      throw new BadRequestException(
        `Invalid transition: Cannot perform action '${action}' on payin ${id} with status '${currentStatus}' (Type: ${type})`,
      );
    }

    // ── R3 invariant guard ──
    // Payin CLEARED rows must carry a referenceNo; CRYPTO must additionally
    // carry a txHash. Both should have been populated upstream (creation /
    // CONFIRM step). Throw before mutating state if either is missing.
    if (nextStatus === PayinStatus.CLEARED) {
      const refNo = String(payin.referenceNo || '').trim();
      if (!refNo) {
        throw new PayoutFinalizationIncompleteError(
          `Payin ${payin.payinNo || id} cannot be CLEARED: referenceNo is required`,
        );
      }
      if (type === PayinType.CRYPTO) {
        const tx = String(payin.txHash || '').trim();
        if (!tx) {
          throw new PayoutFinalizationIncompleteError(
            `CRYPTO payin ${payin.payinNo || id} cannot be CLEARED: txHash is required`,
          );
        }
      }
    }

    this.logger.log(
      `Transitioning payin ${id} from ${currentStatus} to ${nextStatus} via action ${action}`,
    );

    // Update history
    const historyEntry = {
        status: nextStatus,
        changedAt: new Date(),
        reason: `Action: ${action}`,
        operatorId: 'SYSTEM' // In real app, get from request context
    };

    let newHistoryString;
    try {
        const history = payin.statusHistory ? JSON.parse(payin.statusHistory as string) : [];
        if (Array.isArray(history)) {
            history.push(historyEntry);
            newHistoryString = JSON.stringify(history);
        } else {
            newHistoryString = JSON.stringify([historyEntry]);
        }
    } catch (e) {
        newHistoryString = JSON.stringify([historyEntry]);
    }

    const updatedPayin = await (this.prisma as any).payin.update({
      where: { id },
      data: {
        status: nextStatus,
        statusHistory: newHistoryString,
      },
    });

    // Mock-balance: deposit cleared → credit the receiving wallet (fiat C_VIBAN /
    // crypto C_DEP). No validation. Not wrapped in a tx here (mock ledger).
    if (nextStatus === PayinStatus.CLEARED) {
      await this.walletBalance.adjust(
        updatedPayin.toWalletId,
        new Prisma.Decimal(updatedPayin.amount ?? 0),
        this.prisma as any,
      );
    }

    await this.auditLogsService.recordSystem({

      action: buildStateTransitionAction('PAYIN', currentStatus, nextStatus),
      entityType: AuditEntityTypes.PAYIN,
      entityId: updatedPayin.id,
      entityNo: updatedPayin.payinNo,
      entityOwnerType: updatedPayin.ownerId ? 'CUSTOMER' : undefined,
      entityOwnerId: updatedPayin.ownerId || undefined,
      traceId: updatedPayin.traceId,
      workflowType: 'DEPOSIT',
      reason: `Action: ${action}`,
      sourcePlatform: 'SYSTEM',
    });

    await this.emitPayinEvent(
      'payin.status.changed',
      new PayinStatusChangedEvent(
        updatedPayin.id,
        currentStatus,
        nextStatus,
        type,
        updatedPayin.depositId,
        updatedPayin.assetId,
        updatedPayin.amount.toString(),
        options?.simulationMode || null,
      ),
    );

    return updatedPayin;
  }

  async applyMockEvent(id: string, dto: MockPayinEventDto) {
    const payin = await this.findOne(id);
    const type = this.normalizeStoredPayinType(payin.type);
    const event = dto.event;

    if (!type) {
      throw new BadRequestException(
        `Unsupported payin type for ${id}: ${String(payin.type || '').trim() || 'UNKNOWN'}`,
      );
    }

    let action: PayinAction | null = null;
    let simulationMode: PayinSimulationMode | null = null;

    if (type === PayinType.CRYPTO) {
      switch (event) {
        case PayinMockEvent.MEMPOOL_SEEN:
          action = PayinAction.BLOCK;
          break;
        case PayinMockEvent.CHAIN_CONFIRMED:
          action = PayinAction.CONFIRM;
          simulationMode = PayinSimulationMode.INTERACTIVE;
          break;
        case PayinMockEvent.DROPPED:
          action = PayinAction.FAIL;
          break;
        case PayinMockEvent.REORG:
          action = PayinAction.REORG;
          break;
      }
    } else if (type === PayinType.FIAT) {
      switch (event) {
        case PayinMockEvent.FIAT_CONFIRMED:
          action = PayinAction.CONFIRM;
          simulationMode = PayinSimulationMode.INTERACTIVE;
          break;
        case PayinMockEvent.FIAT_FAILED:
          action = PayinAction.FAIL;
          break;
      }
    }

    if (!action) {
      throw new BadRequestException(
        `Mock event '${event}' is not supported for payin ${id} (type: ${type})`,
      );
    }

    await this.updateStatus(id, action, { simulationMode });
    return this.findOne(id);
  }

  async linkDeposit(id: string, depositId: string) {
    return (this.prisma as any).payin.update({
      where: { id },
      data: { depositId },
    });
  }
}
