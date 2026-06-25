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

    // 系统账户:聚合资产 + 公司权益账户。法币额外 FIRM_SET。
    const isFiat = asset.type === 'FIAT';
    const systemCodes: Array<{ code: number; desc: string }> = [
      { code: TB_ACCOUNT_CODES.CLIENT_ASSET, desc: 'CLIENT_ASSET' },
      { code: TB_ACCOUNT_CODES.FIRM_ASSET, desc: 'FIRM_ASSET' },
      { code: TB_ACCOUNT_CODES.FIRM_OPS, desc: 'FIRM_OPS' },
      { code: TB_ACCOUNT_CODES.FIRM_FEE, desc: 'FIRM_FEE' },
      { code: TB_ACCOUNT_CODES.FIRM_LIQ, desc: 'FIRM_LIQ' },
      ...(isFiat ? [{ code: TB_ACCOUNT_CODES.FIRM_SET, desc: 'FIRM_SET' }] : []),
    ];

    const accountParams: CreateTbAccountParams[] = systemCodes.map(({ code, desc }) => ({
      code,
      ledger: tbLedgerId,
      ownerType: 'SYSTEM' as const,
      assetCurrency: asset.currency,
      description: `${desc} for ${asset.currency}`,
    }));

    await this.accountingService.createAccounts(accountParams, tx);
    this.logger.log(`Asset ${asset.assetNo} provisioned tbLedgerId=${tbLedgerId}, ${accountParams.length} system TB accounts`);
    return { tbLedgerId };
  }
}
