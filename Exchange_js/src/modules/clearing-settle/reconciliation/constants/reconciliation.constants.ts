// COA 余额重算用：客户账本科目（I1 / I5 左侧）
export const CLIENT_ASSET_CODES = ['A.CLIENT_BANK', 'A.CLIENT_CUSTODY'] as const;
export const CLIENT_LIABILITY_CODES = [
  'L.CLIENT_PAYABLE',
  'L.DEPOSIT_SUSPENSE',
  'L.TRADE_CLEARING',
] as const;

// 层 → 账本资产科目 / native 币种容器
export const LAYER_ASSET_CODE: Record<string, string> = {
  CRYPTO: 'A.CLIENT_CUSTODY',
  FIAT: 'A.CLIENT_BANK',
};

// match 容差
export const AMOUNT_TOLERANCE = '0.000001';

export type UnmatchedType =
  | 'ORPHAN_INTERNAL'
  | 'ORPHAN_EXTERNAL'
  | 'AMOUNT_MISMATCH';
