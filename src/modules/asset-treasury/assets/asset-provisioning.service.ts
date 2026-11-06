import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';

/** 每个资产装载时必须先开好的系统级 TB 科目（先有账后有货）。
 *  波一起只有种子调用它（seed.business.ts#seedAssets），当下零运行时调用方。 */
export function systemAccountCodesFor(assetType: string): Array<{ code: number; desc: string }> {
  const isFiat = assetType === 'FIAT';
  return [
    { code: TB_ACCOUNT_CODES.CLIENT_CASH, desc: 'CLIENT_CASH' },
    { code: TB_ACCOUNT_CODES.FIRM_CASH, desc: 'FIRM_CASH' },
    { code: TB_ACCOUNT_CODES.FIRM_EQUITY, desc: 'FIRM_EQUITY' },
    { code: TB_ACCOUNT_CODES.FIRM_LIQ, desc: 'FIRM_LIQ' },
    { code: TB_ACCOUNT_CODES.INCOME_SWAP_FEE, desc: 'INCOME_SWAP_FEE' },
    { code: TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE, desc: 'INCOME_WITHDRAW_FEE' },
    { code: TB_ACCOUNT_CODES.INCOME_OTHER, desc: 'INCOME_OTHER' },
    ...(isFiat ? [{ code: TB_ACCOUNT_CODES.FIRM_SET, desc: 'FIRM_SET' }] : []),
  ];
}
