import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';

/**
 * V7 funds-layer read/write surface over the deposit_transactions table for the
 * deposit-aggregation sweep.
 *
 * Lives in funds-layer (not deposit-transactions) so that FundsLayerModule no
 * longer needs to import DepositTransactionsModule — that import created a
 * module-level cycle (FundsLayer → Deposit → … → Withdraw → FundsLayer). Like
 * OutstandingConsumerService operating on the Outstanding table, this service
 * reads/writes the shared table directly via PrismaService.
 */
@Injectable()
export class DepositAggregationSourceService {
  constructor(private readonly prisma: PrismaService) {}

  async findAggregationCandidates(): Promise<
    Array<{
      toWalletId: string;
      assetId: string;
      ownerId: string;
      ownerType: string;
      depositIds: string[];
      anchorDepositId: string;
      totalAmount: Prisma.Decimal;
    }>
  > {
    const rows = await (this.prisma as any).depositTransaction.findMany({
      where: {
        status: 'SUCCESS',
        aggregatedAt: null,
        toWalletId: { not: null },
        asset: { type: 'CRYPTO' },
      },
      select: {
        id: true,
        toWalletId: true,
        assetId: true,
        ownerId: true,
        ownerType: true,
        amount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const groups = new Map<
      string,
      {
        toWalletId: string;
        assetId: string;
        ownerId: string;
        ownerType: string;
        depositIds: string[];
        anchorDepositId: string;
        totalAmount: Prisma.Decimal;
      }
    >();

    for (const row of rows) {
      const existing = groups.get(row.toWalletId);
      if (!existing) {
        groups.set(row.toWalletId, {
          toWalletId: row.toWalletId,
          assetId: row.assetId,
          ownerId: row.ownerId,
          ownerType: row.ownerType,
          depositIds: [row.id],
          anchorDepositId: row.id,
          totalAmount: new Prisma.Decimal(row.amount),
        });
      } else {
        existing.depositIds.push(row.id);
        existing.totalAmount = existing.totalAmount.plus(row.amount);
      }
    }

    return Array.from(groups.values());
  }

  async markAggregated(
    depositIds: string[],
    transferId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }> {
    const db = tx ?? this.prisma;
    return (db as any).depositTransaction.updateMany({
      where: {
        id: { in: depositIds },
        aggregatedAt: null,
      },
      data: {
        aggregatedAt: new Date(),
        aggregatedTransferId: transferId,
      },
    });
  }
}
