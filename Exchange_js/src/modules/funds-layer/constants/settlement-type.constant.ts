/**
 * Settlement-batch `settlementType` — the canonical 6-value scheme.
 *
 * Scheme: `{RAIL}_{KIND}` where RAIL ∈ FIAT | CRYPTO and
 * KIND ∈ SWAP (swap-fee batch) | WITHDRAW (withdraw-fee batch) | PRINCIPAL
 * (financial principal / 本金 settlement batch — NOT a fee).
 *
 * This was previously a free-form string (legacy values 'EOD' / 'MANUAL_SETTLE'
 * / 'FEE_COLLECT'), which let a wrong literal slip through and mislabel a batch.
 * Typing every producer + the settle() param against this union makes a stray
 * literal a `tsc` error (防呆).
 *
 * NOTE: settlementType labels WHAT the batch settles (rail × kind); it no longer
 * encodes the TRIGGER. EOD vs manual crypto-principal both produce
 * 'CRYPTO_PRINCIPAL' — the reval gate distinguishes them via the transfer's
 * `triggerSource` ('EOD' vs 'MANUAL_SETTLE'), not via settlementType.
 */
/** triggerSource values the reval gate distinguishes (must stay in sync across write + read). */
export const SETTLEMENT_TRIGGER = { EOD: 'EOD', MANUAL: 'MANUAL_SETTLE' } as const;

export const SETTLEMENT_TYPES = [
  'FIAT_SWAP',
  'FIAT_WITHDRAW',
  'FIAT_PRINCIPAL',
  'CRYPTO_SWAP',
  'CRYPTO_WITHDRAW',
  'CRYPTO_PRINCIPAL',
] as const;

export type SettlementType = (typeof SETTLEMENT_TYPES)[number];
