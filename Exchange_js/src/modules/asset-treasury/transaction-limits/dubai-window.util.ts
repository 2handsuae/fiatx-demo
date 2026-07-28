const DUBAI_OFFSET_MS = 4 * 3600 * 1000;

/** 返回迪拜日历日/日历月窗口起点（UTC Date） */
export function dubaiWindowStart(period: 'DAILY' | 'MONTHLY', now: Date): Date {
  const local = new Date(now.getTime() + DUBAI_OFFSET_MS);
  if (period === 'DAILY') {
    return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - DUBAI_OFFSET_MS);
  }
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - DUBAI_OFFSET_MS);
}
