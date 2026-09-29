// admin-web/src/pages/companyFundsFormat.ts
// 战役乙波二 T8：公司资金看板 · 最小单位 → 展示层换算（铁律「金额最小单位存、展示层换算」）。
//
// 独立实现，不复用 LedgerAccountList.tsx 的 decimalsOf/decimalsMap——那份实现有已登记的
// 已知缺口（BACKLOG §M：`decimalsMap` 用 `asset.currency` 建键，表格行按账本科目注册表的
// `assetCode` 值去查）。**实测坐实的根因**（本任务 Step 4 起栈直查 `GET /admin/tb/accounts`
// 才发现，比 BACKLOG §M 原文描述更底层）：SYSTEM 账户（F_OPS/F_LIQ/F_SET/三收入格全部在
// 内）在种子阶段用 `asset.code`（如 'USDT-TRON'）而非 `asset.currency`（'USDT'）登记进
// `tbAccountRegistry.assetCode`（见 prisma/seed.business.ts#seedAssets 调
// `ensureTbAccountRegistry(..., assetCode: asset.code, ...)`）——AED 因 code===currency
// 掩盖了问题，USDT 的 code('USDT-TRON')≠currency('USDT') 才暴露：任何只按 currency 建键
// 的 decimals 表，查 'USDT-TRON' 必落空、回退默认 2 位，6 位小数的余额被放大 10⁴ 倍
// （与 BACKLOG §M「放大约万倍」的现象描述完全吻合，只是把"键不对齐"的根因往上游又追了
// 一层：不是前端 decimalsMap 写错，是账本科目注册表两类账户的 assetCode 语义本就不统一）。
//
// 本页不碰后端/种子（Files 清单只列 admin-web 三文件 + rbac.catalog.ts），故在前端做
// 规范化防御：`buildAssetLookup` 同时收 `currency`（'AED'/'USDT'）与 `code`（'AED'/
// 'USDT-TRON'）两套键，`currencyOf()` 把账本行下发的 assetCode（可能是 code 形态，也
// 可能是 currency 形态）统一收敛成 currency 再查 decimals / 显示 / 配阈值——三处口径
// 从此只认 currency 一种形态，不会重犯 BACKLOG §M 那种"键形态不统一"的错。
export interface AssetLookupInfo {
  currency: string;
  code: string;
  decimals: number;
}

export interface AssetLookup {
  /** 把账本行下发的 assetCode（可能是资产 code 或 currency 两种形态之一）收敛成 currency。 */
  currencyOf: (assetCodeOrCurrency: string) => string;
  /** 按 currency 取 decimals；未知币种回退 2 位（同既有页面既定回退口径）。 */
  decimalsOf: (assetCodeOrCurrency: string) => number;
}

/** `GET /assets?take=100` 响应行 → { currencyOf, decimalsOf } 查找器；
 *  只收已开通(tbLedgerId != null)的资产，照既有页面（LedgerAccountList/AccountFlowList）
 *  同款过滤惯例（调用方负责先过滤）。 */
export const buildAssetLookup = (assets: AssetLookupInfo[]): AssetLookup => {
  const decimalsByCurrency: Record<string, number> = {};
  const currencyByCode: Record<string, string> = {};
  for (const a of assets) {
    if (!a.currency) continue;
    if (typeof a.decimals === 'number') decimalsByCurrency[a.currency] = a.decimals;
    if (a.code) currencyByCode[a.code] = a.currency;
  }
  const currencyOf = (raw: string): string => currencyByCode[raw] ?? raw;
  const decimalsOf = (raw: string): number => decimalsByCurrency[currencyOf(raw)] ?? 2;
  return { currencyOf, decimalsOf };
};

/** bigint-safe 最小单位(分/wei)字符串 → 展示层大单位字符串，逗号千分位。
 *  与 LedgerAccountList.tsx/AccountFlowList.tsx 的 formatMinorToMajor 算法同源
 *  （padStart 插小数点，全程走字符串/BigInt，不经 Number()，避免大额精度丢失）——
 *  算法本身没有问题，问题只出在 decimals 的查找键上（见本文件头注释），故这里保留
 *  同款算法、只重写 decimals 的取值来源（buildAssetLookup）。 */
export const formatMinorToMajor = (raw: string | null | undefined, decimals: number): string => {
  const s = String(raw ?? '0');
  let neg = false;
  let body = s;
  if (body.startsWith('-')) {
    neg = true;
    body = body.slice(1);
  }
  const padded = body.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals) || '0';
  const fracPart = decimals > 0 ? padded.slice(padded.length - decimals) : '';
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${intGrouped}${fracPart ? `.${fracPart}` : ''}`;
};

/** 见底阈值判据：最小单位余额(BigInt-safe) 是否低于阈值（阈值以「元/大单位」写死在
 *  companyFundsThresholds.ts，用 currency 建键）。全程 BigInt 比较，不经 Number()——
 *  避免大额（如 113,600,000,000 分）转 Number 丢精度。 */
export const isBelowThresholdMinor = (
  balanceMinor: string | null | undefined,
  thresholdMajor: number,
  decimals: number,
): boolean => {
  const balance = BigInt(String(balanceMinor ?? '0'));
  const thresholdMinor = BigInt(Math.round(thresholdMajor)) * 10n ** BigInt(decimals);
  return balance < thresholdMinor;
};
