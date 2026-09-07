// src/modules/accounting/tigerbeetle/customer-ledger-provisioning.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from './accounting.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TB_ACCOUNT_CODES } from './constants/tb-account-codes.constant';
import { TB_LEDGERS } from './constants/tb-ledgers.constant';
import { CreateTbAccountParams } from './types/accounting.types';

/**
 * 客户账本户运行时开户（波三 spec §7，BACKLOG :155 销账）。
 * 行形状与种子 seedCustomers 同款：ACTIVE 资产 × [CLIENT_PAYABLE, DEPOSIT_SUSPENSE]，
 * 同币种多资产共 ledger、行按 (code, ledger) 一份（与种子 ensureTbAccountRegistry 的
 * findFirst 语义一致）。TB 不可达 = 抛错阻断激活，不 graceful skip。
 */
@Injectable()
export class CustomerLedgerProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly registry: TbAccountRegistryService,
  ) {}

  async provisionCustomerAccounts(owner: { id: string; customerNo: string }): Promise<{ created: number; accounts: string[] }> {
    const assets = await this.prisma.asset.findMany({
      where: { status: 'ACTIVE' },
      select: { code: true, currency: true },
    });
    const params: CreateTbAccountParams[] = [];
    const seen = new Set<string>();
    const accounts: string[] = [];
    for (const asset of assets) {
      const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
      for (const code of [TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]) {
        const key = `${code}|${ledger}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const existing = await this.registry.resolve({ code, ledger, ownerType: 'CUSTOMER', ownerUuid: owner.id });
        if (existing) continue;
        const name = code === TB_ACCOUNT_CODES.CLIENT_PAYABLE ? 'CLIENT_PAYABLE' : 'DEPOSIT_SUSPENSE';
        accounts.push(`${name}/${asset.currency}`);
        params.push({
          code, ledger, ownerType: 'CUSTOMER', ownerUuid: owner.id, ownerNo: owner.customerNo,
          assetCurrency: asset.code, description: `${name} for ${owner.customerNo}/${asset.code}`,
        });
      }
    }
    if (params.length > 0) await this.accounting.createAccounts(params);
    return { created: params.length, accounts };
  }
}
