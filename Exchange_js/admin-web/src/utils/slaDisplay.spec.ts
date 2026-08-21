import { formatSlaRemaining } from './slaDisplay';

describe('formatSlaRemaining', () => {
  it('无 deadline → 破折号', () => {
    expect(formatSlaRemaining(null, false)).toEqual({ text: '—', tone: 'none' });
  });

  it('slaBreached=true 优先于时间计算（软破线状态与 deadline 都不变）', () => {
    const future = new Date(Date.now() + 3 * 24 * 3600_000).toISOString();
    expect(formatSlaRemaining(future, true)).toEqual({ text: '已超时', tone: 'breached' });
  });

  it('deadline 已过 → 已超时', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(formatSlaRemaining(past, false).tone).toBe('breached');
  });

  it('三天后 → 2d 23h 量级', () => {
    // 刻意用 "3 天 - 10 秒" 而非整 3 天：两次 Date.now() 调用间隔通常 <1ms，
    // 若 deadline 恰好落在整天边界上，floor 结果会随执行速度在 "3d 0h" /
    // "2d 23h" 间抖动（本机上稳定复现前者）。偏移 10 秒远大于可能的执行抖动，
    // 让 floor 行为确定性地落在 2d 23h。
    const future = new Date(Date.now() + 3 * 24 * 3600_000 - 10_000).toISOString();
    const r = formatSlaRemaining(future, false);
    expect(r.tone).toBe('normal');
    expect(r.text).toMatch(/^2d 2[0-9]h$/);
  });

  it('五分钟内 → 分钟粒度', () => {
    const future = new Date(Date.now() + 4 * 60_000 + 30_000).toISOString();
    expect(formatSlaRemaining(future, false).text).toBe('4m');
  });
});
