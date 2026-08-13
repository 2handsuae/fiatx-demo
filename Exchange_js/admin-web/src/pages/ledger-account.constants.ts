// admin-web/src/pages/ledger-account.constants.ts
/** TB account code → COA 内部名。与后端 tb-account-codes.constant.ts 同步(COA v2, 2026-08-13)。 */
export const TB_CODE_LABELS: Record<number, string> = {
  1: 'CLIENT_ASSET', 50: 'FIRM_ASSET',
  100: 'CLIENT_PAYABLE', 101: 'DEPOSIT_SUSPENSE',
  200: 'FIRM_OPS', 201: 'FIRM_SET',
  210: 'INCOME_SWAP_FEE', 211: 'INCOME_WITHDRAW_FEE', 212: 'INCOME_OTHER',
  // 退役户(只读识别,历史行仍会出现):
  202: 'FIRM_FEE (retired)', 203: 'FIRM_LIQ (retired)', 204: 'FIRM_SEIZED (retired)',
};

/** 展示名模板——币种由调用方拼后缀(`${TB_CODE_DISPLAY[code]} – ${assetCode}`),名字永不写死币种。 */
export const TB_CODE_DISPLAY: Record<number, string> = {
  1: 'Client Assets in Custody', 50: 'Company Own Assets',
  100: 'Payable to Clients – Available Balance', 101: 'Client Deposits Held – Pending Release',
  200: 'Company Operating Funds', 201: 'Settlement in Transit – Fiat',
  210: 'Trading Fee Income', 211: 'Withdrawal Fee Income', 212: 'Other Service Income',
};

const ACTIVE_CODES = [1, 50, 100, 101, 200, 201, 210, 211, 212];
const labelOf = (code: number) => `${code} · ${TB_CODE_LABELS[code] ?? `CODE_${code}`}`;

export const TB_CODE_OPTIONS = [
  { value: '', label: 'All codes' },
  ...ACTIVE_CODES.map((c) => ({ value: String(c), label: labelOf(c) })),
];

/** SYSTEM-owner codes (1/ledger). */
export const SYSTEM_TB_CODES = [1, 50, 200, 201, 210, 211, 212];
/** Per-customer codes. */
export const CUSTOMER_TB_CODES = [100, 101];

export const SYSTEM_CODE_OPTIONS = SYSTEM_TB_CODES.map((c) => ({ value: c, label: labelOf(c) }));
export const CUSTOMER_CODE_OPTIONS = CUSTOMER_TB_CODES.map((c) => ({ value: c, label: labelOf(c) }));

const CLASS_PREFIX: Record<number, string> = {
  1: 'A', 50: 'A', 100: 'L', 101: 'L',
  200: 'E', 201: 'E', 210: 'E', 211: 'E', 212: 'E',
};

export const COA_OPTIONS = ACTIVE_CODES.map((c) => ({
  value: `${CLASS_PREFIX[c]}.${TB_CODE_LABELS[c]}`,
  label: `${CLASS_PREFIX[c]}.${TB_CODE_LABELS[c]}`,
}));
