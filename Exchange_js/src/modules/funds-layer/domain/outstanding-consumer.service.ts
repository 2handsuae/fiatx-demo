import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';

type TxClient = Prisma.TransactionClient;

export interface CryptoOutstandingGroup {
  assetId: string;
  assetCode: string | null;
  decimals: number;
  inAmount: Prisma.Decimal;
  outAmount: Prisma.Decimal;
  net: Prisma.Decimal;
  outstandingIds: string[];
}

/**
 * V7 Phase-3 L1 domain service over the `outstandings` table, scoped to the
 * EOD settlement consumer flow (group → lock → link → settle). Owns its data
 * ops; write methods accept an optional `tx`. No business audit, no events.
 */
@Injectable()
export class OutstandingConsumerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * All OPEN crypto outstandings not yet attached to a batch, grouped by asset.
   * net = Σ(IN) − Σ(OUT); positive means net inflow owed into the customer
   * pool, negative means net outflow to be funded from liquidity.
   */
  async findOpenCryptoByAsset(): Promise<CryptoOutstandingGroup[]> {
    const rows = await (this.prisma as any).outstanding.findMany({
      where: {
        status: 'OPEN',
        asset: { type: 'CRYPTO' },
        settlementBatchId: null,
      },
      select: {
        id: true,
        direction: true,
        amount: true,
        assetId: true,
        assetCode: true,
        asset: { select: { currency: true, decimals: true } },
      },
    });

    const groups = new Map<string, CryptoOutstandingGroup>();
    for (const row of rows) {
      let group = groups.get(row.assetId);
      if (!group) {
        group = {
          assetId: row.assetId,
          assetCode: row.assetCode ?? null,
          decimals: row.asset?.decimals ?? 0,
          inAmount: new Prisma.Decimal(0),
          outAmount: new Prisma.Decimal(0),
          net: new Prisma.Decimal(0),
          outstandingIds: [],
        };
        groups.set(row.assetId, group);
      }

      const amount = new Prisma.Decimal(row.amount ?? 0);
      if (row.direction === 'IN') {
        group.inAmount = group.inAmount.plus(amount);
      } else if (row.direction === 'OUT') {
        group.outAmount = group.outAmount.plus(amount);
      }
      group.outstandingIds.push(row.id);
    }

    for (const group of groups.values()) {
      group.net = group.inAmount.minus(group.outAmount);
    }

    return Array.from(groups.values());
  }

  async lockToTransfer(
    outstandingIds: string[],
    settlementBatchId: string,
    settledByTransferId: string,
    tx?: TxClient,
  ): Promise<{ count: number }> {
    const client = (tx ?? this.prisma) as any;
    return client.outstanding.updateMany({
      where: { id: { in: outstandingIds }, status: 'OPEN' },
      data: {
        status: 'LOCKED',
        settlementBatchId,
        settledByTransferId,
        lockedAt: new Date(),
      },
    });
  }

  async lockToBatch(
    outstandingIds: string[],
    settlementBatchId: string,
    tx?: TxClient,
  ): Promise<{ count: number }> {
    const client = (tx ?? this.prisma) as any;
    return client.outstanding.updateMany({
      where: { id: { in: outstandingIds }, status: 'OPEN' },
      data: { status: 'LOCKED', settlementBatchId, lockedAt: new Date() },
    });
  }

  async settle(
    settledByTransferId: string,
    internalFundId: string,
    tx?: TxClient,
  ): Promise<{ count: number }> {
    const client = (tx ?? this.prisma) as any;
    return client.outstanding.updateMany({
      where: { settledByTransferId, status: 'LOCKED' },
      data: {
        status: 'SETTLED',
        closedByInternalFundId: internalFundId,
        closedAt: new Date(),
      },
    });
  }

  async markSettledNettedZero(
    settlementBatchId: string,
    assetId: string,
    tx?: TxClient,
  ): Promise<{ count: number }> {
    const client = (tx ?? this.prisma) as any;
    return client.outstanding.updateMany({
      where: {
        settlementBatchId,
        assetId,
        settledByTransferId: null,
        status: 'LOCKED',
      },
      data: { status: 'SETTLED', closedAt: new Date() },
    });
  }
}
