import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { 
  PayoutQueryDto, 
  PayoutStatus, 
  UpdatePayoutStatusDto,
  CreatePayoutDto,
  PayoutType,
  PayoutAction
} from './dto/payout.dto';

const CRYPTO_TRANSITIONS: Record<string, Partial<Record<PayoutAction, PayoutStatus>>> = {
  [PayoutStatus.CREATED]: { [PayoutAction.SIGN]: PayoutStatus.SIGNING },
  [PayoutStatus.SIGNING]: { 
    [PayoutAction.BROADCAST]: PayoutStatus.BROADCASTED,
    [PayoutAction.SIGN_FAIL]: PayoutStatus.FAILED 
  },
  [PayoutStatus.BROADCASTED]: { 
    [PayoutAction.SEEN_IN_MEMPOOL]: PayoutStatus.CONFIRMING,
    [PayoutAction.DROP]: PayoutStatus.FAILED,
    [PayoutAction.TIMEOUT]: PayoutStatus.TIMEOUT
  },
  [PayoutStatus.CONFIRMING]: { 
    [PayoutAction.CONFIRM]: PayoutStatus.CONFIRMED,
    [PayoutAction.TIMEOUT]: PayoutStatus.TIMEOUT,
    [PayoutAction.FAIL]: PayoutStatus.FAILED
  },
  [PayoutStatus.CONFIRMED]: { [PayoutAction.CLEAR]: PayoutStatus.CLEAR },
  [PayoutStatus.FAILED]: {},
  [PayoutStatus.TIMEOUT]: {},
  [PayoutStatus.CLEAR]: {},
  [PayoutStatus.RETURNED]: {},
};

const FIAT_TRANSITIONS: Record<string, Partial<Record<PayoutAction, PayoutStatus>>> = {
  [PayoutStatus.CREATED]: { [PayoutAction.SUBMIT]: PayoutStatus.CONFIRMING },
  [PayoutStatus.CONFIRMING]: { 
    [PayoutAction.CONFIRM]: PayoutStatus.CONFIRMED,
    [PayoutAction.FAIL]: PayoutStatus.FAILED,
    [PayoutAction.TIMEOUT]: PayoutStatus.TIMEOUT
  },
  [PayoutStatus.CONFIRMED]: { 
    [PayoutAction.CLEAR]: PayoutStatus.CLEAR,
    [PayoutAction.RETURN]: PayoutStatus.RETURNED
  },
  [PayoutStatus.CLEAR]: { [PayoutAction.RETURN]: PayoutStatus.RETURNED },
  [PayoutStatus.FAILED]: {},
  [PayoutStatus.TIMEOUT]: {},
  [PayoutStatus.RETURNED]: {},
};
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PayoutEvents } from './constants/payout-events.constant';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
  buildStateTransitionAction,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import { AuditTriggerType } from '../../risk-engine/audit-logs/dto/audit-log.dto';
import { TransactionComplianceService } from '../../risk-engine/transaction-compliance/transaction-compliance.service';
import { PricingCenterService } from '../../trading/pricing-center/pricing-center.service';

@Injectable()
export class PayoutsService {
  private static readonly UPDATE_STATUS_TX_TIMEOUT_MS = 15_000;
  private readonly logger = new Logger(PayoutsService.name);
  private readonly auditLogsService: AuditLogsService;

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private readonly transactionComplianceService: TransactionComplianceService,
    private readonly pricingCenterService: PricingCenterService,
  ) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

  private normalizeOptionalString(value?: string | null): string | null {
    const normalized = String(value || '').trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeAdminPayoutType(type?: string | null): string | null {
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
      module: event.module || null,
      result: event.result || null,
      oldStatus: event.statusFrom || null,
      newStatus: event.statusTo || null,
      operatorId: event.actorId || null,
      createdAt: event.occurredAt || event.createdAt || null,
    }));
  }

  private async getCanonicalPayoutAuditLogs(
    payoutId: string,
    payoutNo?: string | null,
    withdrawId?: string | null,
  ) {
    const normalizedPayoutNo = this.normalizeOptionalString(payoutNo);
    const normalizedWithdrawId = this.normalizeOptionalString(withdrawId);
    const events = await (this.prisma as any).auditLogEvent.findMany({
      where: {
        OR: [
          {
            entityType: AuditEntityTypes.PAYOUT,
            entityId: payoutId,
          },
          normalizedPayoutNo
            ? {
                entityType: AuditEntityTypes.PAYOUT,
                entityNo: normalizedPayoutNo,
              }
            : undefined,
          normalizedWithdrawId
            ? {
                workflowType: AuditWorkflowTypes.WITHDRAW,
                workflowId: normalizedWithdrawId,
                action: {
                  in: [
                    buildStateTransitionAction(
                      'WITHDRAW',
                      'PAYOUT_PENDING',
                      'SUCCESS',
                    ),
                    AuditActions.SYSTEM_WITHDRAW_TERMINAL_ORCHESTRATED,
                  ],
                },
              }
            : undefined,
        ].filter(Boolean),
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });

    return this.mapCanonicalAuditLogs(events);
  }

  private generatePayoutId(): string {
    return `PO_${uuidv4()}`;
  }

  async findAll(query: PayoutQueryDto) {
    const { skip, take, withdrawId, status, type, assetId } = query;
    const where: any = {};

    if (withdrawId) where.withdrawId = withdrawId;
    if (status) where.status = status;
    if (type) where.type = type;
    if (assetId) where.assetId = assetId;

    const [items, total] = await Promise.all([
      (this.prisma as any).payout.findMany({
        skip: skip ? Number(skip) : 0,
        take: take ? Number(take) : 20,
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          asset: true,
          withdraw: true,
          customer: true,
        },
      }),
      (this.prisma as any).payout.count({ where }),
    ]);

    const mappedItems = items.map((item: any) => ({
      ...item,
      ownerNo:
        item.customer?.customerNo ||
        this.normalizeOptionalString(item.withdraw?.ownerNo) ||
        null,
      transactionType: 'WITHDRAW',
      transactionId: item.withdrawId,
      transactionNo: item.withdraw?.withdrawNo || null,
      type: this.normalizeAdminPayoutType(item.type),
      displayStatus: this.normalizeRailDisplayStatus(item.status),
    }));

    return { items: mappedItems, total };
  }

  async findOne(id: string) {
    const item = await (this.prisma as any).payout.findUnique({
      where: { id },
      include: {
        asset: true,
        withdraw: true,
        customer: true,
        clearings: {
          include: {
            lines: true
          }
        },
      },
    });
    if (!item) throw new NotFoundException('Payout not found');
    const auditLogs = await this.getCanonicalPayoutAuditLogs(
      item.id,
      item.payoutNo,
      item.withdrawId,
    );
    return {
      ...item,
      ownerNo:
        item.customer?.customerNo ||
        this.normalizeOptionalString(item.withdraw?.ownerNo) ||
        null,
      transactionType: 'WITHDRAW',
      transactionId: item.withdrawId,
      transactionNo: item.withdraw?.withdrawNo || null,
      type: this.normalizeAdminPayoutType(item.type),
      displayStatus: this.normalizeRailDisplayStatus(item.status),
      auditLogs,
    };
  }

  async create(dto: CreatePayoutDto, operatorId: string, tx?: Prisma.TransactionClient) {
    const { withdrawId, type, amount, assetId, toWalletId, toAddress, toIban } = dto;

    const executeCreate = async (client: Prisma.TransactionClient) => {
      const existing = await (client as any).payout.findUnique({
        where: { withdrawId },
      });
      if (existing) {
        return existing;
      }

      const withdraw = await (client as any).withdrawTransaction.findUnique({
        where: { id: withdrawId },
        select: {
          id: true,
          ownerId: true,
        },
      });
      if (!withdraw) {
        throw new NotFoundException('Withdraw transaction not found');
      }

      const payoutId = this.generatePayoutId();
      const record = await (client as any).payout.create({
        data: {
          id: payoutId,
          payoutNo: generateReferenceNo('PO'),
          withdrawId,
          ownerId: withdraw.ownerId,
          type,
          status: PayoutStatus.CREATED,
          amount: new Prisma.Decimal(amount),
          assetId,
          toWalletId,
          toAddress,
          toIban,
          statusHistory: JSON.stringify([{
            status: PayoutStatus.CREATED,
            timestamp: new Date().toISOString(),
            operator: operatorId,
            note: 'Payout initiated'
          }]),
        },
      });

      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.DATA_CREATE,
          action: AuditActions.PAYOUT_CREATED,
          module: AuditModules.PAYOUTS,
          entityType: AuditEntityTypes.PAYOUT,
          entityId: record.id,
          entityNo: record.payoutNo,
          entityOwnerType: 'CUSTOMER',
          entityOwnerId: record.ownerId || undefined,
          reason: 'Payout initiated',
          afterData: {
            status: record.status,
            withdrawId: record.withdrawId,
            amount: record.amount?.toString?.(),
            assetId: record.assetId,
          },
          sourcePlatform: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
        },
        {
          actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
          actorId: operatorId,
          actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
        },
        client,
      );

      return record;
    };

    if (tx) {
      return executeCreate(tx);
    }

    return await (this.prisma as any).$transaction(async (client: any) => {
      return executeCreate(client);
    });
  }

  async updateStatus(id: string, dto: UpdatePayoutStatusDto, operatorId: string, tx?: Prisma.TransactionClient) {
    const { action, txHash, referenceNo, reason } = dto;

    if (action === PayoutAction.CLEAR && operatorId !== 'SYSTEM') {
      throw new BadRequestException({
        code: 'PAYOUT_CLEAR_SYSTEM_ONLY',
        message: 'Payout CLEAR is reserved for system closeout only.',
        details: {
          action,
          operatorId,
        },
      });
    }

    const executeUpdate = async (client: Prisma.TransactionClient) => {
      const item = await (client as any).payout.findUnique({
        where: { id },
        include: {
          withdraw: {
            include: {
              asset: {
                select: {
                  type: true,
                },
              },
            },
          },
        },
      });
      if (!item) {
        throw new NotFoundException('Payout not found');
      }

      const oldStatus = item.status as PayoutStatus;
      const type = item.type as PayoutType;
      const transitions =
        type === PayoutType.CRYPTO ? CRYPTO_TRANSITIONS : FIAT_TRANSITIONS;
      const nextStatus = transitions[oldStatus]?.[action] as PayoutStatus;

      if (!nextStatus) {
        throw new BadRequestException(
          `Invalid action ${action} for current status ${oldStatus} and type ${type}`,
        );
      }

      if (type === PayoutType.FIAT && action === PayoutAction.CONFIRM) {
        const effectiveReferenceNo =
          this.normalizeOptionalString(referenceNo) ||
          this.normalizeOptionalString(item.referenceNo) ||
          `BANK-${item.payoutNo || item.id}`;
        dto.referenceNo = effectiveReferenceNo;
      }

      const isDispatchStart =
        (type === PayoutType.CRYPTO && action === PayoutAction.SIGN) ||
        (type === PayoutType.FIAT && action === PayoutAction.SUBMIT);
      if (isDispatchStart && item.withdrawId) {
        await this.pricingCenterService.assertWithdrawExtremeVolatilityNotBlocked({
          ownerType: 'CUSTOMER',
          ownerId: item.ownerId || item.withdraw?.ownerId || 'UNKNOWN_OWNER',
          ownerNo: item.withdraw?.ownerNo || null,
          assetId: item.assetId,
          module: AuditModules.PAYOUTS,
          entityType: AuditEntityTypes.PAYOUT,
          entityId: item.id,
          entityNo: item.payoutNo || null,
          sourcePlatform: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
          auditActor: {
            actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
            actorId: operatorId,
            actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
          },
          surface: 'PAYOUT_DISPATCH',
          action,
          withdrawId: item.withdrawId,
          payoutId: item.id,
        });
      }

      const updateData: any = { status: nextStatus };

      // Update timestamps based on status
      if (nextStatus === PayoutStatus.SIGNING || (type === PayoutType.FIAT && nextStatus === PayoutStatus.CONFIRMING)) {
        if (!item.sentAt) {
          updateData.sentAt = new Date();
        }
      }

      if ([PayoutStatus.CLEAR, PayoutStatus.FAILED, PayoutStatus.TIMEOUT, PayoutStatus.RETURNED].includes(nextStatus)) {
        updateData.completedAt = new Date();
      }

      if (txHash) updateData.txHash = txHash;
      const normalizedReferenceNo = this.normalizeOptionalString(dto.referenceNo);
      if (normalizedReferenceNo) {
        updateData.referenceNo = normalizedReferenceNo;
      }

      // Update status history
      let history: any[] = [];
      try {
        if (item.statusHistory) {
          history = JSON.parse(item.statusHistory);
        }
      } catch (e) {
        // ignore
      }
      history.push({
        status: nextStatus,
        timestamp: new Date().toISOString(),
        operator: operatorId,
        note: reason || (action ? `Action: ${action}` : `Status updated to ${nextStatus}`)
      });
      updateData.statusHistory = JSON.stringify(history);

      const updated = await client.payout.update({
        where: { id },
        data: updateData,
      });

      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.STATE_TRANSITION,
          action: buildStateTransitionAction('PAYOUT', oldStatus, nextStatus),
          module: AuditModules.PAYOUTS,
          entityType: AuditEntityTypes.PAYOUT,
          entityId: updated.id,
          entityNo: updated.payoutNo,
          entityOwnerType: 'CUSTOMER',
          entityOwnerId: updated.ownerId || undefined,
          statusFrom: oldStatus,
          statusTo: nextStatus,
          reason:
            reason || (action ? `Action: ${action}` : `Status updated to ${nextStatus}`),
          beforeData: { status: oldStatus },
          afterData: { status: nextStatus },
          sourcePlatform: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
        },
        {
          actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
          actorId: operatorId,
          actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
        },
        client,
      );

      const postCommitEvents: Array<{ eventName: string; payload: any }> = [];
      if (nextStatus === PayoutStatus.CONFIRMED) {
        postCommitEvents.push({
          eventName: PayoutEvents.EVT_PAYOUT_CONFIRMED,
          payload: {
            payoutId: id,
            withdrawId: item.withdrawId,
            status: nextStatus,
          },
        });
      } else if (nextStatus === PayoutStatus.FAILED || nextStatus === PayoutStatus.TIMEOUT) {
        postCommitEvents.push({
          eventName:
            nextStatus === PayoutStatus.FAILED
              ? PayoutEvents.EVT_PAYOUT_FAILED
              : PayoutEvents.EVT_PAYOUT_TIMEOUT,
          payload: {
            withdrawId: item.withdrawId,
            payoutId: id,
            status: nextStatus,
          },
        });
      } else if (nextStatus === PayoutStatus.RETURNED) {
        postCommitEvents.push({
          eventName: PayoutEvents.EVT_PAYOUT_RETURNED,
          payload: {
            payoutId: id,
            withdrawId: item.withdrawId,
            status: nextStatus,
          },
        });
      }

      return { updated, postCommitEvents };
    };

    if (tx) {
      const result = await executeUpdate(tx);
      return result.updated;
    }

    const result = await (this.prisma as any).$transaction(
      async (client: Prisma.TransactionClient) => executeUpdate(client),
      { timeout: PayoutsService.UPDATE_STATUS_TX_TIMEOUT_MS },
    );
    for (const event of result.postCommitEvents) {
      this.eventEmitter.emit(event.eventName, event.payload);
    }
    return result.updated;
  }

  async createMock(operatorId: string) {
    const assets = await (this.prisma as any).asset.findMany({ take: 10 });
    if (assets.length === 0) throw new BadRequestException('No assets found to create mock payouts');
    const customers = await (this.prisma as any).customerMain.findMany({
      take: 10,
      select: {
        id: true,
        customerNo: true,
      },
    });
    if (customers.length === 0) throw new BadRequestException('No customers found to create mock payouts');

    const createdPayouts: any[] = [];

    for (let i = 0; i < 3; i++) {
      const asset = assets[Math.floor(Math.random() * assets.length)];
      const customer = customers[Math.floor(Math.random() * customers.length)];
      const type = asset.type === 'FIAT' ? PayoutType.FIAT : PayoutType.CRYPTO;
      const amount = Math.floor(Math.random() * 1000) + 10;
      const withdrawNo = `WDR_MOCK_${uuidv4().substring(0, 8)}`;
      const withdrawId = uuidv4();

      await (this.prisma as any).$transaction(async (tx: any) => {
        // Create a mock withdraw transaction first
        const withdraw = await tx.withdrawTransaction.create({
          data: {
            id: withdrawId,
            withdrawNo,
            ownerType: 'CUSTOMER',
            ownerId: customer.id,
            ownerNo: customer.customerNo,
            status: 'PAYOUT_PENDING',
            assetId: asset.id,
            amount: new Prisma.Decimal(amount),
            netAmount: new Prisma.Decimal(amount),
            feeAmount: new Prisma.Decimal(0),
            toAddress: type === PayoutType.CRYPTO ? '0x' + uuidv4().replace(/-/g, '') : null,
            toIban: type === PayoutType.FIAT ? 'IBAN' + uuidv4().substring(0, 20) : null,
          },
        });

        const payoutId = this.generatePayoutId();
        const payout = await tx.payout.create({
          data: {
            id: payoutId,
            withdrawId: withdraw.id,
            type,
            status: PayoutStatus.CREATED,
            amount: new Prisma.Decimal(amount),
            assetId: asset.id,
            toAddress: type === PayoutType.CRYPTO ? '0x' + uuidv4().replace(/-/g, '') : null,
            toIban: type === PayoutType.FIAT ? 'IBAN' + uuidv4().substring(0, 20) : null,
          },
        });

        await this.auditLogsService.recordByActor(
          {
            triggerType: AuditTriggerType.DATA_CREATE,
            action: AuditActions.PAYOUT_CREATED,
            module: AuditModules.PAYOUTS,
            entityType: AuditEntityTypes.PAYOUT,
            entityId: payout.id,
            entityOwnerType: 'CUSTOMER',
            entityOwnerId: withdraw.ownerId,
            reason: 'Mock payout created',
            afterData: { status: payout.status, withdrawId: payout.withdrawId },
            sourcePlatform: 'SYSTEM',
          },
          {
            actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
            actorId: operatorId,
            actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
          },
          tx,
        );

        createdPayouts.push(payout);
      });
    }

    return createdPayouts;
  }
}
