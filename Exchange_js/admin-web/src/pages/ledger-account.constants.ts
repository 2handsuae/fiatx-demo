// admin-web/src/pages/ledger-account.constants.ts
/** TB account code → COA name. 与后端 tb-account-codes.constant.ts 同步。 */
export const TB_CODE_LABELS: Record<number, string> = {
  1: 'CLIENT_ASSET',
  50: 'FIRM_ASSET',
  100: 'CLIENT_PAYABLE',
  101: 'DEPOSIT_SUSPENSE',
  200: 'FIRM_OPS',
  201: 'FIRM_SET',
  202: 'FIRM_FEE',
  203: 'FIRM_LIQ',
};

const labelOf = (code: number) => `${code} · ${TB_CODE_LABELS[code] ?? `CODE_${code}`}`;

export const TB_CODE_OPTIONS = [
  { value: '', label: 'All codes' },
  ...Object.keys(TB_CODE_LABELS).map((c) => ({ value: c, label: labelOf(Number(c)) })),
];

/** SYSTEM-owner codes (1/ledger). */
export const SYSTEM_TB_CODES = [1, 50, 200, 201, 202, 203];
/** Per-customer codes. */
export const CUSTOMER_TB_CODES = [100, 101];

export const SYSTEM_CODE_OPTIONS = SYSTEM_TB_CODES.map((c) => ({ value: c, label: labelOf(c) }));
export const CUSTOMER_CODE_OPTIONS = CUSTOMER_TB_CODES.map((c) => ({ value: c, label: labelOf(c) }));

const CLASS_PREFIX: Record<number, string> = {
  1: 'A', 50: 'A',
  100: 'L', 101: 'L',
  200: 'E', 201: 'E', 202: 'E', 203: 'E',
};

export const COA_OPTIONS = Object.entries(TB_CODE_LABELS).map(([code, name]) => ({
  value: `${CLASS_PREFIX[Number(code)]}.${name}`,
  label: `${CLASS_PREFIX[Number(code)]}.${name}`,
}));
