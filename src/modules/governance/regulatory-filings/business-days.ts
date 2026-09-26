// 战役甲波三 Task 1：工作日钟纯函数（spec §1② 时限口径订正：CNMR/PNMR 均 5 个工作日）。
// UAE 联邦周末＝周六、周日；零 Nest/Prisma 依赖。

/** from 之后第 days 个工作日（周一至五）；周末不计入。days=0 原样返回 from（不入 while，无副作用）。 */
export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from.getTime());
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay(); // 0=Sun ... 6=Sat
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}
