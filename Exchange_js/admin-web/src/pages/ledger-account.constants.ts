/**
 * TB account code → COA name (two-book chart of accounts).
 * Single display dictionary for the admin ledger pages — keep in sync with
 * backend `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts`.
 */
export const TB_CODE_LABELS: Record<number, string> = {
  // ── 客户账本(safeguarding)──
  1: 'CLIENT_BANK',
  10: 'CLIENT_CUSTODY',
  100: 'CLIENT_CREDIT',
  101: 'CLIENT_AUDIT',
  110: 'TRADE_CLEARING',
  // ── 公司账本 ──
  50: 'FIRM_OPS',
  60: 'FX_POSITION',
  200: 'PAID_IN_CAPITAL',
  210: 'RETAINED_EARNINGS',
  300: 'FEE_INCOME',
  310: 'SPREAD_INCOME',
  320: 'FX_UNREALIZED_PNL',
  330: 'FX_REALIZED_PNL',
};

const labelOf = (code: number) => `${code} · ${TB_CODE_LABELS[code] ?? `CODE_${code}`}`;

/** Filter dropdown (string values, with an "all" entry). */
export const TB_CODE_OPTIONS = [
  { value: '', label: 'All codes' },
  ...Object.keys(TB_CODE_LABELS).map((c) => ({ value: c, label: labelOf(Number(c)) })),
];

/** Codes that exist once per ledger (SYSTEM owner). */
export const SYSTEM_TB_CODES = [1, 10, 50, 60, 110, 200, 210, 300, 310, 320, 330];
/** Per-customer codes (CUSTOMER owner). */
export const CUSTOMER_TB_CODES = [100, 101];

export const SYSTEM_CODE_OPTIONS = SYSTEM_TB_CODES.map((c) => ({ value: c, label: labelOf(c) }));
export const CUSTOMER_CODE_OPTIONS = CUSTOMER_TB_CODES.map((c) => ({ value: c, label: labelOf(c) }));
