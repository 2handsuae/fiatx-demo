/** TB transfer type codes (u16). Immutable once assigned. */
export const TB_TRANSFER_CODES = {
  // Deposit (1–9)
  DEPOSIT_CUSTODY_TO_AUDIT: 1,
  DEPOSIT_AUDIT_TO_CREDIT: 2,

  // Withdrawal: pending lock (10–11)
  WITHDRAW_CREDIT_TO_CUSTODY_PENDING: 10,
  WITHDRAW_CREDIT_TO_FEE_PENDING: 11,

  // Withdrawal: post — chain confirmed (12–13)
  WITHDRAW_CREDIT_TO_CUSTODY_POST: 12,
  WITHDRAW_CREDIT_TO_FEE_POST: 13,

  // Withdrawal: void — cancel/fail (14–15)
  WITHDRAW_CREDIT_TO_CUSTODY_VOID: 14,
  WITHDRAW_CREDIT_TO_FEE_VOID: 15,

  // Fiat withdrawal: pending lock (20)
  WITHDRAW_CREDIT_TO_BANK_PENDING: 20,
  // Fiat withdrawal: post — bank confirmed (21)
  WITHDRAW_CREDIT_TO_BANK_POST: 21,
  // Fiat withdrawal: void — cancel/fail (22)
  WITHDRAW_CREDIT_TO_BANK_VOID: 22,

  // Swap: from-leg lock + to-leg credit + fee (30–34)
  SWAP_CREDIT_TO_CLEARING_PENDING: 30,
  SWAP_CREDIT_TO_CLEARING_POST: 31,
  SWAP_CREDIT_TO_CLEARING_VOID: 32,
  SWAP_CLEARING_TO_CREDIT: 33,
  SWAP_CLEARING_TO_FEE: 34,
} as const;

export type TbTransferCode = (typeof TB_TRANSFER_CODES)[keyof typeof TB_TRANSFER_CODES];
