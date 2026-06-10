import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { CreateTbAccountParams } from '../../accounting/tigerbeetle/types/accounting.types';
import { Prisma } from '@prisma/client';

@Injectable()
export class AssetProvisioningService {
  private readonly logger = new Logger(AssetProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountingService: AccountingService,
  ) {}

  async provision(assetId: string, tx?: Prisma.TransactionClient): Promise<{ tbLedgerId: number }> {
    const client = tx ?? this.prisma;

    const asset = await client.asset.findUniqueOrThrow({ where: { id: assetId } });

    const maxResult = await client.asset.aggregate({ _max: { tbLedgerId: true } });
    const tbLedgerId = (maxResult._max.tbLedgerId ?? 0) + 1;

    // Reserve the ledger ID in DB — the unique constraint prevents duplicates
    await client.asset.update({
      where: { id: assetId },
      data: { tbLedgerId },
    });

    const poolCode = asset.type === 'FIAT' ? TB_ACCOUNT_CODES.CLIENT_BANK : TB_ACCOUNT_CODES.CLIENT_CUSTODY;

    const firmBookCodes: Array<{ code: number; desc: string }> = [
      { code: TB_ACCOUNT_CODES.FIRM_OPS, desc: 'FIRM_OPS' },
      { code: TB_ACCOUNT_CODES.FX_POSITION, desc: 'FX_POSITION' },
      { code: TB_ACCOUNT_CODES.PAID_IN_CAPITAL, desc: 'PAID_IN_CAPITAL' },
      { code: TB_ACCOUNT_CODES.RETAINED_EARNINGS, desc: 'RETAINED_EARNINGS' },
      { code: TB_ACCOUNT_CODES.FEE_INCOME, desc: 'FEE_INCOME' },
      { code: TB_ACCOUNT_CODES.SPREAD_INCOME, desc: 'SPREAD_INCOME' },
      { code: TB_ACCOUNT_CODES.FX_UNREALIZED_PNL, desc: 'FX_UNREALIZED_PNL' },
      { code: TB_ACCOUNT_CODES.FX_REALIZED_PNL, desc: 'FX_REALIZED_PNL' },
    ];

    const accountParams: CreateTbAccountParams[] = [
      {
        code: poolCode,
        ledger: tbLedgerId,
        ownerType: 'SYSTEM',
        assetCurrency: asset.currency,
        description: `${asset.type === 'FIAT' ? 'CLIENT_BANK' : 'CLIENT_CUSTODY'} for ${asset.currency}`,
      },
      {
        code: TB_ACCOUNT_CODES.TRADE_CLEARING,
        ledger: tbLedgerId,
        ownerType: 'SYSTEM',
        assetCurrency: asset.currency,
        description: `TRADE_CLEARING for ${asset.currency}`,
      },
      ...firmBookCodes.map(({ code, desc }) => ({
        code,
        ledger: tbLedgerId,
        ownerType: 'SYSTEM' as const,
        assetCurrency: asset.currency,
        description: `${desc} for ${asset.currency}`,
      })),
    ];

    await this.accountingService.createAccounts(accountParams, tx);

    this.logger.log(`Asset ${asset.assetNo} provisioned with tbLedgerId=${tbLedgerId}, ${accountParams.length} TB accounts created`);
    return { tbLedgerId };
  }
}
