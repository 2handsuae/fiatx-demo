import { dubaiWindowStart } from './dubai-window.util';

describe('dubaiWindowStart', () => {
  it('UTC 21:00 已是迪拜次日 → 日窗起点 = 当天 20:00 UTC', () => {
    expect(dubaiWindowStart('DAILY', new Date('2026-07-15T21:30:00Z')).toISOString()).toBe('2026-07-15T20:00:00.000Z');
  });
  it('UTC 19:59 仍是迪拜当日 → 日窗起点 = 前一天 20:00 UTC', () => {
    expect(dubaiWindowStart('DAILY', new Date('2026-07-15T19:59:00Z')).toISOString()).toBe('2026-07-14T20:00:00.000Z');
  });
  it('月窗起点 = 迪拜当月 1 日 00:00 = 上月末 20:00 UTC', () => {
    expect(dubaiWindowStart('MONTHLY', new Date('2026-07-15T12:00:00Z')).toISOString()).toBe('2026-06-30T20:00:00.000Z');
  });
});
