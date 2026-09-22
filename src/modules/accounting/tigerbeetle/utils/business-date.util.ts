// 业务归属日：迪拜日历日（恒定 UTC+4，无夏令时）。2026-09-21 波五起从 UTC 切换
// （业主拍板见 decisions.md 2026-09-19 / 2026-09-21 两条）：
//   时刻 t 的业务日 = (t + 4h) 的 UTC 日期；业务日 D 的日终 = D T19:59:59.999Z。
// 全仓表达业务日边界只许经本文件，不许手拼 T23:59:59.999Z / T00:00:00Z。
export const DUBAI_UTC_OFFSET_MS = 4 * 60 * 60 * 1000;

export function toBusinessDate(at: Date): string {
  return new Date(at.getTime() + DUBAI_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/** 业务日 D 的最后一刻（含）：D+1 迪拜零点 − 1ms = D T19:59:59.999Z。 */
export function endOfBusinessDate(businessDate: string): Date {
  return new Date(new Date(`${businessDate}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000 - DUBAI_UTC_OFFSET_MS - 1);
}

/** 业务日 D 的第一刻：D 迪拜零点 = (D-1) T20:00:00.000Z。 */
export function startOfBusinessDate(businessDate: string): Date {
  return new Date(new Date(`${businessDate}T00:00:00.000Z`).getTime() - DUBAI_UTC_OFFSET_MS);
}
