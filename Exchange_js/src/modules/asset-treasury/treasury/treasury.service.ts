import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class TreasuryService {
  constructor(private prisma: PrismaService) {}

  async getCustomerAssets(customerId: string) {
    // Fetch all unique assets for which the customer has wallets
    const wallets = await (this.prisma as any).wallet.findMany({
      where: {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
      },
      include: {
        asset: true,
      },
    });

    // Group wallets by assetId to avoid duplicates in the final output
    const uniqueAssetIds = [...new Set(wallets.map((w: any) => w.assetId as string))];
    
    // Calculate real-time balance from Journal Lines for each unique asset
    const assetsWithBalance = await Promise.all(
      uniqueAssetIds.map(async (assetId) => {
        const wallet = wallets.find((w: any) => w.assetId === assetId);
        
        const aggregate = await (this.prisma as any).journalLine.aggregate({
          _sum: {
            amount: true,
          },
          where: {
            accountCode: 'L.CLIENT_CREDIT', // The liability account representing user balance
            ownerType: 'CUSTOMER',
            ownerId: customerId,
            assetId: assetId,
            drCr: 'CR', // Credit increases liability (user balance)
          },
        });

        const debitAggregate = await (this.prisma as any).journalLine.aggregate(
          {
            _sum: {
              amount: true,
            },
            where: {
              accountCode: 'L.CLIENT_CREDIT',
              ownerType: 'CUSTOMER',
              ownerId: customerId,
              assetId: assetId,
              drCr: 'DR', // Debit decreases liability
            },
          },
        );

        const totalCr = aggregate._sum.amount
          ? Number(aggregate._sum.amount)
          : 0;
        const totalDr = debitAggregate._sum.amount
          ? Number(debitAggregate._sum.amount)
          : 0;
        const realBalance = totalCr - totalDr;

        // Calculate locked balance from Journal Lines (account: L.CLIENT_HELD)
        const lockedCrAggregate = await (
          this.prisma as any
        ).journalLine.aggregate({
          _sum: { amount: true },
          where: {
            accountCode: 'L.CLIENT_HELD',
            ownerType: 'CUSTOMER',
            ownerId: customerId,
            assetId: assetId,
            drCr: 'CR', // Credit increases liability (locked balance)
          },
        });

        const lockedDrAggregate = await (
          this.prisma as any
        ).journalLine.aggregate({
          _sum: { amount: true },
          where: {
            accountCode: 'L.CLIENT_HELD',
            ownerType: 'CUSTOMER',
            ownerId: customerId,
            assetId: assetId,
            drCr: 'DR', // Debit decreases locked balance
          },
        });

        const lockedTotalCr = lockedCrAggregate._sum.amount
          ? Number(lockedCrAggregate._sum.amount)
          : 0;
        const lockedTotalDr = lockedDrAggregate._sum.amount
          ? Number(lockedDrAggregate._sum.amount)
          : 0;
        const realLockedBalance = lockedTotalCr - lockedTotalDr;

        return {
          assetId: assetId,
          assetCode: wallet.asset.code,
          assetType: wallet.asset.type,
          clientCredit: realBalance, // Use real-time ledger balance
          lockedBalance: realLockedBalance, // Now using ledger balance too!
          walletId: wallet.id, // Reference one of the wallets for this asset
          walletBalance: wallet.balance,
        };
      }),
    );

    return assetsWithBalance;
  }
}
