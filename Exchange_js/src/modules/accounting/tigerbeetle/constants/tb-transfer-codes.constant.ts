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

  // Swap: from-leg lock + to-leg credit + fee + spread (30–35)
  SWAP_CREDIT_TO_CLEARING_PENDING: 30,
  SWAP_CREDIT_TO_CLEARING_POST: 31,
  SWAP_CREDIT_TO_CLEARING_VOID: 32,
  SWAP_CLEARING_TO_CREDIT: 33,
  SWAP_CLEARING_TO_FEE: 34, // deprecated: fee now debits CLIENT_PAYABLE (see SWAP_CREDIT_TO_FEE)
  SWAP_CLEARING_TO_SPREAD: 35,
  SWAP_CREDIT_TO_FEE: 36,

  // ── Two-book accounting (50–70) ──
  // Settlement-leg physical mirrors: client pool ↔ FIRM_TREASURY
  SETTLE_POOL_TO_FIRM: 50, // debit FIRM_TREASURY, credit CLIENT_BANK|CLIENT_CUSTODY
  SETTLE_FIRM_TO_POOL: 51, // debit CLIENT_BANK|CLIENT_CUSTODY, credit FIRM_TREASURY
  // Withdrawal-fee de-commingle: fee leaves the client pool into firm ops
  FEE_DECOMMINGLE: 52,     // debit FIRM_TREASURY, credit CLIENT_BANK|CLIENT_CUSTODY

  // EOD bridge sweep: TRADE_CLEARING ↔ FX_POSITION (the only cross-currency point)
  BRIDGE_SWEEP_OUT: 60, // bridge net CREDIT → debit TRADE_CLEARING, credit FX_POSITION
  BRIDGE_SWEEP_IN: 61,  // bridge net DEBIT  → debit FX_POSITION, credit TRADE_CLEARING

  // FX revaluation / realization
  FX_REVAL_LOSS: 62, // debit FX_UNREALIZED_PNL, credit FX_POSITION
  FX_REVAL_GAIN: 63, // debit FX_POSITION, credit FX_UNREALIZED_PNL
  FX_REALIZE: 64,    // LP fill: close position legs against FIRM_TREASURY + FX_REALIZED_PNL

  // Bootstrap
  CAPITAL_INJECTION: 70, // debit FIRM_TREASURY, credit PAID_IN_CAPITAL
} as const;

export type TbTransferCode = (typeof TB_TRANSFER_CODES)[keyof typeof TB_TRANSFER_CODES];
