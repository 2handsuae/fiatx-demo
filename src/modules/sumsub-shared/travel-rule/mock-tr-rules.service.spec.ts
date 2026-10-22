import { Logger } from '@nestjs/common';
import { MockTrRulesService } from './mock-tr-rules.service';

describe('MockTrRulesService.isTrApplicable — VARA TR 门槛（≥ 语义，漏配币种 warn 且不适用）', () => {
  let service: MockTrRulesService;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new MockTrRulesService({} as any);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warnSpy.mockRestore());

  it.each([
    ['USDT 999.99 低于线', 'USDT', 999.99, false],
    ['USDT 1000 正好等于线（≥）', 'USDT', 1000, true],
    ['USDT 1000.01 高于线', 'USDT', 1000.01, true],
    ['AED 3499 低于线', 'AED', 3499, false],
    ['AED 3500 正好等于线（≥）', 'AED', 3500, true],
    ['币种大小写不敏感', 'usdt', 1000, true],
  ])('%s', (_label, currency, amount, expected) => {
    expect(service.isTrApplicable(currency, amount)).toBe(expected);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('漏配币种（BTC）→ false 且 warn，不论金额多大', () => {
    expect(service.isTrApplicable('BTC', 1e9)).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('BTC');
  });
});

describe('MockTrRulesService.findKnownSource — 已知来源以查询代存储', () => {
  let service: MockTrRulesService;
  let findFirst: jest.Mock;

  beforeEach(() => {
    findFirst = jest.fn();
    service = new MockTrRulesService({ depositTransaction: { findFirst } } as any);
  });

  it('同客户 × 同址 × 已认领 → 返回最近一单 depositNo；where 实参逐键钉死', async () => {
    findFirst.mockResolvedValue({ depositNo: 'DEP10007' });

    await expect(service.findKnownSource('cust-uuid-1', 'TXabc0000')).resolves.toBe('DEP10007');

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({
      where: { ownerId: 'cust-uuid-1', fromAddress: 'TXabc0000', sourceClaimedAt: { not: null } },
      orderBy: { sourceClaimedAt: 'desc' },
      select: { depositNo: true },
    });
  });

  it('异客户 / 未认领（查无行）→ null', async () => {
    findFirst.mockResolvedValue(null);
    await expect(service.findKnownSource('cust-uuid-2', 'TXabc0000')).resolves.toBeNull();
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ ownerId: 'cust-uuid-2', sourceClaimedAt: { not: null } });
  });
});
