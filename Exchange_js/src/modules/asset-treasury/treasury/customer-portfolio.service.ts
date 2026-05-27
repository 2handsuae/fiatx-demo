import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';

export interface CustomerPortfolioItem {
  assetId: string;
  assetCode: string;
  assetType: string;
  currency: string;
  available: string;
  locked: string;
  decimals: number;
}

@Injectable()
export class CustomerPortfolioService {
  private readonly logger = new Logger(CustomerPortfolioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountingService: AccountingService,
  ) {}

  async getPortfolioBalances(customerUuid: string): Promise<CustomerPortfolioItem[]> {
    const assets = await this.prisma.asset.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });

    const results: CustomerPortfolioItem[] = [];

    for (const asset of assets) {
      let available = '0';
      let locked = '0';

      try {
        const balance = await this.accountingService.getCustomerAvailableBalance(
          customerUuid,
          asset.currency,
        );
        available = this.bigintToDecimal(balance.available, asset.decimals);
        locked = this.bigintToDecimal(balance.held, asset.decimals);
      } catch (err) {
        // Customer may not have a TB account for this asset yet (no deposits).
        // Return zero balance — not an error.
        this.logger.debug(
          `No TB balance for customer=${customerUuid} currency=${asset.currency}: ${String(err)}`,
        );
      }

      results.push({
        assetId: asset.id,
        assetCode: asset.code,
        assetType: asset.type,
        currency: asset.currency,
        available,
        locked,
        decimals: asset.decimals,
      });
    }

    return results;
  }

  private bigintToDecimal(value: bigint, decimals: number): string {
    const isNegative = value < 0n;
    const abs = isNegative ? -value : value;
    const str = abs.toString().padStart(decimals + 1, '0');
    const intPart = str.slice(0, str.length - decimals) || '0';
    const fracPart = decimals > 0 ? '.' + str.slice(str.length - decimals) : '';
    return (isNegative ? '-' : '') + intPart + fracPart;
  }
}
