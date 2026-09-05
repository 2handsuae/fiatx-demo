import { describe, it, expect } from 'vitest';
import { formatCountdown } from './countdown';

describe('formatCountdown（站 5 ④ 倒计时走秒）', () => {
  const activatesAt = '2026-09-06T00:00:00.000Z';
  it('now 推进 1 秒，显示减 1 秒', () => {
    const t0 = new Date('2026-09-05T23:00:00.000Z').getTime();
    expect(formatCountdown(activatesAt, t0)).toBe('1h 0m 0s');
    expect(formatCountdown(activatesAt, t0 + 1000)).toBe('0h 59m 59s');
  });
  it('到期后钉在 0', () => {
    expect(formatCountdown(activatesAt, new Date('2026-09-06T00:00:01.000Z').getTime())).toBe('0h 0m 0s');
  });
});
