import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

type TxClient = Prisma.TransactionClient;

export interface CreateBatchInput {
  cutoffAt: Date;
  requestId?: string;
  settlementType?: string;
}

export interface SettlementBatchAdminQuery {
  skip?: number;
  take?: number;
  status?: string;
  settlementType?: string;
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

  constructor(private readonly prisma: PrismaService) {}

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
              settlementType: input.settlementType ?? 'EOD',
              status: 'CREATED',
              cutoffAt: input.cutoffAt,
              requestId: input.requestId ?? null,
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

    if (tx) return execute(tx);
    return (this.prisma as any).$transaction((client: TxClient) =>
      execute(client),
    );
  }

  async recomputeBatch(settlementBatchId: string, tx?: TxClient) {
    const execute = async (client: TxClient) => {
      const transfers = await (client as any).internalTransaction.findMany({
        where: { settlementBatchId },
        select: { status: true, assetId: true },
      });
      const outstandings = await (client as any).outstanding.findMany({
        where: { settlementBatchId },
        select: { status: true, assetId: true, settledByTransferId: true },
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

      // Fee-collection batches have no outstandings → the outstanding-count
      // equality is vacuously true; completion then gates purely on transfers.
      // An empty batch (no transfers, no outstandings) → totalAssetCount 0 → PROCESSING.
      const allDone =
        totalAssetCount > 0 &&
        settledAssetCount === totalAssetCount &&
        settledOutstandingCount === totalOutstandingCount;
      const status = allDone ? 'SUCCESS' : 'PROCESSING';

      return (client as any).settlementBatch.update({
        where: { id: settlementBatchId },
        data: {
          status,
          totalAssetCount,
          settledAssetCount,
          totalOutstandingCount,
          settledOutstandingCount,
          completedAt: allDone ? new Date() : null,
        },
      });
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
