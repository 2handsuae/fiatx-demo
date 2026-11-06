// src/modules/accounting/tigerbeetle/wallet-cash-account.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountingService } from './accounting.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TB_ACCOUNT_CODES, cashAccountName } from './constants/tb-account-codes.constant';
import { TB_LEDGERS } from './constants/tb-ledgers.constant';
import { currencyForNetwork } from '../../../config/manifests/assets.manifest';
import { NetworkCode } from '../../../config/manifests/networks.manifest';

/** 开户所需的钱包行字段（直接喂 Prisma `Wallet` 行即可）。 */
export interface WalletCashAccountInput {
  id: string;
  walletNo: string;
  /** 'PLATFORM' | 'CUSTOMER'：CUSTOMER → 1 客户现金，其余 → 50 公司现金 */
  ownerType: string;
  ownerNo: string;
  vaultCode: string;
  walletRole: string;
  network: string;
}

/**
 * 钱包 ACTIVE → 开它的现金户（戊波一 §2.3）。每个钱包一户：
 *   客户钱包 → 1（Client Cash）、平台钱包 → 50（Company Cash）；ledger 按钱包所在网络对应的资产。
 * 四元组 = (code, ledger, 'WALLET', wallet.id)，ownerNo = walletNo，户名写进注册表 description。
 * 取户走 `AccountingService.resolveCashAccountId`，不要在记账处自己拼这个四元组。
 */
@Injectable()
export class WalletCashAccountService {
  constructor(
    private readonly accounting: AccountingService,
    private readonly registry: TbAccountRegistryService,
  ) {}

  async ensureForWallet(wallet: WalletCashAccountInput, tx?: Prisma.TransactionClient): Promise<void> {
    const code = wallet.ownerType === 'CUSTOMER' ? TB_ACCOUNT_CODES.CLIENT_CASH : TB_ACCOUNT_CODES.FIRM_CASH;
    const assetCurrency = currencyForNetwork(wallet.network as NetworkCode);
    const ledger = TB_LEDGERS[assetCurrency as keyof typeof TB_LEDGERS];

    const existing = await this.registry.resolve({ code, ledger, ownerType: 'WALLET', ownerUuid: wallet.id }, tx);
    if (existing) return;

    await this.accounting.createAccounts(
      [
        {
          code,
          ledger,
          ownerType: 'WALLET',
          ownerUuid: wallet.id,
          ownerNo: wallet.walletNo,
          assetCurrency,
          description: cashAccountName(code, wallet),
        },
      ],
      tx,
    );
  }
}
