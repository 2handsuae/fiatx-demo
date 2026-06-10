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

    const custodyCode = asset.type === 'FIAT' ? TB_ACCOUNT_CODES.CLIENT_BANK : TB_ACCOUNT_CODES.CLIENT_CUSTODY;

    const accountParams: CreateTbAccountParams[] = [
      {
        code: custodyCode,
        ledger: tbLedgerId,
        ownerType: 'SYSTEM',
        assetCurrency: asset.currency,
        description: `${asset.type === 'FIAT' ? 'BANK' : 'CUSTODY'} for ${asset.currency}`,
      },
      {
        code: TB_ACCOUNT_CODES.TRADE_CLEARING,
        ledger: tbLedgerId,
        ownerType: 'SYSTEM',
        assetCurrency: asset.currency,
        description: `TRADE_CLEARING for ${asset.currency}`,
      },
      {
        code: TB_ACCOUNT_CODES.FEE_RECEIVABLE,
        ledger: tbLedgerId,
        ownerType: 'SYSTEM',
        assetCurrency: asset.currency,
        description: `FEE_RECEIVABLE for ${asset.currency}`,
      },
    ];

    await this.accountingService.createAccounts(accountParams, tx);

    this.logger.log(`Asset ${asset.assetNo} provisioned with tbLedgerId=${tbLedgerId}, 3 TB accounts created`);
    return { tbLedgerId };
  }
}
