// 战役甲波三 Task 1：addBusinessDays 单测——跨周末、周五+5、跨月、0 天、周六起算、迪拜跨日边界。
// 星期几断言一律按迪拜日历（UTC+4）判定，不用宿主时区也不用裸 getUTCDay 兜底语义。
import { addBusinessDays } from './business-days';
import { DUBAI_UTC_OFFSET_MS } from '../../accounting/tigerbeetle/utils/business-date.util';

const dubaiDay = (d: Date): number => new Date(d.getTime() + DUBAI_UTC_OFFSET_MS).getUTCDay();

describe('addBusinessDays (UAE 联邦周末=周六日，迪拜日历判定)', () => {
  it('跨周末：周四 +2 个工作日 → 下周一（跳过周六周日）', () => {
    const thu = new Date('2026-01-08T10:00:00Z'); // Thu（迪拜同日）
    const result = addBusinessDays(thu, 2);
    expect(result.toISOString().slice(0, 10)).toBe('2026-01-12'); // Mon
    expect(dubaiDay(result)).toBe(1);
  });

  it('周五 +5 个工作日 → 下周五（一周后，spec §1②CNMR/PNMR 5 工作日口径）', () => {
    const fri = new Date('2026-01-09T10:00:00Z'); // Fri
    const result = addBusinessDays(fri, 5);
    expect(result.toISOString().slice(0, 10)).toBe('2026-01-16'); // Fri
    expect(dubaiDay(result)).toBe(5);
  });

  it('跨月：1 月 29 日（周四）+3 个工作日 → 2 月 3 日（周二）', () => {
    const d = new Date('2026-01-29T10:00:00Z'); // Thu
    const result = addBusinessDays(d, 3);
    expect(result.toISOString().slice(0, 10)).toBe('2026-02-03'); // Tue
  });

  it('0 天：原样返回同一时刻，不做任何步进', () => {
    const d = new Date('2026-02-10T10:00:00Z');
    const result = addBusinessDays(d, 0);
    expect(result.getTime()).toBe(d.getTime());
  });

  it('周六起算（⚡ 周末命中锚法）：周六 +5 个工作日 → 下周五', () => {
    const sat = new Date('2026-01-10T10:00:00Z'); // Sat（迪拜同日）
    const result = addBusinessDays(sat, 5);
    expect(result.toISOString().slice(0, 10)).toBe('2026-01-16'); // Fri
    expect(dubaiDay(result)).toBe(5);
  });

  it('迪拜跨日边界：UTC 周日 21:00（迪拜周一 01:00）+5 → 迪拜下周一（宿主时区无关，评审红项鉴别用例）', () => {
    const anchor = new Date('2026-01-11T21:00:00Z'); // 迪拜 2026-01-12(Mon) 01:00
    const result = addBusinessDays(anchor, 5);
    expect(result.toISOString()).toBe('2026-01-18T21:00:00.000Z'); // 迪拜 01-19(Mon) 01:00
    expect(dubaiDay(result)).toBe(1);
  });
});
