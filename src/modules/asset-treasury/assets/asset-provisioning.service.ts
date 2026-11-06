import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';

/** 每个资产装载时必须先开好的系统级 TB 科目（先有账后有货）。
 *  戊波一起不分法币/加密：权益 200、收入 210–212、开支 300–302 每币种一份。
 *  现金类 1 / 50 不在此开——每个钱包一户，钱包 ACTIVE 时由 WalletCashAccountService 开；
 *  100 / 101 每客户每币种，客户入驻激活时开。
 *  波一起只有种子调用它（seed.business.ts#seedAssets），当下零运行时调用方。 */
export function systemAccountCodesFor(_assetType: string): Array<{ code: number; desc: string }> {
  return [
    { code: TB_ACCOUNT_CODES.FIRM_EQUITY, desc: 'FIRM_EQUITY' },
    { code: TB_ACCOUNT_CODES.INCOME_SWAP_FEE, desc: 'INCOME_SWAP_FEE' },
    { code: TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE, desc: 'INCOME_WITHDRAW_FEE' },
    { code: TB_ACCOUNT_CODES.INCOME_OTHER, desc: 'INCOME_OTHER' },
    { code: TB_ACCOUNT_CODES.EXPENSE_BANK_CUSTODY, desc: 'EXPENSE_BANK_CUSTODY' },
    { code: TB_ACCOUNT_CODES.EXPENSE_RECON_LOSS, desc: 'EXPENSE_RECON_LOSS' },
    { code: TB_ACCOUNT_CODES.EXPENSE_OTHER, desc: 'EXPENSE_OTHER' },
  ];
}
