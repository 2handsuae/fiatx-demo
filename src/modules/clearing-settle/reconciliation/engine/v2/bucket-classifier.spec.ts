import { computeBucket } from './bucket-classifier';

describe('computeBucket', () => {
  const cases: Array<[string, Parameters<typeof computeBucket>[0], string]> = [
    ['break: 残差非零（在途解释不干净）', { delta: -600n, inTransitSigned: -100n, inTransitCount: 1, anomalyCount: 3 }, 'BREAK'],
    ['break: 无在途且余额差非零', { delta: 500n, inTransitSigned: 0n, inTransitCount: 0, anomalyCount: 0 }, 'BREAK'],
    ['in-transit: 差额被在途完全解释', { delta: 500n, inTransitSigned: 500n, inTransitCount: 1, anomalyCount: 0 }, 'IN_TRANSIT'],
    ['in-transit: 对冲在途（差额0但有在途行）', { delta: 0n, inTransitSigned: 0n, inTransitCount: 2, anomalyCount: 0 }, 'IN_TRANSIT'],
    ['in-transit 优先于 compensating：残差0+在途+流水异常并存', { delta: 200n, inTransitSigned: 200n, inTransitCount: 1, anomalyCount: 1 }, 'IN_TRANSIT'],
    ['compensating: 余额平但流水脏', { delta: 0n, inTransitSigned: 0n, inTransitCount: 0, anomalyCount: 2 }, 'COMPENSATING'],
    ['matched: 全净', { delta: 0n, inTransitSigned: 0n, inTransitCount: 0, anomalyCount: 0 }, 'MATCHED'],
  ];
  it.each(cases)('%s', (_name, input, want) => {
    expect(computeBucket(input)).toBe(want);
  });

  // 期望值由**独立的**判定函数算出——规则抄自 modules/v8-recon.md §1「差异分桶，命中即止」，
  // 不是从 computeBucket 复制的实现。两边各写一遍，改了任何一边网格就红：这正是本断言的作用。
  // （旧写法 `expect(buckets.has(b)).toBe(true)` 在 TS 下恒真——computeBucket 的返回类型
  //  就是那 4 个字面量的联合、每条分支都返回字面量，它不可能红。）
  const expectedBucket = (i: Parameters<typeof computeBucket>[0]): string => {
    const residual = i.delta - i.inTransitSigned;
    if (residual !== 0n) return 'BREAK';
    if (i.inTransitCount > 0) return 'IN_TRANSIT';
    if (i.anomalyCount > 0) return 'COMPENSATING';
    return 'MATCHED';
  };

  it('180 组确定性网格：逐组落到期望的那一个桶', () => {
    const deltas = [-600n, -100n, 0n, 1n, 500n];
    const transits = [-600n, -100n, 0n, 500n];
    const counts = [0, 1, 2];
    let checked = 0;
    for (const delta of deltas)
      for (const inTransitSigned of transits)
        for (const inTransitCount of counts)
          for (const anomalyCount of counts) {
            const input = { delta, inTransitSigned, inTransitCount, anomalyCount };
            expect(computeBucket(input)).toBe(expectedBucket(input));
            checked += 1;
          }
    expect(checked).toBe(180);
  });
});
