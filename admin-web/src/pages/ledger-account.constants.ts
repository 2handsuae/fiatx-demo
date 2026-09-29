// admin-web/src/pages/ledger-account.constants.ts
/**
 * TB account code → **助记码**(代码的可读写法,与数字 code 等价,不是"科目名称")。
 *
 * ⚠️ 2026-08-13 建模纠偏:一个会计科目只有**一个**名称,而科目名称的唯一真相源在后端
 * `tb-account-codes.constant.ts → TB_ACCOUNT_NAMES`,随 API 以 `accountName` 字段下发。
 * 前端**不得**再自建任何 code→名称 的映射表 —— 此前正是因为没有名称字段、拿枚举标识符
 * 顶替、后来又在前端另造一份展示名,才出现"同一科目两个名字"(列表 vs 详情对不上)。
 *
 * 本表只服务**筛选下拉**(labelOf / COA_OPTIONS),显示 `101 · DEPOSIT_SUSPENSE` 形态;
 * 按业主口径:科目表与流水表显示名称,其余一切(凭证分录/对账 Case/筛选下拉)显示助记码。
 * 不导出 —— 一导出就又给"第二个名字"留了后门。
 */
const TB_CODE_LABELS: Record<number, string> = {
  1: 'CLIENT_ASSET', 50: 'FIRM_ASSET',
  100: 'CLIENT_PAYABLE', 101: 'DEPOSIT_SUSPENSE',
  200: 'FIRM_OPS', 201: 'FIRM_SET',
  // 战役乙波一（评审裁定 R4）：203 FIRM_LIQ 复活为 LP 在途验收户（原 2026-08-13 COA v2
  // 退役，翻案见乙总纲 §2）——补回筛选下拉，否则复活的科目在账本科目页选不到。
  203: 'FIRM_LIQ',
  210: 'INCOME_SWAP_FEE', 211: 'INCOME_WITHDRAW_FEE', 212: 'INCOME_OTHER',
};

/**
 * 把后端下发的科目名称拼上币种后缀。**只做拼接,不产生名字** ——
 * name 必须来自 API 的 `accountName`(唯一真相源在后端常量),前端永不自造。
 * 用于科目表 / 流水表;其余页面显示助记码,不调此函数。
 */
export const withAssetSuffix = (
  accountName: string | null | undefined,
  assetCode?: string | null,
): string => {
  if (!accountName) return '—';
  return assetCode ? `${accountName} – ${assetCode}` : accountName;
};

const ACTIVE_CODES = [1, 50, 100, 101, 200, 201, 203, 210, 211, 212];
const labelOf = (code: number) => `${code} · ${TB_CODE_LABELS[code] ?? `CODE_${code}`}`;

export const TB_CODE_OPTIONS = [
  { value: '', label: 'All codes' },
  ...ACTIVE_CODES.map((c) => ({ value: String(c), label: labelOf(c) })),
];

const CLASS_PREFIX: Record<number, string> = {
  1: 'A', 50: 'A', 100: 'L', 101: 'L',
  200: 'E', 201: 'E', 203: 'E', 210: 'E', 211: 'E', 212: 'E',
};

export const COA_OPTIONS = ACTIVE_CODES.map((c) => ({
  value: `${CLASS_PREFIX[c]}.${TB_CODE_LABELS[c]}`,
  label: `${CLASS_PREFIX[c]}.${TB_CODE_LABELS[c]}`,
}));
