// admin-web/src/utils/reconAmount.ts
//
// 第六幕清残留·波四（Task 3）：对账域 bigint-safe 分→元换算——从
// ReconciliationCasesDetailPage.tsx（formatAmount / minorToMajorPlain /
// isZeroAmount）与 ReconciliationAdjustmentCreateModal.tsx（minorToDisplay /
// displayToMinor）剪出的单一来源，实现逐字未变。与 utils/number-format.ts 划界：
// 那边是浮点展示用的通用格式化（formatAssetAmount 等），这边专供对账域——不过一次
// 浮点、按资产 decimals 做纯字符串切分，USDT 6dp 也不丢精度。

// T4 (canon2): amounts arrive as integer base units (分); scale 分→元 by the
// case asset's real decimals (getCase returns `decimals` from the asset table).
// bigint-safe string padding — no float, so USDT (6dp) shows every digit right.
// decimals=0 (asset lookup miss / integer asset) degrades to no fraction part.
export const formatAmount = (raw: string | null | undefined, decimals: number): string => {
  const s = String(raw ?? '0');
  let neg = false;
  let body = s;
  if (body.startsWith('-')) { neg = true; body = body.slice(1); }
  const padded = body.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals) || '0';
  const fracPart = decimals > 0 ? padded.slice(padded.length - decimals) : '';
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${intGrouped}${fracPart ? `.${fracPart}` : ''}`;
};

// 平账三期（Task 12）：登记事故表单的「金额」字段要的是元（同 RegisterIncidentDto.amount
// 口径），不能带千分位逗号——复用 formatAmount 的换算，只是去掉分组符。
export const minorToMajorPlain = (raw: string | null | undefined, decimals: number): string =>
  formatAmount(raw, decimals).replace(/,/g, '');

export const isZeroAmount = (raw: string | null | undefined): boolean => {
  const s = String(raw ?? '0').replace(/^-/, '');
  return s === '' || /^0+$/.test(s);
};

// 分→元 的可编辑显示值（区别于 formatAmount：那个是千分位展示用，不能拿来回填
// input——逗号会把用户输入搅乱）。bigint-safe：只做字符串切分，不过一次浮点。
export const minorToDisplay = (raw: string, decimals: number): string => {
  const s = String(raw ?? '0');
  let neg = false; let body = s;
  if (body.startsWith('-')) { neg = true; body = body.slice(1); }
  if (decimals === 0) return `${neg ? '-' : ''}${body || '0'}`;
  const padded = body.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals) || '0';
  const fracPart = padded.slice(padded.length - decimals);
  return `${neg ? '-' : ''}${intPart}.${fracPart}`;
};

// 反向：操作员输入的元 → 分（最小单位整数字符串，CreateAdjustmentDto.amount 要
// 的形状）。非法输入（非数字/小数位超过资产精度）返回 null，调用方据此禁用提交
// ——这是把"输入还原成数字"这件事做对，不是防御性校验（没有它表单根本不能用）。
export const displayToMinor = (display: string, decimals: number): string | null => {
  const trimmed = display.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [intPart, fracPart = ''] = trimmed.split('.');
  if (fracPart.length > decimals) return null;
  const combined = `${intPart}${fracPart.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  return combined || '0';
};
