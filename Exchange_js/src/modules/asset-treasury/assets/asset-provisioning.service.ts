import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { CreateTbAccountParams } from '../../accounting/tigerbeetle/types/accounting.types';

@Injectable()
export class AssetProvisioningService {
  private readonly logger = new Logger(AssetProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountingService: AccountingService,
  ) {}

  async provision(assetId: string, tx?: Prisma.TransactionClient): Promise<{ tbLedgerId: number }> {
    const client = tx || this.prisma;

    const asset = await (client as any).asset.findUniqueOrThrow({ where: { id: assetId } });

    if (asset.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException({
        code: 'INVALID_ASSET_STATUS',
        message: `Asset ${asset.assetNo} is not in PENDING_APPROVAL status`,
      });
    }

    const maxResult = await (client as any).asset.aggregate({ _max: { tbLedgerId: true } });
    const tbLedgerId = (maxResult._max.tbLedgerId ?? 0) + 1;

    const custodyCode = asset.type === 'FIAT' ? TB_ACCOUNT_CODES.BANK : TB_ACCOUNT_CODES.CUSTODY;

    const accountParams: CreateTbAccountParams[] = [
      {
        code: custodyCode,
        ledger: tbLedgerId,
        ownerType: 'SYSTEM',
        assetCode: asset.code,
        description: `${asset.type === 'FIAT' ? 'BANK' : 'CUSTODY'} for ${asset.code}`,
      },
      {
        code: TB_ACCOUNT_CODES.TRADE_CLEARING,
        ledger: tbLedgerId,
        ownerType: 'SYSTEM',
        assetCode: asset.code,
        description: `TRADE_CLEARING for ${asset.code}`,
      },
      {
        code: TB_ACCOUNT_CODES.FEE_RECEIVABLE,
        ledger: tbLedgerId,
        ownerType: 'SYSTEM',
        assetCode: asset.code,
        description: `FEE_RECEIVABLE for ${asset.code}`,
        flags: 0x04,
      },
    ];

    await this.accountingService.createAccounts(accountParams, tx);

    await (client as any).asset.update({
      where: { id: assetId },
      data: { tbLedgerId, status: 'PROVISIONING' },
    });

    this.logger.log(`Asset ${asset.assetNo} provisioned with tbLedgerId=${tbLedgerId}, 3 TB accounts created`);
    return { tbLedgerId };
  }
}
