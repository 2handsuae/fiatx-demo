import { effectiveCutoffFilter } from './effective-cutoff';

/** 把过滤式当谓词跑一遍——比断言对象形状更能说明"哪些分录进得来"。 */
function admits(cutoff: Date, row: { effectiveDate: string; createdAt: Date }): boolean {
  const f = effectiveCutoffFilter(cutoff) as any;
  return f.OR.some((c: any) => {
    if (c.effectiveDate?.lt !== undefined) return row.effectiveDate < c.effectiveDate.lt;
    if (row.effectiveDate !== c.effectiveDate) return false;
    if (c.createdAt?.lte) return row.createdAt <= c.createdAt.lte;
    if (c.createdAt?.gt) return row.createdAt > c.createdAt.gt;
    return true;
  });
}

describe('effectiveCutoffFilter', () => {
  it('三支形状：更早业务日全进 / 同日按物理时刻卡 / 同日回填全进', () => {
    const cutoff = new Date('2026-06-26T12:00:00Z');
    expect(effectiveCutoffFilter(cutoff)).toEqual({
      OR: [
        { effectiveDate: { lt: '2026-06-26' } },
        { effectiveDate: '2026-06-26', createdAt: { lte: cutoff } },
        { effectiveDate: '2026-06-26', createdAt: { gt: new Date('2026-06-26T19:59:59.999Z') } },
      ],
    });
  });

  const cutoff = new Date('2026-06-26T12:00:00Z');

  it('更早业务日的分录：进', () => {
    expect(admits(cutoff, { effectiveDate: '2026-06-25', createdAt: new Date('2026-06-25T09:00:00Z') })).toBe(true);
  });

  it('同日、截止时刻之前写的：进', () => {
    expect(admits(cutoff, { effectiveDate: '2026-06-26', createdAt: new Date('2026-06-26T01:00:00Z') })).toBe(true);
  });

  it('同日、截止时刻之后当天写的：不进（日内精度）', () => {
    expect(admits(cutoff, { effectiveDate: '2026-06-26', createdAt: new Date('2026-06-26T13:00:00Z') })).toBe(false);
  });

  it('同日、事后回填（写入时刻越过该业务日日终）：进', () => {
    // 平账回填的形状：8-29 开的调账单，生效日回写到案件业务日。这一条是 2026-08-29
    // 补的——此前它被挡在外面，于是调账单落了账、重跑对账内部余额一分没动，
    // 差额永远归不了零，案子永远平不掉。
    expect(admits(cutoff, { effectiveDate: '2026-06-26', createdAt: new Date('2026-06-28T10:00:00Z') })).toBe(true);
  });

  it('更晚业务日的分录：不进', () => {
    expect(admits(cutoff, { effectiveDate: '2026-06-27', createdAt: new Date('2026-06-27T01:00:00Z') })).toBe(false);
  });
});
