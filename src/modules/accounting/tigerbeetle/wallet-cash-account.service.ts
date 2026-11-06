// src/modules/accounting/tigerbeetle/wallet-cash-account.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountingService } from './accounting.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { cashAccountName, walletAccountCodesFor } from './constants/tb-account-codes.constant';
import { ledgerForNetwork } from './constants/tb-ledgers.constant';
import { currencyForNetwork } from '../../../config/manifests/assets.manifest';
import { NetworkCode } from '../../../config/manifests/networks.manifest';

/** 开户所需的钱包行字段（直接喂 Prisma `Wallet` 行即可）。 */
export interface WalletCashAccountInput {
  id: string;
  walletNo: string;
  /** 'PLATFORM' | 'CUSTOMER'(→ cashAccountCodeFor)；Prisma 的 Wallet 行里是 string，故不收窄成字面量 */
  ownerType: string;
  ownerNo: string;
  vaultCode: string;
  walletRole: string;
  network: string;
}

/**
 * 钱包 ACTIVE → 开它名下的户（戊波一 §2.3；戊波二加码 2）。
 *   客户钱包 → 1（Client Cash）+ 2（Custody Shortfall，托管短缺待补）、平台钱包 → 50（Company Cash）；
 *   ledger 按钱包所在网络对应的资产。开哪几个码只认 `walletAccountCodesFor`。
 * 四元组 = (code, ledger, 'WALLET', wallet.id)，ownerNo = walletNo，户名写进注册表 description。
 * 取户走 `AccountingService.resolveCashAccountId`（码 1 / 50）或 `resolveTbAccountId`（码 2），不要在记账处自己拼这个四元组。
 */
@Injectable()
export class WalletCashAccountService {
  constructor(
    private readonly accounting: AccountingService,
    private readonly registry: TbAccountRegistryService,
  ) {}

  async ensureForWallet(wallet: WalletCashAccountInput, tx?: Prisma.TransactionClient): Promise<void> {
    const assetCurrency = currencyForNetwork(wallet.network as NetworkCode);
    const ledger = ledgerForNetwork(wallet.network as NetworkCode);

    const missing: Array<1 | 2 | 50> = [];
    for (const code of walletAccountCodesFor(wallet.ownerType)) {
      const existing = await this.registry.resolve({ code, ledger, ownerType: 'WALLET', ownerUuid: wallet.id }, tx);
      if (!existing) missing.push(code);
    }
    if (missing.length === 0) return;

    await this.accounting.createAccounts(
      missing.map((code) => ({
        code,
        ledger,
        ownerType: 'WALLET' as const,
        ownerUuid: wallet.id,
        ownerNo: wallet.walletNo,
        assetCurrency,
        description: cashAccountName(code, wallet),
      })),
      tx,
    );
  }
}
