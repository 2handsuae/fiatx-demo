import { effectiveCutoffFilter } from './effective-cutoff';

describe('effectiveCutoffFilter', () => {
  it('builds the two-branch OR filter: back-valued days all-in, cutoff day gated by physical instant', () => {
    const cutoff = new Date('2026-06-26T12:00:00Z');
    expect(effectiveCutoffFilter(cutoff)).toEqual({
      OR: [
        { effectiveDate: { lt: '2026-06-26' } },
        { effectiveDate: '2026-06-26', createdAt: { lte: cutoff } },
      ],
    });
  });
});
