// src/modules/asset-treasury/lp-desk/lp-receivable-account.service.ts
//
// 戊波二 · LP 档案 →ACTIVE → 开它的应收户（码 51「应收 LP 交货」，借方户）。
// 各管各的：LP 主体自己的开户责任住 lp-desk（不住 accounting，也不让兑换单去开）；档案 workflow 在两条 →ACTIVE 边之后调它。
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TbAccountRegistryService } from '../../accounting/tigerbeetle/tb-account-registry.service';
import { TB_ACCOUNT_CODES, TB_ACCOUNT_NAMES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';

/**
 * 每个 LP 每个 ledger 一户（AED + USDT 各一），四元组 = (51, ledger, 'LP', lp.id)，
 * ownerNo = lpNo，户名 `Due from LP · <LP 名称>` 写进注册表 description。
 * 已存在的 ledger 直接跳过（批准开过、停用后复活再调时不重开）。
 */
@Injectable()
export class LpReceivableAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly registry: TbAccountRegistryService,
  ) {}

  async ensureForLp(lpId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const lp = await (tx ?? this.prisma).liquidityProvider.findUniqueOrThrow({ where: { id: lpId } });

    const missing: Array<{ currency: string; ledger: number }> = [];
    for (const [currency, ledger] of Object.entries(TB_LEDGERS)) {
      const existing = await this.registry.resolve(
        { code: TB_ACCOUNT_CODES.LP_RECEIVABLE, ledger, ownerType: 'LP', ownerUuid: lp.id },
        tx,
      );
      if (!existing) missing.push({ currency, ledger });
    }
    if (missing.length === 0) return;

    await this.accounting.createAccounts(
      missing.map(({ currency, ledger }) => ({
        code: TB_ACCOUNT_CODES.LP_RECEIVABLE,
        ledger,
        ownerType: 'LP' as const,
        ownerUuid: lp.id,
        ownerNo: lp.lpNo,
        assetCurrency: currency,
        description: `${TB_ACCOUNT_NAMES[TB_ACCOUNT_CODES.LP_RECEIVABLE]} · ${lp.name}`,
      })),
      tx,
    );
  }
}
