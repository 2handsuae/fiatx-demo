import { computeBucket } from './bucket-classifier';

describe('computeBucket', () => {
  const cases: Array<[string, Parameters<typeof computeBucket>[0], string]> = [
    ['break: 残差非零（在途解释不干净）', { delta: -600n, inTransitSigned: -100n, inTransitCount: 1, anomalyCount: 3 }, 'BREAK'],
    ['break: 无在途且余额差非零', { delta: 500n, inTransitSigned: 0n, inTransitCount: 0, anomalyCount: 0 }, 'BREAK'],
    ['in-transit: 差额被在途完全解释', { delta: 500n, inTransitSigned: 500n, inTransitCount: 1, anomalyCount: 0 }, 'IN_TRANSIT'],
    ['in-transit: 对冲在途（差额0但有在途行）', { delta: 0n, inTransitSigned: 0n, inTransitCount: 2, anomalyCount: 0 }, 'IN_TRANSIT'],
    ['in-transit 优先于 soft-flag：残差0+在途+流水异常并存', { delta: 200n, inTransitSigned: 200n, inTransitCount: 1, anomalyCount: 1 }, 'IN_TRANSIT'],
    ['soft-flag: 余额平但流水脏', { delta: 0n, inTransitSigned: 0n, inTransitCount: 0, anomalyCount: 2 }, 'SOFT_FLAG'],
    ['matched: 全净', { delta: 0n, inTransitSigned: 0n, inTransitCount: 0, anomalyCount: 0 }, 'MATCHED'],
  ];
  it.each(cases)('%s', (_name, input, want) => {
    expect(computeBucket(input)).toBe(want);
  });

  it('恒等式：任意输入必落且只落一桶', () => {
    const buckets = new Set(['MATCHED', 'IN_TRANSIT', 'SOFT_FLAG', 'BREAK']);
    // 确定性穷举网格（不用 Math.random，保证可复现）：
    const deltas = [-600n, -100n, 0n, 1n, 500n];
    const transits = [-600n, -100n, 0n, 500n];
    const counts = [0, 1, 2];
    for (const delta of deltas)
      for (const inTransitSigned of transits)
        for (const inTransitCount of counts)
          for (const anomalyCount of counts) {
            const b = computeBucket({ delta, inTransitSigned, inTransitCount, anomalyCount });
            expect(buckets.has(b)).toBe(true);
          }
  });
});
