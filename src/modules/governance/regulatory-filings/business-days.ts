// 战役甲波三 Task 1：工作日钟纯函数（spec §1② 时限口径订正：CNMR/PNMR 均 5 个工作日）。
// UAE 联邦周末＝周六、周日，按**迪拜日历**（UTC+4，无夏令时）判定——与账务业务日同一口径
// （T1 升档评审红项修复：原实现按宿主时区判周末，同函数在不同部署时区算出不同截止日）。
// 零 Nest/Prisma 依赖。

import { DUBAI_UTC_OFFSET_MS } from '../../accounting/tigerbeetle/utils/business-date.util';

const DAY_MS = 24 * 60 * 60 * 1000;

/** from 之后第 days 个工作日（迪拜日历周一至五）；周末不计入。days=0 原样返回 from（不入 while，无副作用）。 */
export function addBusinessDays(from: Date, days: number): Date {
  let t = from.getTime();
  let remaining = days;
  while (remaining > 0) {
    t += DAY_MS;
    const dubaiDay = new Date(t + DUBAI_UTC_OFFSET_MS).getUTCDay(); // 0=Sun ... 6=Sat
    if (dubaiDay !== 0 && dubaiDay !== 6) remaining -= 1;
  }
  return new Date(t);
}
