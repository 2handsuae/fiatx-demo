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
} from '../dto/internal-fund.dto';
import { InternalTransactionStatus } from '../dto/internal-transaction.dto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  buildInternalFundStateAction,
} from '../../audit-logging/constants/audit-actions.constant';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { FundsFlowAggregatorPort } from './funds-flow-aggregator.port';
import { WalletBalanceService } from '../../asset-treasury/wallets/wallet-balance.service';

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
    [InternalFundAction.REORG]: InternalFundStatus.BROADCASTED,
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
  [InternalFundStatus.NEEDS_REVIEW]: {},
  [InternalFundStatus.CANCELLED]: {},
};

export const FIAT_TRANSITIONS: Record<
  InternalFundStatus,
  Partial<Record<InternalFundAction, InternalFundStatus>>
> = {
  [InternalFundStatus.CREATED]: {
    [InternalFundAction.SUBMIT]: InternalFundStatus.CONFIRMING,
    [InternalFundAction.CANCEL]: InternalFundStatus.CANCELLED,
  },
  [InternalFundStatus.CONFIRMING]: {
    [InternalFundAction.CONFIRM]: InternalFundStatus.CONFIRMED,
    [InternalFundAction.FAIL]: InternalFundStatus.FAILED,
    [InternalFundAction.TIMEOUT]: InternalFundStatus.TIMEOUT,
  },
  [InternalFundStatus.CONFIRMED]: {
    [InternalFundAction.CLEAR]: InternalFundStatus.CLEAR,
    [InternalFundAction.RETURN]: InternalFundStatus.RETURNED,
  },
  [InternalFundStatus.CLEAR]: {
    [InternalFundAction.RETURN]: InternalFundStatus.RETURNED,
  },
  [InternalFundStatus.SIGNING]: {},
  [InternalFundStatus.BROADCASTED]: {},
  [InternalFundStatus.FAILED]: {},
  [InternalFundStatus.TIMEOUT]: {},
  [InternalFundStatus.RETURNED]: {},
  [InternalFundStatus.NEEDS_REVIEW]: {},
  [InternalFundStatus.CANCELLED]: {},
};

const TERMINAL_STATUSES = new Set<InternalFundStatus>([
  InternalFundStatus.CLEAR,
  InternalFundStatus.FAILED,
  InternalFundStatus.TIMEOUT,
  InternalFundStatus.RETURNED,
  InternalFundStatus.NEEDS_REVIEW,
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

/**
 * V7 funds-flow execution state machine (CRYPTO + FIAT).
 *
 * Ported from InternalFundsService (asset-treasury). It operates on the SAME
 * Prisma tables (internalFund / internalTransaction). The transition map is
 * selected per asset type (CRYPTO_TRANSITIONS vs FIAT_TRANSITIONS); other
 * differences vs source: no demo/mock helper, and the domain event is renamed
 * to fundsflow.status.changed with V7 payload keys.
 */
@Injectable()
export class FundsFlowService {
  private static readonly MAX_NO_GENERATION_RETRIES = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aggregator: FundsFlowAggregatorPort,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditLogsService: AuditLogsService,
    private readonly walletBalance: WalletBalanceService,
  ) {}

  /**
   * Mock-balance side effect of a leg reaching CLEAR: debit the from-wallet and
   * credit the to-wallet by the leg amount. No validation, allows negative.
   */
  private async applyLegClearedBalance(
    fund: {
      fromWalletId?: string | null;
      toWalletId?: string | null;
      amount: Prisma.Decimal | string | number;
    },
    client: TxClient,
  ): Promise<void> {
    const amount = new Prisma.Decimal(fund.amount ?? 0);
    await this.walletBalance.adjust(fund.fromWalletId, amount.negated(), client);
    await this.walletBalance.adjust(fund.toWalletId, amount, client);
  }

  private getTransitionMap(assetType?: string) {
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
      fundsFlowId: string;
      internalTransferId: string;
      oldStatus: string;
      newStatus: string;
      operatorId: string;
    }>
  > {
    const emittedEvents: Array<{
      fundsFlowId: string;
      internalTransferId: string;
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
        fromWalletId: true,
        toWalletId: true,
        amount: true,
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

      // Mock-balance: leg auto-cleared → move balance from→to.
      await this.applyLegClearedBalance(fund, client);

      await this.auditLogsService.recordByActor(
        {
          action: buildInternalFundStateAction(InternalFundStatus.CLEAR),
          metadata: JSON.stringify({ from: InternalFundStatus.CONFIRMED }) as any,
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
        fundsFlowId: fund.id,
        internalTransferId: internalTransaction.id,
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
        attempt <= FundsFlowService.MAX_NO_GENERATION_RETRIES;
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
              action: AuditActions.CREATED,
              entityType: AuditEntityTypes.INTERNAL_FUND,
              entityId: created.id,
              entityNo: created.internalFundNo,
              reason: 'Initial creation',
              ...this.buildDepositWorkflowAuditContext(
                created.internalTransaction,
              ),
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
        `Failed to generate unique internalFundNo after ${FundsFlowService.MAX_NO_GENERATION_RETRIES} attempts`,
      );
    };

    if (tx) return execute(tx);
    return (this.prisma as any).$transaction((client: TxClient) =>
      execute(client),
    );
  }

  async createLeg(
    input: {
      internalTransactionId: string;
      fromWalletId: string;
      toWalletId: string;
      amount: Prisma.Decimal;
      status?: InternalFundStatus;
    },
    operatorId = 'SYSTEM',
    tx?: TxClient,
  ) {
    const execute = async (client: TxClient) => {
      const internalTx = await (client as any).internalTransaction.findUnique({
        where: { id: input.internalTransactionId },
      });
      if (!internalTx) throw new NotFoundException('Internal transaction not found');

      const status = input.status ?? InternalFundStatus.CREATED;
      for (
        let attempt = 1;
        attempt <= FundsFlowService.MAX_NO_GENERATION_RETRIES;
        attempt += 1
      ) {
        const internalFundNo = generateReferenceNo('IFD');
        try {
          const created = await (client as any).internalFund.create({
            data: {
              internalFundNo,
              internalTransactionId: input.internalTransactionId,
              status,
              assetId: internalTx.assetId,
              amount: input.amount,
              feeAmount: new Prisma.Decimal(0),
              netAmount: input.amount,
              fromWalletId: input.fromWalletId,
              toWalletId: input.toWalletId,
              statusHistory: this.appendStatusHistory(null, status, operatorId, 'Fund leg created'),
              completedAt: TERMINAL_STATUSES.has(status) ? new Date() : null,
            },
          });
          await this.auditLogsService.recordByActor(
            {
              action: AuditActions.CREATED,
              entityType: AuditEntityTypes.INTERNAL_FUND,
              entityId: created.id,
              entityNo: created.internalFundNo,
              reason: 'Fund leg created',
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
          if (this.isInternalFundNoUniqueConflict(error)) continue;
          throw error;
        }
      }
      throw new InternalServerErrorException(
        `Failed to generate unique internalFundNo after ${FundsFlowService.MAX_NO_GENERATION_RETRIES} attempts`,
      );
    };
    if (tx) return execute(tx);
    return (this.prisma as any).$transaction((client: TxClient) => execute(client));
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
        fundsFlowId: string;
        internalTransferId: string;
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

      // External-reference fallback: real adapters pass txHash/referenceNo in;
      // sim/dev fabricate them so every leg that physically left the building
      // carries a real key. Crypto → txHash on BROADCAST (the "sent on-chain"
      // step); fiat → bank referenceNo on SUBMIT (the "sent to bank" step, i.e.
      // CREATED→CONFIRMING in FIAT_TRANSITIONS — fiat never goes through
      // BROADCAST). Mirrors the payout mock-gas pattern.
      let effectiveTxHash = txHash;
      let effectiveReferenceNo = referenceNo;
      let effectiveGasUsed = gasUsed;
      let effectiveGasPriceValue = effectiveGasPrice;
      if ((item.asset?.type || 'CRYPTO') !== 'FIAT') {
        if (
          action === InternalFundAction.BROADCAST &&
          !effectiveTxHash &&
          !item.txHash
        ) {
          effectiveTxHash =
            '0x' +
            Array.from({ length: 64 }, () =>
              Math.floor(Math.random() * 16).toString(16),
            ).join('');
        }
        if (action === InternalFundAction.CONFIRM) {
          if (!effectiveGasUsed && !item.gasUsed) {
            effectiveGasUsed = String(21000 + Math.floor(Math.random() * 60000));
          }
          if (!effectiveGasPriceValue && !item.effectiveGasPrice) {
            effectiveGasPriceValue = String(
              Math.floor((1 + Math.random() * 9) * 1_000_000_000),
            );
          }
        }
      } else {
        if (
          action === InternalFundAction.SUBMIT &&
          !effectiveReferenceNo &&
          !item.referenceNo
        ) {
          effectiveReferenceNo = `BANK-${item.internalFundNo}`;
        }
      }

      const updateData: any = {
        status: nextStatus,
      };

      if (nextStatus === InternalFundStatus.SIGNING) {
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

      if (effectiveTxHash) updateData.txHash = effectiveTxHash;
      if (effectiveReferenceNo) updateData.referenceNo = effectiveReferenceNo;
      if (feeAmount !== undefined)
        updateData.feeAmount = new Prisma.Decimal(feeAmount);
      if (providerTxnId) updateData.providerTxnId = providerTxnId;
      if (nonce) updateData.nonce = nonce;
      if (blockNo) updateData.blockNo = blockNo;
      if (effectiveGasUsed) updateData.gasUsed = effectiveGasUsed;
      if (effectiveGasPriceValue)
        updateData.effectiveGasPrice = effectiveGasPriceValue;
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

      // Mock-balance: leg cleared (manual CLEAR path) → move balance from→to.
      if (nextStatus === InternalFundStatus.CLEAR) {
        await this.applyLegClearedBalance(
          {
            fromWalletId: item.fromWalletId,
            toWalletId: item.toWalletId,
            amount: item.amount,
          },
          client,
        );
      }

      await this.auditLogsService.recordByActor(
        {
          action: buildInternalFundStateAction(nextStatus),
          metadata: JSON.stringify({ from: currentStatus }) as any,
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

      const txStatus = await this.aggregator.syncStatusFromFunds(
        item.internalTransaction.id,
        operatorId,
        client,
      );
      eventPayloads.push({
        fundsFlowId: item.id,
        internalTransferId: item.internalTransaction.id,
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
              eventPayload.fundsFlowId === item.id &&
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
        this.eventEmitter.emit(
          DomainEventNames.FUNDSFLOW_STATUS_CHANGED,
          eventPayload,
        );
      }
    }

    return result.updated;
  }

  async createSwapLeg(
    input: {
      swapTransactionId: string;
      legSeq: number;
      /** Per-legSeq retry counter (self-heal). Defaults to 1 for the first attempt. */
      legAttempt?: number;
      assetId: string;
      amount: Prisma.Decimal;
      fromWalletId?: string | null;
      toWalletId?: string | null;
    },
    operatorId = 'SYSTEM',
    tx?: TxClient,
  ) {
    const exec = async (client: TxClient) => {
      for (
        let attempt = 1;
        attempt <= FundsFlowService.MAX_NO_GENERATION_RETRIES;
        attempt += 1
      ) {
        const internalFundNo = generateReferenceNo('IFD');
        try {
          const created = await (client as any).internalFund.create({
            data: {
              internalFundNo,
              internalTransactionId: null,
              swapTransactionId: input.swapTransactionId,
              legSeq: input.legSeq,
              attempt: input.legAttempt ?? 1,
              status: InternalFundStatus.CREATED,
              assetId: input.assetId,
              amount: input.amount,
              feeAmount: new Prisma.Decimal(0),
              netAmount: input.amount,
              fromWalletId: input.fromWalletId ?? null,
              toWalletId: input.toWalletId ?? null,
              statusHistory: this.appendStatusHistory(
                null,
                InternalFundStatus.CREATED,
                operatorId,
                `Swap leg ${input.legSeq} created`,
              ),
            },
          });
          await this.auditLogsService.recordByActor(
            {
              action: AuditActions.CREATED,
              entityType: AuditEntityTypes.INTERNAL_FUND,
              entityId: created.id,
              entityNo: created.internalFundNo,
              reason: `Swap leg ${input.legSeq} created`,
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
        } catch (e) {
          if (this.isInternalFundNoUniqueConflict(e)) continue;
          throw e;
        }
      }
      throw new InternalServerErrorException(
        `Failed to generate unique internalFundNo after ${FundsFlowService.MAX_NO_GENERATION_RETRIES} attempts`,
      );
    };
    if (tx) return exec(tx);
    return (this.prisma as any).$transaction((c: TxClient) => exec(c));
  }

  async transitionSwapLeg(
    id: string,
    action: InternalFundAction,
    operatorId = 'SYSTEM',
    tx?: TxClient,
  ) {
    const exec = async (client: TxClient) => {
      const leg = await (client as any).internalFund.findUnique({
        where: { id },
        include: { asset: true },
      });
      if (!leg) throw new NotFoundException('Internal fund leg not found');
      const cur = leg.status as InternalFundStatus;
      const map = this.getTransitionMap(leg.asset?.type || 'CRYPTO');
      const next = map[cur]?.[action];
      if (!next) {
        throw new BadRequestException(
          `Invalid action ${action} for status ${cur}`,
        );
      }
      const updated = await (client as any).internalFund.update({
        where: { id },
        data: {
          status: next,
          statusHistory: this.appendStatusHistory(
            leg.statusHistory,
            next,
            operatorId,
            `Swap leg ${cur}->${next}`,
          ),
          confirmedAt:
            next === InternalFundStatus.CONFIRMED ? new Date() : leg.confirmedAt,
          completedAt: TERMINAL_STATUSES.has(next) ? new Date() : leg.completedAt,
        },
      });
      await this.auditLogsService.recordByActor(
        {
          action: buildInternalFundStateAction(next),
          metadata: JSON.stringify({ from: cur }) as any,
          entityType: AuditEntityTypes.INTERNAL_FUND,
          entityId: id,
          entityNo: leg.internalFundNo,
          reason: `Swap leg ${cur}->${next}`,
          sourcePlatform: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
        },
        {
          actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
          actorId: operatorId,
          actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
        },
        client,
      );
      return { leg: updated, prevStatus: cur, nextStatus: next };
    };
    if (tx) return exec(tx);
    return (this.prisma as any).$transaction((c: TxClient) => exec(c));
  }

  /**
   * Swap-6 self-heal STUCK branch: mark a leg NEEDS_REVIEW after N failed
   * retries. The transition map has no action that lands in NEEDS_REVIEW, so
   * the workflow can't get here through `transitionSwapLeg` — this is the
   * canonical entrypoint that owns the direct status write, statusHistory
   * append, and completedAt set. Mirrors `transitionSwapLeg` / `createSwapLeg`
   * — no workflow knows the InternalFund row schema.
   */
  async markLegNeedsReview(
    id: string,
    attempt: number,
    operatorId = 'SYSTEM',
    tx?: TxClient,
  ) {
    const exec = async (client: TxClient) => {
      const leg = await (client as any).internalFund.findUnique({ where: { id } });
      if (!leg) throw new NotFoundException('Internal fund leg not found');
      const reason = `Stuck after attempt ${attempt} — awaiting manual resume`;
      return (client as any).internalFund.update({
        where: { id },
        data: {
          status: InternalFundStatus.NEEDS_REVIEW,
          completedAt: new Date(),
          statusHistory: this.appendStatusHistory(
            leg.statusHistory,
            InternalFundStatus.NEEDS_REVIEW,
            operatorId,
            reason,
          ),
        },
      });
    };
    if (tx) return exec(tx);
    return (this.prisma as any).$transaction((c: TxClient) => exec(c));
  }

  /**
   * Create the fee leg for a withdrawal. Hangs directly on the withdraw
   * transaction (no InternalTransaction parent) — mirrors createSwapLeg.
   * The fee leg is a REPRESENTATION that follows the withdrawal lifecycle:
   * created CREATED at fee-lock, set CLEAR on finalize, CANCELLED on void.
   * It does NOT drive accounting — the withdraw workflow posts the fee TB
   * transfers (FEE_POST + FEE_FIRM) itself.
   */
  async createWithdrawFeeFund(
    input: {
      withdrawTransactionId: string;
      assetId: string;
      amount: Prisma.Decimal;
      fromWalletId?: string | null;
      fromAddress?: string | null;
      fromIban?: string | null;
      toWalletId?: string | null;
      toAddress?: string | null;
      toIban?: string | null;
    },
    operatorId = 'SYSTEM',
    tx?: TxClient,
  ) {
    const exec = async (client: TxClient) => {
      for (
        let attempt = 1;
        attempt <= FundsFlowService.MAX_NO_GENERATION_RETRIES;
        attempt += 1
      ) {
        const internalFundNo = generateReferenceNo('IFD');
        try {
          const created = await (client as any).internalFund.create({
            data: {
              internalFundNo,
              internalTransactionId: null,
              swapTransactionId: null,
              withdrawTransactionId: input.withdrawTransactionId,
              status: InternalFundStatus.CREATED,
              assetId: input.assetId,
              amount: input.amount,
              feeAmount: new Prisma.Decimal(0),
              netAmount: input.amount,
              fromWalletId: input.fromWalletId ?? null,
              fromAddress: input.fromAddress ?? null,
              fromIban: input.fromIban ?? null,
              toWalletId: input.toWalletId ?? null,
              toAddress: input.toAddress ?? null,
              toIban: input.toIban ?? null,
              statusHistory: this.appendStatusHistory(
                null,
                InternalFundStatus.CREATED,
                operatorId,
                'Withdrawal fee fund created',
              ),
            },
          });
          await this.auditLogsService.recordByActor(
            {
              action: AuditActions.CREATED,
              entityType: AuditEntityTypes.INTERNAL_FUND,
              entityId: created.id,
              entityNo: created.internalFundNo,
              reason: 'Withdrawal fee fund created',
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
        } catch (e) {
          if (this.isInternalFundNoUniqueConflict(e)) continue;
          throw e;
        }
      }
      throw new InternalServerErrorException(
        `Failed to generate unique internalFundNo after ${FundsFlowService.MAX_NO_GENERATION_RETRIES} attempts`,
      );
    };
    if (tx) return exec(tx);
    return (this.prisma as any).$transaction((c: TxClient) => exec(c));
  }

  /**
   * Directly set the status of a withdrawal's fee fund (follows-the-withdrawal
   * model, e.g. CREATED→CLEAR on finalize, CREATED→CANCELLED on void). Not a
   * transition-map move — the fee fund is a representation, not a chain-tracked
   * leg. No-op (returns null) when the withdrawal has no fee fund (fee was 0).
   */
  async setWithdrawFeeFundStatus(
    withdrawTransactionId: string,
    status: InternalFundStatus,
    reason: string,
    operatorId = 'SYSTEM',
    tx?: TxClient,
  ) {
    const exec = async (client: TxClient) => {
      const fund = await (client as any).internalFund.findFirst({
        where: { withdrawTransactionId },
      });
      if (!fund) return null;
      if (fund.status === status) return fund;
      const updated = await (client as any).internalFund.update({
        where: { id: fund.id },
        data: {
          status,
          completedAt: TERMINAL_STATUSES.has(status)
            ? new Date()
            : fund.completedAt,
          statusHistory: this.appendStatusHistory(
            fund.statusHistory,
            status,
            operatorId,
            reason,
          ),
        },
      });
      await this.auditLogsService.recordByActor(
        {
          action: buildInternalFundStateAction(status),
          metadata: JSON.stringify({ from: fund.status }) as any,
          entityType: AuditEntityTypes.INTERNAL_FUND,
          entityId: fund.id,
          entityNo: fund.internalFundNo,
          reason,
          sourcePlatform: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
        },
        {
          actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
          actorId: operatorId,
          actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
        },
        client,
      );
      return updated;
    };
    if (tx) return exec(tx);
    return (this.prisma as any).$transaction((c: TxClient) => exec(c));
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
      type,
      startDate,
      endDate,
    } = query as InternalFundQueryDto & { type?: string };

    const where: any = {};
    if (internalTransactionId)
      where.internalTransactionId = internalTransactionId;
    if (status) where.status = status;
    if (txHash) where.txHash = { contains: txHash };
    if (internalFundNo) where.internalFundNo = { contains: internalFundNo };
    if (assetId) where.assetId = assetId;
    if (type) where.asset = { type };
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

  async findOneByNoForAdmin(internalFundNo: string) {
    const item = await (this.prisma as any).internalFund.findUnique({
      where: { internalFundNo },
      include: {
        asset: true,
        fromWallet: true,
        toWallet: true,
        internalTransaction: {
          select: {
            id: true,
            internalTxNo: true,
            pathLabel: true,
            type: true,
            status: true,
          },
        },
        // Swap legs hang directly on the swap (no internalTransaction parent).
        // Expose swapNo + status so the detail page can advance the leg via the
        // swap settlement endpoint instead of the transfer-simulate endpoint.
        swapTransaction: {
          select: {
            id: true,
            swapNo: true,
            status: true,
          },
        },
        // Withdrawal fee funds hang directly on the withdraw transaction.
        withdrawTransaction: {
          select: {
            id: true,
            withdrawNo: true,
            status: true,
          },
        },
        auditLogs: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!item) {
      throw new NotFoundException('Internal fund not found');
    }
    return item;
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
}
