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

export interface CreateItemInput {
  settlementBatchId: string;
  assetId: string;
  assetCode?: string | null;
  inAmount: Prisma.Decimal;
  outAmount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  direction?: string | null;
  outstandingCount: number;
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
  path: 'INTERNAL_IN' | 'INTERNAL_OUT';
  fromRole: string;
  toRole: string;
  amount: Prisma.Decimal;
}

/**
 * V7 Phase-3 L1 domain service over the `settlement_batches` /
 * `settlement_batch_items` tables. Owns the data ops for EOD settlement
 * batches; write methods accept an optional `tx`. No business/journey audit
 * and no event subscription (that belongs to the L3 workflow in Task 3.3).
 */
@Injectable()
export class SettlementBatchService {
  private static readonly MAX_NO_GENERATION_RETRIES = 10;
  // Items whose work is finished: NETTED (net=0, no transfer) or CLOSED
  // (transfer succeeded + outstandings settled).
  private static readonly TERMINAL_ITEM_STATUSES = new Set(['NETTED', 'CLOSED']);

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

  async createItem(input: CreateItemInput, tx?: TxClient) {
    const client = (tx ?? this.prisma) as any;
    const status = input.netAmount.eq(0) ? 'NETTED' : 'PROCESSING';
    return client.settlementBatchItem.create({
      data: {
        settlementBatchId: input.settlementBatchId,
        assetId: input.assetId,
        assetCode: input.assetCode ?? null,
        inAmount: input.inAmount,
        outAmount: input.outAmount,
        netAmount: input.netAmount,
        direction: input.direction ?? null,
        status,
        outstandingCount: input.outstandingCount,
      },
    });
  }

  async linkItemTransfer(
    itemId: string,
    internalTransactionId: string,
    tx?: TxClient,
  ) {
    const client = (tx ?? this.prisma) as any;
    return client.settlementBatchItem.update({
      where: { id: itemId },
      data: { internalTransactionId },
    });
  }

  /**
   * Marks an item terminal after its transfer cleared and its outstandings were
   * settled: status=CLOSED (terminal — see TERMINAL_ITEM_STATUSES) +
   * settledOutstandingCount + closedAt.
   */
  async closeItem(itemId: string, settledCount: number, tx?: TxClient) {
    const client = (tx ?? this.prisma) as any;
    return client.settlementBatchItem.update({
      where: { id: itemId },
      data: {
        status: 'CLOSED',
        settledOutstandingCount: settledCount,
        closedAt: new Date(),
      },
    });
  }

  async recomputeBatch(settlementBatchId: string, tx?: TxClient) {
    const execute = async (client: TxClient) => {
      const items = await (client as any).settlementBatchItem.findMany({
        where: { settlementBatchId },
        select: {
          status: true,
          outstandingCount: true,
          settledOutstandingCount: true,
        },
      });

      const totalAssetCount = items.length;
      const settledAssetCount = items.filter((item: any) =>
        SettlementBatchService.TERMINAL_ITEM_STATUSES.has(item.status),
      ).length;
      const totalOutstandingCount = items.reduce(
        (sum: number, item: any) => sum + (item.outstandingCount ?? 0),
        0,
      );
      const settledOutstandingCount = items.reduce(
        (sum: number, item: any) => sum + (item.settledOutstandingCount ?? 0),
        0,
      );

      const allTerminal =
        totalAssetCount > 0 && settledAssetCount === totalAssetCount;
      const status = allTerminal ? 'SUCCESS' : 'PROCESSING';

      return (client as any).settlementBatch.update({
        where: { id: settlementBatchId },
        data: {
          status,
          totalAssetCount,
          settledAssetCount,
          totalOutstandingCount,
          settledOutstandingCount,
          completedAt: allTerminal ? new Date() : null,
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
        path: 'INTERNAL_IN',
        fromRole: 'F_LIQ',
        toRole: 'C_MAIN',
        amount: net,
      };
    }
    return {
      path: 'INTERNAL_OUT',
      fromRole: 'C_MAIN',
      toRole: 'F_LIQ',
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
        items: {
          include: {
            asset: true,
            internalTransaction: true,
          },
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
