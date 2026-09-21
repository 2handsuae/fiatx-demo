// 平账 A 批（spec §2.7）：三条数字线写死代码——财务政策数，改动该走发版评审，
// 不做管理台可配（同 TR 阈值先例 decisions.md 2026-07-31）。演示靠 ⚡拨钟。
// 容差本批不做（decisions.md 2026-09-02「一分不差，一分也追」），故这里只有两条线。

import { endOfBusinessDate } from '../../../accounting/tigerbeetle/utils/business-date.util';

/** 账龄线：案件业务日日终起算，到线置「超期」标记（软破线，状态不动）。 */
export const RECON_AGING_DAYS = 3;

/**
 * 小额线（最小单位）：查无果的公司池差异，≤ 线才许核销；> 线只能升级事故（三期）。
 * 按**币种**（asset.currency）索引，不按 asset.code（USDT 的 code 是 'USDT-TRON'）。
 */
export const SMALL_AMOUNT_LINE_MINOR: Record<string, bigint> = {
  AED: 10_000n,        // 100.00 AED（2 位）
  USDT: 30_000_000n,   // 30.000000 USDT（6 位）
};

export function isSmallAmount(currency: string, minor: bigint): boolean {
  const line = SMALL_AMOUNT_LINE_MINOR[currency];
  if (line === undefined) throw new Error(`Small-amount threshold not registered for currency: ${currency}——add a line in recon-thresholds.constant.ts first; no silent fallback`);
  const mag = minor < 0n ? -minor : minor;
  return mag <= line;
}

/** 截止时刻 = 业务日日终（迪拜午夜，business-date.util 单一口径）+ 账龄线天数。 */
export function computeAgingDeadline(businessDate: string): Date {
  return new Date(endOfBusinessDate(businessDate).getTime() + RECON_AGING_DAYS * 86_400_000);
}
