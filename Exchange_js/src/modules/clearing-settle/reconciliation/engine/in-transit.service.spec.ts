import { Prisma } from '@prisma/client';
import { InTransitService } from './in-transit.service';

describe('InTransitService', () => {
  let prisma: any;
  let svc: InTransitService;
  beforeEach(() => {
    prisma = {
      internalFund: { findMany: jest.fn().mockResolvedValue([]) },
      payin: { findMany: jest.fn().mockResolvedValue([]) },
      withdrawTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    };
    svc = new InTransitService(prisma);
  });

  it('crypto: FUND_OUT CREATED adds to external adjustment', async () => {
    prisma.internalFund.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal('243.20'), status: 'CREATED' },
    ]);
    const adj = await svc.computeCrypto('USDT', 'asset-usdt', new Date('2026-06-17T00:00:00Z'));
    // ③ 内部转账在途：物理在路上、TB 未记 → 外部 +=（净额累加）
    expect(adj.toString()).toBe('243.2');
  });
});
