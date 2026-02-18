import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class TreasuryService {
  constructor(private prisma: PrismaService) {}

  async getCustomerAssets(customerId: string) {
    const wallets = await (this.prisma as any).wallet.findMany({
      where: {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
      },
      include: {
        asset: true,
      },
    });

    const walletByAssetId = new Map<string, any>();
    for (const wallet of wallets) {
      if (!walletByAssetId.has(wallet.assetId)) {
        walletByAssetId.set(wallet.assetId, wallet);
      }
    }

    // Derive customer assets from ledger first, then merge wallet assets.
    // This prevents missing liabilities (e.g. AED after swap) when no wallet exists for that asset.
    const ledgerAggregates = await (this.prisma as any).journalLine.groupBy({
      by: ['assetId', 'accountCode', 'drCr'],
      _sum: { amount: true },
      where: {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        accountCode: { in: ['L.CLIENT_CREDIT', 'L.CLIENT_HELD'] },
      },
    });

    const assetIds = new Set<string>(wallets.map((wallet: any) => wallet.assetId));
    for (const row of ledgerAggregates) {
      if (row.assetId) {
        assetIds.add(row.assetId);
      }
    }

    if (!assetIds.size) {
      return [];
    }

    const assets = await (this.prisma as any).asset.findMany({
      where: { id: { in: Array.from(assetIds) } },
      select: { id: true, code: true, type: true, decimals: true },
    });
    const assetById = new Map<
      string,
      { id: string; code: string; type: string; decimals: number }
    >(
      assets.map(
        (asset: { id: string; code: string; type: string; decimals: number }) => [
          asset.id,
          asset,
        ],
      ),
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
        const creditCr = sumMap.get(`${assetId}::L.CLIENT_CREDIT::CR`) || 0;
        const creditDr = sumMap.get(`${assetId}::L.CLIENT_CREDIT::DR`) || 0;
        const heldCr = sumMap.get(`${assetId}::L.CLIENT_HELD::CR`) || 0;
        const heldDr = sumMap.get(`${assetId}::L.CLIENT_HELD::DR`) || 0;

        return {
          assetId,
          assetCode: asset.code,
          assetType: asset.type,
          assetDecimals: asset.decimals,
          clientCredit: creditCr - creditDr,
          lockedBalance: heldCr - heldDr,
          walletId: wallet?.id || null,
          walletBalance: wallet?.balance ?? null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => a.assetCode.localeCompare(b.assetCode));

    return result;
  }
}
