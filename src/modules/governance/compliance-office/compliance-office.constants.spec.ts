import { advanceDueDate, OBLIGATION_TRANSITIONS, ObligationStatus } from './compliance-office.constants';

describe('OBLIGATION_TRANSITIONS（铁律④显式迁移表，Task 2）', () => {
  it('只有 ACTIVE ↔ DISABLED 两条边，两态互为彼此的唯一出边', () => {
    expect(OBLIGATION_TRANSITIONS).toEqual({
      [ObligationStatus.ACTIVE]: [ObligationStatus.DISABLED],
      [ObligationStatus.DISABLED]: [ObligationStatus.ACTIVE],
    });
  });
});

describe('advanceDueDate（spec §3.2 翻期纯函数——日历月加法+月末钳制，Task 2）', () => {
  it('2026-01-31 + MONTHLY → 2026-02-28（月末钳制，防 JS 溢出到 3 月）', () => {
    const due = new Date('2026-01-31T09:00:00.000Z');
    const next = advanceDueDate(due, 'MONTHLY');
    expect(next.toISOString()).toBe('2026-02-28T09:00:00.000Z');
  });

  it('2026-11-30 + QUARTERLY → 2027-02-28（跨年 + 钳制）', () => {
    const due = new Date('2026-11-30T09:00:00.000Z');
    const next = advanceDueDate(due, 'QUARTERLY');
    expect(next.toISOString()).toBe('2027-02-28T09:00:00.000Z');
  });

  it('2026-03-15 + ANNUAL → 2027-03-15（无钳制需要，原样日）', () => {
    const due = new Date('2026-03-15T09:00:00.000Z');
    const next = advanceDueDate(due, 'ANNUAL');
    expect(next.toISOString()).toBe('2027-03-15T09:00:00.000Z');
  });

  it('2026-01-31 + SEMIANNUAL → 2026-07-31（31 天月份，非月末钳制场景，回归覆盖第四频率值）', () => {
    const due = new Date('2026-01-31T09:00:00.000Z');
    const next = advanceDueDate(due, 'SEMIANNUAL');
    expect(next.toISOString()).toBe('2026-07-31T09:00:00.000Z');
  });

  it('时分秒随 due 原样保留（不因月份加法被 Date mutator 顺带改写）', () => {
    const due = new Date('2026-05-15T23:59:59.000Z');
    const next = advanceDueDate(due, 'MONTHLY');
    expect(next.getUTCHours()).toBe(23);
    expect(next.getUTCMinutes()).toBe(59);
    expect(next.getUTCSeconds()).toBe(59);
  });
});
