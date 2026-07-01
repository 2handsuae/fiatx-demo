import { Prisma } from '@prisma/client';
import { InTransitService } from './in-transit.service';

describe('InTransitService', () => {
  let prisma: any;
  let source: any;
  let svc: InTransitService;
  beforeEach(() => {
    prisma = {
      withdrawTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    };
    // C4: in-transit reads funds_orders via FundsOrderSourceRepo (payin + internal in-transit views).
    source = {
      findPayinsInTransit: jest.fn().mockResolvedValue([]),
      findInternalsInTransit: jest.fn().mockResolvedValue([]),
    };
    svc = new InTransitService(prisma, source);
  });

  it('crypto: FUND_OUT in-transit adds to external adjustment', async () => {
    source.findInternalsInTransit.mockResolvedValue([
      { amount: new Prisma.Decimal('243.20') },
    ]);
    const adj = await svc.computeCrypto('USDT', 'asset-usdt', new Date('2026-06-17T00:00:00Z'));
    // ③ 内部转账在途：物理在路上、TB 未记 → 外部 +=（净额累加）
    expect(adj.toString()).toBe('243.2');
  });
});
