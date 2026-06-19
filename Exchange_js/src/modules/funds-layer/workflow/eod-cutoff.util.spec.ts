import { resolveEodCutoff } from './eod-cutoff.util';

describe('resolveEodCutoff', () => {
  // Asia/Dubai = UTC+4 year-round (no DST). cutoff = start of the run-day in Dubai,
  // expressed as the equivalent UTC instant.

  it('00:30 Dubai run → cutoff is that day 00:00 Dubai (UTC 20:00 previous day)', () => {
    // 2026-06-18 00:30 Dubai == 2026-06-17T20:30:00Z
    const now = new Date('2026-06-17T20:30:00.000Z');
    expect(resolveEodCutoff(now).toISOString()).toBe('2026-06-17T20:00:00.000Z');
  });

  it('late-evening Dubai time still floors to the same Dubai midnight', () => {
    // 2026-06-18 23:45 Dubai == 2026-06-18T19:45:00Z
    const now = new Date('2026-06-18T19:45:00.000Z');
    expect(resolveEodCutoff(now).toISOString()).toBe('2026-06-17T20:00:00.000Z');
  });

  it('exactly at Dubai midnight → cutoff equals that instant', () => {
    // 2026-06-18 00:00 Dubai == 2026-06-17T20:00:00Z
    const now = new Date('2026-06-17T20:00:00.000Z');
    expect(resolveEodCutoff(now).toISOString()).toBe('2026-06-17T20:00:00.000Z');
  });

  it('one ms before Dubai midnight → cutoff is the previous Dubai midnight', () => {
    // 2026-06-17 23:59:59.999 Dubai == 2026-06-17T19:59:59.999Z
    const now = new Date('2026-06-17T19:59:59.999Z');
    expect(resolveEodCutoff(now).toISOString()).toBe('2026-06-16T20:00:00.000Z');
  });
});
