/** TB account type codes (u16). Immutable once assigned. */
export const TB_ACCOUNT_CODES = {
  // Assets (1–99)
  BANK: 1,
  CUSTODY: 10,
  // Liabilities (100–199)
  CLIENT_CREDIT: 100,
} as const;

export type TbAccountCode = (typeof TB_ACCOUNT_CODES)[keyof typeof TB_ACCOUNT_CODES];

/** Human-readable COA code → TB numeric code */
export const COA_TO_TB_CODE: Record<string, number> = {
  'A.BANK': 1,
  'A.CUSTODY': 10,
  'L.CLIENT_CREDIT': 100,
};

/** TB numeric code → human-readable COA code */
export const TB_CODE_TO_COA: Record<number, string> = Object.fromEntries(
  Object.entries(COA_TO_TB_CODE).map(([k, v]) => [v, k]),
);
