// admin-web/src/pages/ledger-account.constants.ts
/** TB account code → COA 内部名。与后端 tb-account-codes.constant.ts 同步(COA v2, 2026-08-13)。
 *  **不导出**:内部名只用于筛选下拉(下方 labelOf/COA_OPTIONS)与 accountDisplayName 的兜底。
 *  页面要显示账户名一律用 accountDisplayName() —— 导出它就等于给"两个真相源"留后门。 */
const TB_CODE_LABELS: Record<number, string> = {
  1: 'CLIENT_ASSET', 50: 'FIRM_ASSET',
  100: 'CLIENT_PAYABLE', 101: 'DEPOSIT_SUSPENSE',
  200: 'FIRM_OPS', 201: 'FIRM_SET',
  210: 'INCOME_SWAP_FEE', 211: 'INCOME_WITHDRAW_FEE', 212: 'INCOME_OTHER',
  // 退役户(只读识别,历史行仍会出现):
  202: 'FIRM_FEE (retired)', 203: 'FIRM_LIQ (retired)', 204: 'FIRM_SEIZED (retired)',
};

/** 展示名模板(不导出)——币种一律由 `accountDisplayName()` 拼后缀,名字本身永不写死币种。 */
const TB_CODE_DISPLAY: Record<number, string> = {
  1: 'Client Assets in Custody', 50: 'Company Own Assets',
  100: 'Payable to Clients – Available Balance', 101: 'Client Deposits Held – Pending Release',
  200: 'Company Operating Funds', 201: 'Settlement in Transit – Fiat',
  210: 'Trading Fee Income', 211: 'Withdrawal Fee Income', 212: 'Other Service Income',
};

/**
 * 账户展示名的**唯一出口**——列表/详情/流水三处必须走这里。
 *
 * 2026-08-13 修:此前 `TB_CODE_DISPLAY` 与 `TB_CODE_LABELS` 两张表并排导出、谁用哪张全凭
 * 调用方自觉,结果 67bb80d6 只把列表页接上 DISPLAY,详情页与流水页仍用 LABELS ——
 * 同一个 code=101 在列表显示 "Client Deposits Held – Pending Release – AED"、
 * 在详情显示 "DEPOSIT_SUSPENSE · AED"。后端只返回 code + assetCode、不下发 name,
 * 所以拼装逻辑一旦有两个真相源就必然对不上,加一个新页面就再漏一次。
 * 现收敛成本函数,`TB_CODE_DISPLAY` 不再导出。
 *
 * `TB_CODE_LABELS`(内部 COA 码名)同样不再导出,只在本文件内服务筛选下拉——
 * 下拉里显示 `101 · DEPOSIT_SUSPENSE` 是刻意的:运营按内部码名筛选。
 */
export const accountDisplayName = (code: number | null | undefined, assetCode?: string | null): string => {
  if (code == null) return '—';
  const base = TB_CODE_DISPLAY[code] ?? TB_CODE_LABELS[code] ?? `CODE_${code}`;
  return assetCode ? `${base} – ${assetCode}` : base;
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
