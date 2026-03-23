import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';

type WalletBalanceSnapshotView = {
  walletId: string;
  availableBalance: Prisma.Decimal;
  restrictedBalance: Prisma.Decimal;
  updatedAt: Date;
};
type TreasuryWalletRow = Prisma.WalletGetPayload<{
  include: {
    asset: {
      select: {
        id: true;
        code: true;
        type: true;
        decimals: true;
      };
    };
  };
}>;
type AssetSummaryRow = {
  id: string;
  code: string;
  type: string;
  decimals: number;
};
@Injectable()
export class TreasuryService {
  constructor(private prisma: PrismaService) {}

  async getCustomerAssets(customerId: string) {
    const wallets = await this.prisma.wallet.findMany({
      where: {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
      },
      include: {
        asset: true,
      },
    });
    const walletIds = wallets.map((wallet) => wallet.id);
    const walletSnapshots = walletIds.length
      ? await this.prisma.walletBalanceSnapshot.findMany({
          where: {
            walletId: { in: walletIds },
          },
          select: {
            walletId: true,
            availableBalance: true,
            restrictedBalance: true,
            updatedAt: true,
          },
        })
      : [];
    const snapshotByWalletId = new Map<string, WalletBalanceSnapshotView>(
      walletSnapshots.map((snapshot: WalletBalanceSnapshotView) => [
        snapshot.walletId,
        snapshot,
      ]),
    );

    const walletByAssetId = new Map<string, TreasuryWalletRow>();
    for (const wallet of wallets) {
      if (!walletByAssetId.has(wallet.assetId)) {
        walletByAssetId.set(wallet.assetId, wallet);
      }
    }

    // Derive customer assets from ledger first, then merge wallet assets.
    // This prevents missing liabilities (e.g. AED after swap) when no wallet exists for that asset.
    const ledgerAggregates = await this.prisma.journalLine.groupBy({
      by: ['assetId', 'accountCode', 'drCr'],
      _sum: { amount: true },
      where: {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        accountCode: { in: ['L.CLIENT_CREDIT', 'L.CLIENT_HELD'] },
      },
    });

    const assetIds = new Set<string>(wallets.map((wallet) => wallet.assetId));
    for (const row of ledgerAggregates) {
      if (row.assetId) {
        assetIds.add(row.assetId);
      }
    }

    if (!assetIds.size) {
      return [];
    }

    const assets = await this.prisma.asset.findMany({
      where: { id: { in: Array.from(assetIds) } },
      select: { id: true, code: true, type: true, decimals: true },
    });
    const assetById = new Map<string, AssetSummaryRow>(
      assets.map((asset) => [asset.id, asset]),
    );

    const sumMap = new Map<string, number>();
    for (const row of ledgerAggregates) {
      const key = `${row.assetId}::${row.accountCode}::${row.drCr}`;
      const amount = row?._sum?.amount ? Number(row._sum.amount) : 0;
      sumMap.set(key, amount);
    }

    const result = Array.from(assetIds)
      .map((assetId) => {
        const asset = assetById.get(assetId);
        if (!asset) return null;

        const wallet = walletByAssetId.get(assetId) || null;
        const snapshot =
          wallet && typeof wallet.id === 'string'
            ? snapshotByWalletId.get(wallet.id) || null
            : null;
        const creditCr = sumMap.get(`${assetId}::L.CLIENT_CREDIT::CR`) || 0;
        const creditDr = sumMap.get(`${assetId}::L.CLIENT_CREDIT::DR`) || 0;
        const heldCr = sumMap.get(`${assetId}::L.CLIENT_HELD::CR`) || 0;
        const heldDr = sumMap.get(`${assetId}::L.CLIENT_HELD::DR`) || 0;
        const walletBalance =
          snapshot &&
          snapshot.availableBalance !== undefined &&
          snapshot.restrictedBalance !== undefined
            ? Number(snapshot.availableBalance) +
              Number(snapshot.restrictedBalance)
            : wallet
              ? 0
              : null;

        return {
          assetId,
          assetCode: asset.code,
          assetType: asset.type,
          assetDecimals: asset.decimals,
          clientCredit: creditCr - creditDr,
          lockedBalance: heldCr - heldDr,
          walletId: wallet?.id || null,
          walletBalance,
          walletBalanceSource: wallet
            ? snapshot
              ? 'SNAPSHOT'
              : 'SNAPSHOT_MISSING'
            : null,
          walletBalanceUpdatedAt: snapshot?.updatedAt ?? null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => a.assetCode.localeCompare(b.assetCode));

    return result;
  }
}
