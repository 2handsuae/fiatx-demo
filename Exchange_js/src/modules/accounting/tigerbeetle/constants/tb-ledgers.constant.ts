/** One ledger per currency. Immutable once assigned. */
export const TB_LEDGERS = {
  AED: 1,
  USDT: 2,
} as const;

export type TbLedgerId = (typeof TB_LEDGERS)[keyof typeof TB_LEDGERS];
