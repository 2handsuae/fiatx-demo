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
    [PayoutAction.FAIL]: PayoutStatus.FAILED,
    [PayoutAction.REORG]: PayoutStatus.BROADCASTED,
  },
  [PayoutStatus.CONFIRMED]: { [PayoutAction.CLEAR]: PayoutStatus.CLEARED },
  [PayoutStatus.FAILED]: {},
  [PayoutStatus.TIMEOUT]: {},
  [PayoutStatus.CLEARED]: {},
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
    [PayoutAction.CLEAR]: PayoutStatus.CLEARED,
    [PayoutAction.RETURN]: PayoutStatus.RETURNED
  },
  [PayoutStatus.CLEARED]: { [PayoutAction.RETURN]: PayoutStatus.RETURNED },
  [PayoutStatus.FAILED]: {},
  [PayoutStatus.TIMEOUT]: {},
  [PayoutStatus.RETURNED]: {},
};
import { Prisma } from '@prisma/client';
import { WalletBalanceService } from '../wallets/wallet-balance.service';
import { randomUUID as uuidv4 } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PayoutEvents } from './constants/payout-events.constant';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
  buildStateTransitionAction,
} from '../../audit-logging/constants/audit-actions.constant';
import { PayoutFinalizationIncompleteError } from './errors';
@Injectable()
export class PayoutsService {
  private static readonly UPDATE_STATUS_TX_TIMEOUT_MS = 15_000;
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditLogsService: AuditLogsService,
    private readonly walletBalance: WalletBalanceService,
  ) {}

  /** 出资钱包 id 解析(用于 CLEARED 扣 mock 余额)：crypto=客户 C_DEP；fiat=客户 C_VIBAN。
   *  实时 1:1 模型下，客户的虚拟币直接从其自己的 C_DEP（充值地址）出，不再走平台 C_OUT 池。 */
  private async resolveSourceWalletId(
    type: string,
    assetId: string,
    ownerId: string | null,
    client: Prisma.TransactionClient,
  ): Promise<string | null> {
    if (!ownerId) return null;
    const role = String(type).toUpperCase() === 'FIAT' ? 'C_VIBAN' : 'C_DEP';
    const wallet = await (client as any).wallet.findFirst({
      where: { walletRole: role, assetId, ownerType: 'CUSTOMER', ownerId, status: 'ACTIVE' },
      select: { id: true },
    });
    return wallet?.id ?? null;
  }

  /** 出资钱包解析：crypto=客户 C_DEP；fiat=客户 C_VIBAN。 */
  private async resolveSourceWallet(
    type: string,
    assetId: string,
    ownerId: string | null,
  ): Promise<{ fromAddress: string | null; fromIban: string | null }> {
    if (!ownerId) return { fromAddress: null, fromIban: null };
    const isFiat = String(type).toUpperCase() === 'FIAT';
    const role = isFiat ? 'C_VIBAN' : 'C_DEP';
    const wallet = await (this.prisma as any).wallet.findFirst({
      where: { walletRole: role, assetId, ownerType: 'CUSTOMER', ownerId, status: 'ACTIVE' },
      select: { iban: true, address: true },
    });
    return isFiat
      ? { fromAddress: null, fromIban: wallet?.iban ?? null }
      : { fromAddress: wallet?.address ?? null, fromIban: null };
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

  private normalizeStoredPayoutStatus(
    status?: string | null,
  ): PayoutStatus | null {
    const normalized = this.normalizeRailDisplayStatus(status);
    if (
      normalized &&
      Object.values(PayoutStatus).includes(normalized as PayoutStatus)
    ) {
      return normalized as PayoutStatus;
    }
    return null;
  }

  private expandPayoutStatusFilter(
    status?: PayoutStatus | null,
  ): { in: string[] } | undefined {
    if (!status) return undefined;
    if (status === PayoutStatus.CLEARED) {
      return { in: [PayoutStatus.CLEARED, 'CLEAR'] };
    }
    return { in: [status] };
  }

  private expandPayoutTypeFilter(
    type?: PayoutType | null,
  ): { in: string[] } | undefined {
    if (!type) return undefined;
    return { in: [type] };
  }

  private normalizeAuditStatus(status?: string | null): string | null {
    return this.normalizeRailDisplayStatus(status);
  }

  private mapCanonicalAuditLogs(events: any[]) {
    return events.map((event: any) => ({
      id: event.id,
      action: event.action || null,
      statusFrom: this.normalizeAuditStatus(event.statusFrom),
      statusTo: this.normalizeAuditStatus(event.statusTo),
      actorType: event.actorType || null,
      actorId: event.actorId || null,
      actorNo: event.actorNo || null,
      reason: event.reason || null,
      occurredAt: event.occurredAt || event.createdAt || null,
      result: event.result || null,
      oldStatus: this.normalizeAuditStatus(event.statusFrom),
      newStatus: this.normalizeAuditStatus(event.statusTo),
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
    if (status) where.status = this.expandPayoutStatusFilter(status);
    if (type) where.type = this.expandPayoutTypeFilter(type);
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
      status: this.normalizeStoredPayoutStatus(item.status),
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
      },
    });
    if (!item) throw new NotFoundException('Payout not found');
    const auditLogs = await this.getCanonicalPayoutAuditLogs(
      item.id,
      item.payoutNo,
      item.withdrawId,
    );

    // 存量单的出资字段兜底:现场解析(只填响应,不回写)。
    let sourceFallback: { fromAddress: string | null; fromIban: string | null } | null = null;
    if (!item.fromAddress && !item.fromIban) {
      sourceFallback = await this.resolveSourceWallet(
        item.type,
        item.assetId,
        item.ownerId ?? null,
      );
    }

    const customerName = item.customer
      ? [item.customer.firstName, item.customer.lastName].filter(Boolean).join(' ') || null
      : null;

    return {
      ...item,
      ...(sourceFallback ?? {}),
      ownerNo:
        item.customer?.customerNo ||
        this.normalizeOptionalString(item.withdraw?.ownerNo) ||
        null,
      customerName,
      customer: undefined,
      transactionType: 'WITHDRAW',
      transactionId: item.withdrawId,
      transactionNo: item.withdraw?.withdrawNo || null,
      type: this.normalizeAdminPayoutType(item.type),
      status: this.normalizeStoredPayoutStatus(item.status),
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

      let sourceWallet: { fromAddress: string | null; fromIban: string | null } = { fromAddress: null, fromIban: null };
      try {
        sourceWallet = await this.resolveSourceWallet(type, assetId, withdraw.ownerId ?? null);
      } catch (err) {
        this.logger.warn(`resolveSourceWallet failed for withdrawId=${withdrawId}: ${(err as Error).message}`);
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
          fromAddress: sourceWallet.fromAddress,
          fromIban: sourceWallet.fromIban,
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

          action: AuditActions.PAYOUT_CREATED,
          entityType: AuditEntityTypes.PAYOUT,
          entityId: record.id,
          entityNo: record.payoutNo,
          entityOwnerType: 'CUSTOMER',
          entityOwnerId: record.ownerId || undefined,
          reason: 'Payout initiated',
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
          asset: true,
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

      const oldStatus = this.normalizeStoredPayoutStatus(item.status);
      const type = item.type as PayoutType;
      if (!oldStatus) {
        throw new BadRequestException(
          `Unsupported payout status ${String(item.status || '').trim() || 'UNKNOWN'}`,
        );
      }
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

      // Chain receipt gas: real adapters pass it in; sim CONFIRM falls back to
      // mock values so the detail page has data (same pattern as fiat referenceNo).
      if (type === PayoutType.CRYPTO && action === PayoutAction.CONFIRM) {
        if (!dto.gasUsed && !item.gasUsed) {
          dto.gasUsed = String(21000 + Math.floor(Math.random() * 60000));
        }
        if (!dto.effectiveGasPrice && !item.effectiveGasPrice) {
          dto.effectiveGasPrice = String(
            Math.floor((1 + Math.random() * 9) * 1_000_000_000),
          );
        }
        // R3 invariant: CRYPTO payout must carry a txHash by the time it
        // reaches CLEARED. CONFIRM is the canonical moment when the chain
        // receipt is observed — mirror the FIAT CONFIRM referenceNo fallback
        // so demo/sim flows don't leave txHash NULL and trip the R3 guard
        // downstream.
        if (!txHash && !item.txHash) {
          const seed = item.payoutNo || item.id || 'unknown';
          dto.txHash = `0x${String(seed).replace(/[^a-zA-Z0-9]/g, '').padEnd(40, '0').slice(0, 40).toLowerCase()}`;
        }
        // R3 spec: "CRYPTO referenceNo: 同 txHash". Mirror txHash into
        // referenceNo so the CLEARED guard (which requires referenceNo even
        // for CRYPTO) finds a value. Without this, CRYPTO payouts confirm
        // OK but blow up at CLEAR with "referenceNo is required".
        const effRefForCrypto =
          this.normalizeOptionalString(referenceNo) ||
          this.normalizeOptionalString(item.referenceNo) ||
          this.normalizeOptionalString(dto.txHash) ||
          this.normalizeOptionalString(item.txHash);
        if (effRefForCrypto) dto.referenceNo = effRefForCrypto;
      }

      const updateData: any = { status: nextStatus };

      // Update timestamps based on status
      if (nextStatus === PayoutStatus.SIGNING || (type === PayoutType.FIAT && nextStatus === PayoutStatus.CONFIRMING)) {
        if (!item.sentAt) {
          updateData.sentAt = new Date();
        }
      }

      if ([PayoutStatus.CLEARED, PayoutStatus.FAILED, PayoutStatus.TIMEOUT, PayoutStatus.RETURNED].includes(nextStatus)) {
        updateData.completedAt = new Date();
      }

      if (txHash) updateData.txHash = txHash;
      if (!updateData.txHash && dto.txHash) updateData.txHash = dto.txHash;
      if (dto.gasUsed) updateData.gasUsed = dto.gasUsed;
      if (dto.effectiveGasPrice)
        updateData.effectiveGasPrice = dto.effectiveGasPrice;
      const normalizedReferenceNo = this.normalizeOptionalString(dto.referenceNo);
      if (normalizedReferenceNo) {
        updateData.referenceNo = normalizedReferenceNo;
      }

      // ── R3 invariant guard ──
      // CLEARED payout rows must carry a final referenceNo, and CRYPTO must
      // additionally carry a txHash. Effective value = update payload override
      // OR existing persisted value. Missing → throw before update.
      if (nextStatus === PayoutStatus.CLEARED) {
        const effectiveReferenceNo =
          this.normalizeOptionalString(updateData.referenceNo) ||
          this.normalizeOptionalString(item.referenceNo);
        if (!effectiveReferenceNo) {
          throw new PayoutFinalizationIncompleteError(
            `Payout ${item.payoutNo || id} cannot be CLEARED: referenceNo is required`,
          );
        }
        if (type === PayoutType.CRYPTO) {
          const effectiveTxHash =
            this.normalizeOptionalString(updateData.txHash) ||
            this.normalizeOptionalString(item.txHash);
          if (!effectiveTxHash) {
            throw new PayoutFinalizationIncompleteError(
              `CRYPTO payout ${item.payoutNo || id} cannot be CLEARED: txHash is required`,
            );
          }
        }
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

      // Mock-balance: payout cleared → debit the source wallet (funds leave to
      // external; no internal to-wallet). No validation, allows negative.
      if (nextStatus === PayoutStatus.CLEARED) {
        const srcWalletId = await this.resolveSourceWalletId(
          item.type,
          item.assetId,
          item.ownerId ?? null,
          client,
        );
        await this.walletBalance.adjust(
          srcWalletId,
          new Prisma.Decimal(item.amount ?? 0).negated(),
          client,
        );
      }

      await this.auditLogsService.recordByActor(
        {

          action: buildStateTransitionAction('PAYOUT', oldStatus, nextStatus),
          entityType: AuditEntityTypes.PAYOUT,
          entityId: updated.id,
          entityNo: updated.payoutNo,
          entityOwnerType: 'CUSTOMER',
          entityOwnerId: updated.ownerId || undefined,
          reason:
            reason || (action ? `Action: ${action}` : `Status updated to ${nextStatus}`),
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
            payoutNo: generateReferenceNo('PO'),
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
  
            action: AuditActions.PAYOUT_CREATED,
            entityType: AuditEntityTypes.PAYOUT,
            entityId: payout.id,
            entityOwnerType: 'CUSTOMER',
            entityOwnerId: withdraw.ownerId,
            reason: 'Mock payout created',
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
