// 战役甲波三 Task 1：addBusinessDays 单测——跨周末、周五+5、跨月、0 天。
import { addBusinessDays } from './business-days';

describe('addBusinessDays (UAE 联邦周末=周六日)', () => {
  it('跨周末：周四 +2 个工作日 → 下周一（跳过周六周日）', () => {
    const thu = new Date('2026-01-08T10:00:00Z'); // Thu
    const result = addBusinessDays(thu, 2);
    expect(result.toISOString().slice(0, 10)).toBe('2026-01-12'); // Mon
    expect(result.getUTCDay()).toBe(1);
  });

  it('周五 +5 个工作日 → 下周五（一周后，spec §1②CNMR/PNMR 5 工作日口径）', () => {
    const fri = new Date('2026-01-09T10:00:00Z'); // Fri
    const result = addBusinessDays(fri, 5);
    expect(result.toISOString().slice(0, 10)).toBe('2026-01-16'); // Fri
    expect(result.getUTCDay()).toBe(5);
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
});
