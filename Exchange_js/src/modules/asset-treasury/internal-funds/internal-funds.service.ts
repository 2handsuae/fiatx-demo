import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import {
  InternalFundAction,
  InternalFundQueryDto,
  InternalFundStatus,
  UpdateInternalFundStatusDto,
} from './dto/internal-fund.dto';
import { InternalTransactionsService } from '../internal-transactions/internal-transactions.service';
import {
  InternalTransactionStatus,
  InternalTransactionType,
} from '../internal-transactions/dto/internal-transaction.dto';
import { WalletRole } from '../wallets/dto/wallet.dto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  buildStateTransitionAction,
} from '../../audit-logging/constants/audit-actions.constant';

const CRYPTO_TRANSITIONS: Record<
  InternalFundStatus,
  Partial<Record<InternalFundAction, InternalFundStatus>>
> = {
  [InternalFundStatus.CREATED]: {
    [InternalFundAction.SIGN]: InternalFundStatus.SIGNING,
    [InternalFundAction.CANCEL]: InternalFundStatus.CANCELLED,
  },
  [InternalFundStatus.SIGNING]: {
    [InternalFundAction.BROADCAST]: InternalFundStatus.BROADCASTED,
    [InternalFundAction.SIGN_FAIL]: InternalFundStatus.FAILED,
    [InternalFundAction.CANCEL]: InternalFundStatus.CANCELLED,
  },
  [InternalFundStatus.BROADCASTED]: {
    [InternalFundAction.SEEN_IN_MEMPOOL]: InternalFundStatus.CONFIRMING,
    [InternalFundAction.DROP]: InternalFundStatus.FAILED,
    [InternalFundAction.TIMEOUT]: InternalFundStatus.TIMEOUT,
    [InternalFundAction.CANCEL]: InternalFundStatus.CANCELLED,
  },
  [InternalFundStatus.CONFIRMING]: {
    [InternalFundAction.CONFIRM]: InternalFundStatus.CONFIRMED,
    [InternalFundAction.FAIL]: InternalFundStatus.FAILED,
    [InternalFundAction.TIMEOUT]: InternalFundStatus.TIMEOUT,
    [InternalFundAction.CANCEL]: InternalFundStatus.CANCELLED,
  },
  [InternalFundStatus.CONFIRMED]: {
    [InternalFundAction.CLEAR]: InternalFundStatus.CLEAR,
  },
  [InternalFundStatus.CLEAR]: {},
  [InternalFundStatus.FAILED]: {},
  [InternalFundStatus.TIMEOUT]: {},
  [InternalFundStatus.RETURNED]: {},
  [InternalFundStatus.CANCELLED]: {},
};

const FIAT_TRANSITIONS: Record<
  InternalFundStatus,
  Partial<Record<InternalFundAction, InternalFundStatus>>
> = {
  [InternalFundStatus.CREATED]: {
    [InternalFundAction.SUBMIT]: InternalFundStatus.CONFIRMING,
    [InternalFundAction.CANCEL]: InternalFundStatus.CANCELLED,
  },
  [InternalFundStatus.SIGNING]: {},
  [InternalFundStatus.BROADCASTED]: {},
  [InternalFundStatus.CONFIRMING]: {
    [InternalFundAction.CONFIRM]: InternalFundStatus.CONFIRMED,
    [InternalFundAction.FAIL]: InternalFundStatus.FAILED,
    [InternalFundAction.TIMEOUT]: InternalFundStatus.TIMEOUT,
    [InternalFundAction.CANCEL]: InternalFundStatus.CANCELLED,
  },
  [InternalFundStatus.CONFIRMED]: {
    [InternalFundAction.CLEAR]: InternalFundStatus.CLEAR,
    [InternalFundAction.RETURN]: InternalFundStatus.RETURNED,
  },
  [InternalFundStatus.CLEAR]: {
    [InternalFundAction.RETURN]: InternalFundStatus.RETURNED,
  },
  [InternalFundStatus.FAILED]: {},
  [InternalFundStatus.TIMEOUT]: {},
  [InternalFundStatus.RETURNED]: {},
  [InternalFundStatus.CANCELLED]: {},
};

const TERMINAL_STATUSES = new Set<InternalFundStatus>([
  InternalFundStatus.CLEAR,
  InternalFundStatus.FAILED,
  InternalFundStatus.TIMEOUT,
  InternalFundStatus.RETURNED,
  InternalFundStatus.CANCELLED,
]);

type TxClient = Prisma.TransactionClient;

type CreateFromInternalTransactionInput = {
  internalTransactionId: string;
  status?: InternalFundStatus;
  amount?: Prisma.Decimal;
  feeAmount?: Prisma.Decimal;
  netAmount?: Prisma.Decimal;
  fromWalletId?: string | null;
  fromAddress?: string | null;
  fromIban?: string | null;
  toWalletId?: string | null;
  toAddress?: string | null;
  toIban?: string | null;
  referenceNo?: string | null;
};

@Injectable()
export class InternalFundsService {
  private static readonly MAX_NO_GENERATION_RETRIES = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly internalTransactionsService: InternalTransactionsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private getTransitionMap(assetType: string) {
    return assetType === 'FIAT' ? FIAT_TRANSITIONS : CRYPTO_TRANSITIONS;
  }

  private appendStatusHistory(
    current: string | null | undefined,
    nextStatus: InternalFundStatus,
    operatorId: string,
    reason: string,
  ) {
    let history: any[] = [];
    try {
      if (current) {
        history = JSON.parse(current);
      }
      if (!Array.isArray(history)) {
        history = [];
      }
    } catch {
      history = [];
    }

    history.push({
      status: nextStatus,
      timestamp: new Date().toISOString(),
      operator: operatorId,
      note: reason,
    });

    return JSON.stringify(history);
  }

  private isInternalFundNoUniqueConflict(error: unknown): boolean {
    const maybe = error as {
      code?: string;
      meta?: { target?: string[] | string };
    };
    if (maybe?.code !== 'P2002') return false;
    const target = maybe.meta?.target;
    if (Array.isArray(target)) return target.includes('internalFundNo');
    if (typeof target === 'string') return target.includes('internalFundNo');
    return false;
  }

  private buildDepositWorkflowAuditContext(internalTx?: {
    sourceType?: string | null;
    sourceId?: string | null;
    sourceNo?: string | null;
  } | null) {
    if (String(internalTx?.sourceType || '').toUpperCase() !== 'DEPOSIT') {
      return {};
    }

    return {
      workflowType: 'DEPOSIT',
    };
  }

  private async autoClearConfirmedFunds(
    client: TxClient,
    internalTransaction: {
      id: string;
      sourceType?: string | null;
      sourceId?: string | null;
      sourceNo?: string | null;
    },
    operatorId: string,
  ): Promise<
    Array<{
      internalFundId: string;
      internalTransactionId: string;
      oldStatus: string;
      newStatus: string;
      operatorId: string;
    }>
  > {
    const emittedEvents: Array<{
      internalFundId: string;
      internalTransactionId: string;
      oldStatus: string;
      newStatus: string;
      operatorId: string;
    }> = [];
    const confirmedFunds = await (client as any).internalFund.findMany({
      where: {
        internalTransactionId: internalTransaction.id,
        status: InternalFundStatus.CONFIRMED,
      },
      select: {
        id: true,
        statusHistory: true,
      },
    });

    if (!confirmedFunds.length) return emittedEvents;

    for (const fund of confirmedFunds) {
      const reason = 'Auto clear after internal transaction success';
      await (client as any).internalFund.update({
        where: { id: fund.id },
        data: {
          status: InternalFundStatus.CLEAR,
          completedAt: new Date(),
          statusHistory: this.appendStatusHistory(
            fund.statusHistory,
            InternalFundStatus.CLEAR,
            operatorId,
            reason,
          ),
        },
      });

      await this.auditLogsService.recordByActor(
        {

          action: buildStateTransitionAction(
            'INTERNAL_FUND',
            InternalFundStatus.CONFIRMED,
            InternalFundStatus.CLEAR,
          ),
          entityType: AuditEntityTypes.INTERNAL_FUND,
          entityId: fund.id,
          reason,
          ...this.buildDepositWorkflowAuditContext(internalTransaction),
          sourcePlatform: 'SYSTEM',
        },
        {
          actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
          actorId: operatorId,
          actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
        },
        client,
      );

      emittedEvents.push({
        internalFundId: fund.id,
        internalTransactionId: internalTransaction.id,
        oldStatus: InternalFundStatus.CONFIRMED,
        newStatus: InternalFundStatus.CLEAR,
        operatorId,
      });
    }

    return emittedEvents;
  }

  async createFromInternalTransaction(
    input: CreateFromInternalTransactionInput,
    operatorId = 'SYSTEM',
    tx?: TxClient,
  ) {
    const execute = async (client: TxClient) => {
      const internalTx = await (client as any).internalTransaction.findUnique({
        where: { id: input.internalTransactionId },
        include: {
          asset: true,
          fromWallet: true,
        },
      });
      if (!internalTx) {
        throw new NotFoundException('Internal transaction not found');
      }

      const existing = await (client as any).internalFund.findFirst({
        where: { internalTransactionId: input.internalTransactionId },
      });
      if (existing) return existing;

      for (
        let attempt = 1;
        attempt <= InternalFundsService.MAX_NO_GENERATION_RETRIES;
        attempt += 1
      ) {
        const internalFundNo = generateReferenceNo('IFD');
        const status = input.status ?? InternalFundStatus.CREATED;

        try {
          const created = await (client as any).internalFund.create({
            data: {
              internalFundNo,
              internalTransactionId: input.internalTransactionId,
              status,
              assetId: internalTx.assetId,
              amount:
                input.amount ??
                new Prisma.Decimal(internalTx.netAmount || internalTx.amount),
              feeAmount: input.feeAmount ?? new Prisma.Decimal(0),
              netAmount:
                input.netAmount ??
                new Prisma.Decimal(internalTx.netAmount || internalTx.amount),
              fromWalletId:
                input.fromWalletId ?? internalTx.fromWalletId ?? null,
              fromAddress: input.fromAddress ?? internalTx.fromAddress ?? null,
              fromIban: input.fromIban ?? internalTx.fromIban ?? null,
              toWalletId: input.toWalletId ?? internalTx.toWalletId ?? null,
              toAddress: input.toAddress ?? internalTx.toAddress ?? null,
              toIban: input.toIban ?? internalTx.toIban ?? null,
              referenceNo: input.referenceNo ?? internalTx.referenceNo ?? null,
              statusHistory: this.appendStatusHistory(
                null,
                status,
                operatorId,
                'Internal fund created',
              ),
              completedAt: TERMINAL_STATUSES.has(status) ? new Date() : null,
            },
            include: {
              asset: true,
              fromWallet: true,
              internalTransaction: {
                select: {
                  id: true,
                  internalTxNo: true,
                  sourceType: true,
                  sourceId: true,
                  sourceNo: true,
                },
              },
            },
          });

          await this.auditLogsService.recordByActor(
            {

              action: AuditActions.INTERNAL_FUND_CREATED,
              entityType: AuditEntityTypes.INTERNAL_FUND,
              entityId: created.id,
              entityNo: created.internalFundNo,
              reason: 'Initial creation',
              ...this.buildDepositWorkflowAuditContext(created.internalTransaction),
              sourcePlatform: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
            },
            {
              actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
              actorId: operatorId,
              actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
            },
            client,
          );

          return created;
        } catch (error) {
          if (this.isInternalFundNoUniqueConflict(error)) {
            continue;
          }
          throw error;
        }
      }

      throw new InternalServerErrorException(
        `Failed to generate unique internalFundNo after ${InternalFundsService.MAX_NO_GENERATION_RETRIES} attempts`,
      );
    };

    if (tx) return execute(tx);
    return (this.prisma as any).$transaction((client: TxClient) =>
      execute(client),
    );
  }

  async updateStatus(
    id: string,
    dto: UpdateInternalFundStatusDto,
    operatorId = 'SYSTEM',
    tx?: TxClient,
  ) {
    const {
      action,
      txHash,
      referenceNo,
      reason,
      feeAmount,
      providerTxnId,
      nonce,
      blockNo,
      gasUsed,
      effectiveGasPrice,
      confirmations,
    } = dto;

    const execute = async (client: TxClient) => {
      const internalFundDetailInclude = {
        asset: true,
        fromWallet: true,
        internalTransaction: {
          select: {
            id: true,
            internalTxNo: true,
            sourceType: true,
            sourceId: true,
            sourceNo: true,
          },
        },
      } as const;
      const eventPayloads: Array<{
        internalFundId: string;
        internalTransactionId: string;
        oldStatus: string;
        newStatus: string;
        operatorId: string;
      }> = [];
      const item = await (client as any).internalFund.findUnique({
        where: { id },
        include: internalFundDetailInclude,
      });
      if (!item) {
        throw new NotFoundException('Internal fund not found');
      }

      const currentStatus = item.status as InternalFundStatus;
      const transitions = this.getTransitionMap(item.asset?.type || 'CRYPTO');
      const nextStatus = transitions[currentStatus]?.[action];

      if (!nextStatus) {
        throw new BadRequestException(
          `Invalid action ${action} for current status ${currentStatus}`,
        );
      }

      const updateData: any = {
        status: nextStatus,
      };

      if (
        nextStatus === InternalFundStatus.SIGNING ||
        (item.asset?.type === 'FIAT' &&
          nextStatus === InternalFundStatus.CONFIRMING)
      ) {
        if (!item.sentAt) {
          updateData.sentAt = new Date();
        }
      }

      if (nextStatus === InternalFundStatus.CONFIRMED && !item.confirmedAt) {
        updateData.confirmedAt = new Date();
      }

      if (TERMINAL_STATUSES.has(nextStatus)) {
        updateData.completedAt = new Date();
      }

      if (txHash) updateData.txHash = txHash;
      if (referenceNo) updateData.referenceNo = referenceNo;
      if (feeAmount !== undefined)
        updateData.feeAmount = new Prisma.Decimal(feeAmount);
      if (providerTxnId) updateData.providerTxnId = providerTxnId;
      if (nonce) updateData.nonce = nonce;
      if (blockNo) updateData.blockNo = blockNo;
      if (gasUsed) updateData.gasUsed = gasUsed;
      if (effectiveGasPrice) updateData.effectiveGasPrice = effectiveGasPrice;
      if (typeof confirmations === 'number')
        updateData.confirmations = confirmations;

      updateData.statusHistory = this.appendStatusHistory(
        item.statusHistory,
        nextStatus,
        operatorId,
        reason || `Action: ${action}`,
      );

      const updated = await (client as any).internalFund.update({
        where: { id },
        data: updateData,
      });

      await this.auditLogsService.recordByActor(
        {

          action: buildStateTransitionAction('INTERNAL_FUND', currentStatus, nextStatus),
          entityType: AuditEntityTypes.INTERNAL_FUND,
          entityId: updated.id,
          entityNo: updated.internalFundNo,
          reason: reason || `Action: ${action}`,
          ...this.buildDepositWorkflowAuditContext(item.internalTransaction),
          sourcePlatform: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
        },
        {
          actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
          actorId: operatorId,
          actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
        },
        client,
      );

      const txStatus =
        await this.internalTransactionsService.syncStatusFromFunds(
          item.internalTransaction.id,
          operatorId,
          client,
        );
      eventPayloads.push({
        internalFundId: item.id,
        internalTransactionId: item.internalTransaction.id,
        oldStatus: currentStatus,
        newStatus: nextStatus,
        operatorId,
      });

      let settledFund: any = updated;

      if (
        nextStatus === InternalFundStatus.CONFIRMED &&
        txStatus?.status === InternalTransactionStatus.SUCCESS
      ) {
        eventPayloads.push(
          ...(await this.autoClearConfirmedFunds(
            client,
            item.internalTransaction,
            operatorId,
          )),
        );
        if (
          eventPayloads.some(
            (eventPayload) =>
              eventPayload.internalFundId === item.id &&
              eventPayload.newStatus === InternalFundStatus.CLEAR,
          )
        ) {
          settledFund = await (client as any).internalFund.findUnique({
            where: { id },
            include: internalFundDetailInclude,
          });
        }
      }

      return {
        updated: settledFund,
        eventPayloads,
      };
    };

    if (tx) {
      const result = await execute(tx);
      return result.updated;
    }

    const result = await (this.prisma as any).$transaction(
      (client: TxClient) => execute(client),
    );

    if (result?.eventPayloads?.length) {
      for (const eventPayload of result.eventPayloads) {
        this.eventEmitter.emit('internal-fund.status.changed', eventPayload);
      }
    }

    return result.updated;
  }

  async findAllForAdmin(query: InternalFundQueryDto) {
    const {
      skip = 0,
      take = 20,
      internalTransactionId,
      status,
      txHash,
      internalFundNo,
      assetId,
      startDate,
      endDate,
    } = query;

    const where: any = {};
    if (internalTransactionId)
      where.internalTransactionId = internalTransactionId;
    if (status) where.status = status;
    if (txHash) where.txHash = { contains: txHash };
    if (internalFundNo) where.internalFundNo = { contains: internalFundNo };
    if (assetId) where.assetId = assetId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).internalFund.findMany({
        where,
        skip: Number(skip),
        take: Number(take),
        orderBy: { createdAt: 'desc' },
        include: {
          asset: true,
          fromWallet: true,
          toWallet: true,
          internalTransaction: {
            select: {
              id: true,
              internalTxNo: true,
              type: true,
              status: true,
            },
          },
        },
      }),
      (this.prisma as any).internalFund.count({ where }),
    ]);

    return { items, total };
  }

  async findOneForAdmin(id: string) {
    const item = await (this.prisma as any).internalFund.findUnique({
      where: { id },
      include: {
        asset: true,
        fromWallet: true,
        toWallet: true,
        internalTransaction: {
          include: {
            asset: true,
            fromWallet: true,
            toWallet: true,
          },
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Internal fund not found');
    }

    return item;
  }

  async createMock(operatorId = 'SYSTEM') {
    const systemWallets = await (this.prisma as any).wallet.findMany({
      where: {
        walletRole: { in: [WalletRole.C_MAIN, WalletRole.F_LIQ] },
        status: 'ACTIVE',
      },
      include: {
        asset: true,
      },
      take: 40,
    });

    const pairByAsset = new Map<
      string,
      { asset: any; fromWallet: any | null; toWallet: any | null }
    >();
    for (const wallet of systemWallets) {
      if (!pairByAsset.has(wallet.assetId)) {
        pairByAsset.set(wallet.assetId, {
          asset: wallet.asset,
          fromWallet: null,
          toWallet: null,
        });
      }
      const pair = pairByAsset.get(wallet.assetId)!;
      if (wallet.walletRole === WalletRole.C_MAIN) {
        pair.fromWallet = wallet;
      } else if (wallet.walletRole === WalletRole.F_LIQ) {
        pair.toWallet = wallet;
      }
    }

    const candidates = Array.from(pairByAsset.values()).filter(
      (pair) =>
        pair.asset?.type === 'CRYPTO' && pair.fromWallet && pair.toWallet,
    );

    if (!candidates.length) {
      throw new BadRequestException(
        'No active C_MAIN/F_LIQ wallet pair found for mock creation',
      );
    }

    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    const asset = selected.asset;
    const fromWallet = selected.fromWallet;
    const toWallet = selected.toWallet;
    const amount = new Prisma.Decimal((Math.random() * 10 + 1).toFixed(6));

    return (this.prisma as any).$transaction(async (tx: TxClient) => {
      const internalTx =
        await this.internalTransactionsService.createStandaloneTransaction(
          {
            type: InternalTransactionType.MASTER_TO_LIQ,
            status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
            sourceType: 'MOCK',
            sourceId: `MOCK_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            sourceNo: generateReferenceNo('MOCK'),
            ownerType: 'PLATFORM',
            ownerId: 'PLATFORM',
            ownerNo: 'PLATFORM',
            assetId: asset.id,
            amount,
            feeAmount: new Prisma.Decimal(0),
            netAmount: amount,
            fromWalletId: fromWallet?.id ?? null,
            fromAddress: fromWallet?.address ?? `0xmockfrom${Date.now()}`,
            fromIban: null,
            toWalletId: toWallet?.id ?? null,
            toAddress: toWallet?.address ?? `0xmockto${Date.now()}`,
            toIban: null,
            referenceNo: generateReferenceNo('MOCKREF'),
          },
          operatorId,
          tx,
        );

      return this.createFromInternalTransaction(
        {
          internalTransactionId: internalTx.id,
          status: InternalFundStatus.CREATED,
          amount,
          feeAmount: new Prisma.Decimal(0),
          netAmount: amount,
        },
        operatorId,
        tx,
      );
    });
  }
}
