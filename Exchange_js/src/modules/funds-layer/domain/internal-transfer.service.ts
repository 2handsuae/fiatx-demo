import { randomUUID } from 'node:crypto';
import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditEntityTypes,
  buildStateTransitionAction,
} from '../../audit-logging/constants/audit-actions.constant';
import {
  InternalTransactionApprovalStatus,
  InternalTransactionStatus,
} from '../dto/internal-transaction.dto';
import { AccountingClass, TransferPath } from '../constants/internal-transfer-paths.constant';
import { InternalTransferQueryDto } from '../dto/internal-transfer-query.dto';
import { FundsFlowAggregatorPort } from './funds-flow-aggregator.port';

type TxClient = Prisma.TransactionClient;

export interface CreateTransferInput {
  path: TransferPath;
  accountingClass: AccountingClass;
  medium: string;
  triggerSource: string;
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  ownerType: string;
  ownerId: string;
  ownerNo?: string | null;
  assetId: string;
  amount: Prisma.Decimal;
  feeAmount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  fromWalletId: string;
  toWalletId: string;
  settlementBatchId?: string | null;
  grossInAmount?: Prisma.Decimal | null;
  grossOutAmount?: Prisma.Decimal | null;
}

/**
 * V7 aggregate-level domain service over the `internalTransaction` table.
 * Successor to the now-deleted InternalTransactionsService; consolidates the
 * FundsFlowAggregatorPort so FundsFlowService can roll fund statuses up into
 * the transfer without a circular dependency.
 */
@Injectable()
export class InternalTransferService extends FundsFlowAggregatorPort {
  private static readonly MAX_NO_GENERATION_RETRIES = 10;
  private static readonly TERMINAL_STATUSES = new Set<InternalTransactionStatus>([
    InternalTransactionStatus.SUCCESS,
    InternalTransactionStatus.FAILED,
    InternalTransactionStatus.CANCELLED,
    InternalTransactionStatus.REJECTED,
    InternalTransactionStatus.EXPIRED,
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {
    super();
  }

  private appendStatusHistory(
    current: string | null | undefined,
    nextStatus: InternalTransactionStatus,
    operatorId: string,
    reason: string,
  ): string {
    let history: any[] = [];
    try {
      if (current) {
        history = JSON.parse(current);
      }
      if (!Array.isArray(history)) history = [];
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

  private isInternalTxNoUniqueConflict(error: unknown): boolean {
    const maybe = error as {
      code?: string;
      meta?: { target?: string[] | string };
    };
    if (maybe?.code !== 'P2002') return false;
    const target = maybe.meta?.target;
    if (Array.isArray(target)) return target.includes('internalTxNo');
    if (typeof target === 'string') return target.includes('internalTxNo');
    return false;
  }

  async createTransfer(
    input: CreateTransferInput,
    operatorId = 'SYSTEM',
    tx?: TxClient,
  ) {
    const execute = async (client: TxClient) => {
      // ST-T5: when a settlementBatchId is provided, inherit the batch's
      // traceId so internal_transactions.traceId == settlement_batches.traceId
      // and the audit journey stays joined. Fall back to a fresh UUID for
      // non-batch transfers (e.g. SWAP fee transfers) and for historical
      // batches that pre-date the traceId column.
      let traceId: string | null = null;
      if (input.settlementBatchId) {
        const batch = await (client as any).settlementBatch.findUnique({
          where: { id: input.settlementBatchId },
          select: { traceId: true },
        });
        traceId = batch?.traceId ?? null;
      }
      traceId = traceId ?? randomUUID();
      const status = InternalTransactionStatus.INTERNAL_FUNDS_PENDING;
      const approvalStatus = InternalTransactionApprovalStatus.APPROVED;
      const statusHistory = this.appendStatusHistory(
        null,
        status,
        operatorId,
        'Internal transfer requested',
      );

      for (
        let attempt = 1;
        attempt <= InternalTransferService.MAX_NO_GENERATION_RETRIES;
        attempt += 1
      ) {
        const internalTxNo = generateReferenceNo('ITX');
        try {
          const created = await (client as any).internalTransaction.create({
            data: {
              internalTxNo,
              type: input.path,
              status,
              approvalStatus,
              pathLabel: input.path,
              accountingClass: input.accountingClass,
              medium: input.medium,
              triggerSource: input.triggerSource,
              traceId,
              sourceType: input.sourceType,
              sourceId: input.sourceId,
              sourceNo: input.sourceNo ?? null,
              ownerType: input.ownerType,
              ownerId: input.ownerId,
              ownerNo: input.ownerNo ?? null,
              assetId: input.assetId,
              amount: input.amount,
              feeAmount: input.feeAmount,
              netAmount: input.netAmount,
              fromWalletId: input.fromWalletId,
              toWalletId: input.toWalletId,
              settlementBatchId: input.settlementBatchId ?? null,
              grossInAmount: input.grossInAmount ?? null,
              grossOutAmount: input.grossOutAmount ?? null,
              statusHistory,
            },
          });

          // NOTE: the INTERNAL_TRANSFER_REQUESTED journey audit is written by
          // InternalTransferWorkflowService (L3), not here. Per backend-platform.md
          // the L1 domain service must NOT write business/journey audit logs.

          return created;
        } catch (error) {
          if (this.isInternalTxNoUniqueConflict(error)) {
            continue;
          }
          throw error;
        }
      }

      throw new InternalServerErrorException(
        `Failed to generate unique internalTxNo after ${InternalTransferService.MAX_NO_GENERATION_RETRIES} attempts`,
      );
    };

    if (tx) return execute(tx);
    return (this.prisma as any).$transaction((client: TxClient) =>
      execute(client),
    );
  }

  async syncStatusFromFunds(
    internalTransactionId: string,
    operatorId = 'SYSTEM',
    tx?: TxClient,
  ): Promise<{ status: string }> {
    const execute = async (client: TxClient) => {
      const item = await (client as any).internalTransaction.findUnique({
        where: { id: internalTransactionId },
        include: {
          asset: true,
          fromWallet: {
            select: {
              id: true,
              ownerType: true,
            },
          },
          toWallet: {
            select: {
              id: true,
              ownerType: true,
            },
          },
          funds: {
            select: {
              status: true,
              feeAmount: true,
            },
          },
        },
      });
      if (!item) {
        throw new NotFoundException('Internal transfer not found');
      }

      const current = item.status as InternalTransactionStatus;
      const statuses = (item.funds || []).map((fund: any) => String(fund.status));
      if (!statuses.length) return item;
      if (InternalTransferService.TERMINAL_STATUSES.has(current)) {
        return item;
      }

      let next = current;

      if (
        statuses.every((status: string) =>
          ['CONFIRMED', 'CLEAR'].includes(status),
        )
      ) {
        next = InternalTransactionStatus.SUCCESS;
      } else if (statuses.every((status: string) => status === 'CANCELLED')) {
        next = InternalTransactionStatus.CANCELLED;
      } else {
        const hasFailed = statuses.some(
          (status: string) => status === 'FAILED' || status === 'TIMEOUT',
        );
        const hasProgressing = statuses.some(
          (status: string) =>
            ![
              'FAILED',
              'TIMEOUT',
              'CONFIRMED',
              'CLEAR',
              'CANCELLED',
              'RETURNED',
            ].includes(status),
        );

        if (hasFailed && !hasProgressing) {
          next = InternalTransactionStatus.FAILED;
        }
      }

      if (next === current) return item;

      const totalFee = (item.funds || []).reduce(
        (sum: Prisma.Decimal, fund: any) =>
          sum.plus(new Prisma.Decimal(fund.feeAmount || 0)),
        new Prisma.Decimal(0),
      );
      const amount = new Prisma.Decimal(item.amount || 0);
      const nextNetAmount = amount.minus(totalFee);

      const updated = await (client as any).internalTransaction.update({
        where: { id: internalTransactionId },
        data: {
          status: next,
          feeAmount: totalFee,
          netAmount: nextNetAmount,
          statusHistory: this.appendStatusHistory(
            item.statusHistory,
            next,
            operatorId,
            `Aggregated from internal funds`,
          ),
          completedAt: InternalTransferService.TERMINAL_STATUSES.has(next)
            ? new Date()
            : null,
        },
        include: {
          asset: true,
          fromWallet: {
            select: {
              id: true,
              ownerType: true,
            },
          },
          toWallet: {
            select: {
              id: true,
              ownerType: true,
            },
          },
        },
      });

      await this.auditLogsService.recordByActor(
        {
          action: buildStateTransitionAction('INTERNAL_TRANSFER', current, next),
          entityType: AuditEntityTypes.INTERNAL_TRANSFER,
          entityId: updated.id,
          entityNo: updated.internalTxNo,
          entityOwnerType: updated.ownerType,
          entityOwnerId: updated.ownerId,
          workflowType: 'INTERNAL_TRANSFER',
          traceId: updated.traceId ?? undefined,
          reason: 'Aggregated from internal funds',
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

    if (tx) return execute(tx);
    return (this.prisma as any).$transaction((client: TxClient) =>
      execute(client),
    );
  }

  async findAllForAdmin(query: InternalTransferQueryDto) {
    const {
      skip = 0,
      take = 20,
      status,
      pathLabel,
      sourceNo,
      ownerNo,
      assetId,
      internalTxNo,
      startDate,
      endDate,
    } = query;

    const where: any = {};
    if (status) where.status = status;
    if (pathLabel) where.pathLabel = pathLabel;
    if (sourceNo) where.sourceNo = { contains: sourceNo };
    if (ownerNo) where.ownerNo = { contains: ownerNo };
    if (assetId) where.assetId = assetId;
    if (internalTxNo) where.internalTxNo = { contains: internalTxNo };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).internalTransaction.findMany({
        where,
        skip: Number(skip),
        take: Number(take),
        orderBy: { createdAt: 'desc' },
        include: {
          asset: true,
          fromWallet: true,
          toWallet: true,
          funds: {
            select: {
              id: true,
              status: true,
              internalFundNo: true,
            },
          },
        },
      }),
      (this.prisma as any).internalTransaction.count({ where }),
    ]);

    return { items, total };
  }

  async findOneForAdmin(id: string) {
    const item = await (this.prisma as any).internalTransaction.findUnique({
      where: { id },
      include: {
        asset: true,
        fromWallet: true,
        toWallet: true,
        funds: {
          include: {
            asset: true,
            fromWallet: true,
            toWallet: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!item) {
      throw new NotFoundException('Internal transfer not found');
    }
    return item;
  }

  async findOneByNoForAdmin(internalTxNo: string) {
    // V7 funds-layer writes audits via the central AuditLogsService
    // (audit_log_events store), keyed by traceId — NOT the legacy
    // InternalTransactionAuditLog relation. Operators look up the journey
    // in the Audit Center by traceId, so we no longer embed that relation.
    const item = await (this.prisma as any).internalTransaction.findUnique({
      where: { internalTxNo },
      include: {
        asset: true,
        fromWallet: true,
        toWallet: true,
        funds: {
          include: {
            asset: true,
            fromWallet: true,
            toWallet: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!item) {
      throw new NotFoundException('Internal transfer not found');
    }
    return item;
  }

  /**
   * Find the internal transfer order(s) originated by a given source event,
   * each with its fund legs. A DEPOSIT/WITHDRAW source maps to a single order;
   * a SWAP source may map to multiple (e.g. settlement + fee transfers).
   * Returns [] when the source produced no internal transfer.
   */
  async findFundsOrderBySource(
    sourceType: 'DEPOSIT' | 'WITHDRAW' | 'SWAP',
    sourceId: string,
  ) {
    const orders = await (this.prisma as any).internalTransaction.findMany({
      where: { sourceType, sourceId },
      orderBy: { createdAt: 'asc' },
      include: {
        funds: {
          orderBy: { createdAt: 'asc' },
          select: {
            internalFundNo: true,
            status: true,
            txHash: true,
            confirmations: true,
            blockNo: true,
            nonce: true,
            gasUsed: true,
            effectiveGasPrice: true,
            sentAt: true,
            confirmedAt: true,
          },
        },
      },
    });

    return (orders ?? []).map((order: any) => ({
      id: order.id,
      internalTxNo: order.internalTxNo,
      type: order.type,
      status: order.status,
      legs: order.funds ?? [],
    }));
  }
}
