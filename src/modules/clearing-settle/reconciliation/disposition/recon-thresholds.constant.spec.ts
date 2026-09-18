import {
  RECON_AGING_DAYS, SMALL_AMOUNT_LINE_MINOR, isSmallAmount, computeAgingDeadline,
} from './recon-thresholds.constant';

describe('recon-thresholds —— 三条数字线写死代码（spec §2.7），改动走发版评审', () => {
  it('账龄线 3 天；小额线 AED 100.00 / USDT 30.000000，按币种索引', () => {
    expect(RECON_AGING_DAYS).toBe(3);
    expect(SMALL_AMOUNT_LINE_MINOR.AED).toBe(10_000n);
    expect(SMALL_AMOUNT_LINE_MINOR.USDT).toBe(30_000_000n);
  });
  it('isSmallAmount：等于小额线算小额（≤），超一分即大额', () => {
    expect(isSmallAmount('AED', 7n)).toBe(true);
    expect(isSmallAmount('AED', 10_000n)).toBe(true);
    expect(isSmallAmount('AED', 10_001n)).toBe(false);
    expect(isSmallAmount('USDT', 30_000_000n)).toBe(true);
    expect(isSmallAmount('USDT', 30_000_001n)).toBe(false);
  });
  it('未登记币种直接 throw，不兜底', () => {
    expect(() => isSmallAmount('BTC', 1n)).toThrow(/BTC/);
  });
  it('computeAgingDeadline = 业务日日终（UTC）+ 3 天', () => {
    expect(computeAgingDeadline('2026-09-01').toISOString()).toBe('2026-09-04T23:59:59.999Z');
  });
});
