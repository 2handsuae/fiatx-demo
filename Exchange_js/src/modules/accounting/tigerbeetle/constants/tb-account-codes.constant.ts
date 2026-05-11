/** TB account type codes (u16). Immutable once assigned. */
export const TB_ACCOUNT_CODES = {
  // Assets (1–99)
  BANK: 1,
  CUSTODY: 10,
  // Liabilities (100–199)
  CLIENT_CREDIT: 100,
  CLIENT_AUDIT: 101,
  TRADE_CLEARING: 110,
  FEE_RECEIVABLE: 120,
} as const;

export type TbAccountCode = (typeof TB_ACCOUNT_CODES)[keyof typeof TB_ACCOUNT_CODES];

/** Human-readable COA code → TB numeric code */
export const COA_TO_TB_CODE: Record<string, number> = {
  'A.BANK': TB_ACCOUNT_CODES.BANK,
  'A.CUSTODY': TB_ACCOUNT_CODES.CUSTODY,
  'L.CLIENT_CREDIT': TB_ACCOUNT_CODES.CLIENT_CREDIT,
  'L.CLIENT_AUDIT': TB_ACCOUNT_CODES.CLIENT_AUDIT,
  'L.TRADE_CLEARING': TB_ACCOUNT_CODES.TRADE_CLEARING,
  'L.FEE_RECEIVABLE': TB_ACCOUNT_CODES.FEE_RECEIVABLE,
};

/** TB numeric code → human-readable COA code */
export const TB_CODE_TO_COA: Record<number, string> = Object.fromEntries(
  Object.entries(COA_TO_TB_CODE).map(([k, v]) => [v, k]),
);
