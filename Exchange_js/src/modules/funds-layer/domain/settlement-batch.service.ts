import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { SettlementType } from '../constants/settlement-type.constant';

type TxClient = Prisma.TransactionClient;

export interface CreateBatchInput {
  cutoffAt: Date;
  requestId?: string;
  settlementType?: SettlementType;
  category?: string;
}

export interface SettlementBatchAdminQuery {
  skip?: number;
  take?: number;
  status?: string;
  settlementType?: SettlementType;
  batchNo?: string;
  startDate?: string;
  endDate?: string;
}

export interface CryptoDirection {
  path: 'CRYPTO_SETTLE_IN' | 'CRYPTO_SETTLE_OUT';
  fromRole: string;
  toRole: string;
  amount: Prisma.Decimal;
}

/**
 * V7 Phase-3 L1 domain service over the `settlement_batches` table.
 * Owns the data ops for EOD settlement
 * batches; write methods accept an optional `tx`. No business/journey audit
 * and no event subscription (that belongs to the L3 workflow in Task 3.3).
 */
@Injectable()
export class SettlementBatchService {
  private static readonly MAX_NO_GENERATION_RETRIES = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private isBatchNoUniqueConflict(error: unknown): boolean {
    const maybe = error as {
      code?: string;
      meta?: { target?: string[] | string };
    };
    if (maybe?.code !== 'P2002') return false;
    const target = maybe.meta?.target;
    if (Array.isArray(target)) return target.includes('batchNo');
    if (typeof target === 'string') return target.includes('batchNo');
    return false;
  }

  async createBatch(input: CreateBatchInput, tx?: TxClient) {
    const execute = async (client: TxClient) => {
      for (
        let attempt = 1;
        attempt <= SettlementBatchService.MAX_NO_GENERATION_RETRIES;
        attempt += 1
      ) {
        const batchNo = generateReferenceNo('OSB');
        try {
          return await (client as any).settlementBatch.create({
            data: {
              batchNo,
              settlementType: input.settlementType ?? 'CRYPTO_PRINCIPAL',
              category: input.category ?? 'PRINCIPAL',
              status: 'CREATED',
              cutoffAt: input.cutoffAt,
              requestId: input.requestId ?? null,
              traceId: randomUUID(),
            },
          });
        } catch (error) {
          if (this.isBatchNoUniqueConflict(error)) {
            continue;
          }
          throw error;
        }
      }
      throw new InternalServerErrorException(
        `Failed to generate unique batchNo after ${SettlementBatchService.MAX_NO_GENERATION_RETRIES} attempts`,
      );
    };

    const batch = tx
      ? await execute(tx)
      : await (this.prisma as any).$transaction((client: TxClient) =>
          execute(client),
        );

    await this.auditLogsService.recordSystem({
      action: AuditActions.BATCH_CREATED,
      entityType: AuditEntityTypes.SETTLEMENT_BATCH,
      entityId: batch.id,
      entityNo: batch.batchNo,
      workflowType: AuditWorkflowTypes.SETTLEMENT,
      reason: `Batch created: ${batch.category}/${batch.settlementType}`,
      sourcePlatform: 'SYSTEM',
      traceId: batch.traceId,
    });

    return batch;
  }

  async recomputeBatch(settlementBatchId: string, tx?: TxClient) {
    const execute = async (client: TxClient) => {
      // Read prior status to dedup the BATCH_SUCCEEDED audit on re-runs.
      const existing = await (client as any).settlementBatch.findUnique({
        where: { id: settlementBatchId },
        select: { status: true, traceId: true, batchNo: true },
      });
      const wasSuccess = existing?.status === 'SUCCESS';

      const transfers = await (client as any).internalTransaction.findMany({
        where: { settlementBatchId },
        select: { status: true, assetId: true },
      });
      const outstandings = await (client as any).outstanding.findMany({
        where: { settlementBatchId },
        select: { status: true, assetId: true, settledByTransferId: true },
      });
      const feeAccruals = await (client as any).feeAccrual.findMany({
        where: { settlementBatchId },
        select: { status: true },
      });

      const nettedZeroAssets = new Set<string>(
        outstandings
          .filter((o: any) => !o.settledByTransferId)
          .map((o: any) => o.assetId),
      );
      const transferAssets = new Set<string>(
        transfers.map((t: any) => t.assetId),
      );

      const totalAssetCount = transferAssets.size + nettedZeroAssets.size;
      const settledTransferAssets = transfers.filter(
        (t: any) => t.status === 'SUCCESS',
      ).length;
      const settledAssetCount = settledTransferAssets + nettedZeroAssets.size;

      const totalOutstandingCount = outstandings.length;
      const settledOutstandingCount = outstandings.filter(
        (o: any) => o.status === 'SETTLED',
      ).length;

      // FEE batches carry fee accruals (no outstandings); PRINCIPAL batches
      // carry outstandings (no accruals). Both must close their own ledger
      // for the batch to be SUCCESS — symmetric with body/fee two-rail design.
      const totalFeeAccrualCount = feeAccruals.length;
      const settledFeeAccrualCount = feeAccruals.filter(
        (f: any) => f.status === 'SETTLED',
      ).length;

      const allDone =
        totalAssetCount > 0 &&
        settledAssetCount === totalAssetCount &&
        settledOutstandingCount === totalOutstandingCount &&
        settledFeeAccrualCount === totalFeeAccrualCount;
      const status = allDone ? 'SUCCESS' : 'PROCESSING';

      const result = await (client as any).settlementBatch.update({
        where: { id: settlementBatchId },
        data: {
          status,
          totalAssetCount,
          settledAssetCount,
          totalOutstandingCount,
          settledOutstandingCount,
          totalFeeAccrualCount,
          settledFeeAccrualCount,
          completedAt: allDone ? new Date() : null,
        },
      });

      // Emit audit inside execute (so it shares the caller's tx if any) —
      // recomputeBatch is often invoked from a parent workflow's $transaction;
      // keeping it inline keeps tx semantics consistent and dedup is via wasSuccess.
      if (allDone && !wasSuccess) {
        await this.auditLogsService.recordSystem({
          action: AuditActions.BATCH_SUCCEEDED,
          entityType: AuditEntityTypes.SETTLEMENT_BATCH,
          entityId: settlementBatchId,
          entityNo: existing?.batchNo,
          workflowType: AuditWorkflowTypes.SETTLEMENT,
          reason: `Batch reached SUCCESS via recompute (${totalOutstandingCount} outstanding + ${totalFeeAccrualCount} fee accruals)`,
          sourcePlatform: 'SYSTEM',
          traceId: existing?.traceId,
        });
      }

      return result;
    };

    if (tx) return execute(tx);
    return (this.prisma as any).$transaction((client: TxClient) =>
      execute(client),
    );
  }

  resolveCryptoDirection(net: Prisma.Decimal): CryptoDirection | null {
    if (net.eq(0)) return null;
    if (net.gt(0)) {
      return {
        path: 'CRYPTO_SETTLE_IN',
        fromRole: 'F_OPS',
        toRole: 'C_MAIN',
        amount: net,
      };
    }
    return {
      path: 'CRYPTO_SETTLE_OUT',
      fromRole: 'C_MAIN',
      toRole: 'F_OPS',
      amount: net.abs(),
    };
  }

  async findForAdmin(query: SettlementBatchAdminQuery) {
    const {
      skip = 0,
      take = 20,
      status,
      settlementType,
      batchNo,
      startDate,
      endDate,
    } = query;

    const where: any = {};
    if (status) where.status = status;
    if (settlementType) where.settlementType = settlementType;
    if (batchNo) where.batchNo = { contains: batchNo };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).settlementBatch.findMany({
        where,
        skip: Number(skip),
        take: Number(take),
        orderBy: { createdAt: 'desc' },
      }),
      (this.prisma as any).settlementBatch.count({ where }),
    ]);

    return { items, total };
  }

  async findOneByNoForAdmin(batchNo: string) {
    const item = await (this.prisma as any).settlementBatch.findUnique({
      where: { batchNo },
      include: {
        transfers: {
          include: { asset: true, funds: { select: { id: true, internalFundNo: true, status: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!item) {
      throw new NotFoundException('Settlement batch not found');
    }
    return item;
  }
}
