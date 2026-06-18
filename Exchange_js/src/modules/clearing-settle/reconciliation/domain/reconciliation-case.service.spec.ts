import { Prisma } from '@prisma/client';
import { ReconciliationCaseService } from './reconciliation-case.service';

const D = (n: string | number) => new Prisma.Decimal(n);

describe('ReconciliationCaseService', () => {
  let prisma: any;
  let svc: ReconciliationCaseService;
  beforeEach(() => {
    prisma = {
      reconciliationCase: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'c1', ...data })),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'c1', ...data })),
      },
    };
    svc = new ReconciliationCaseService(prisma);
  });
  it('upsertOpen creates a new OPEN case with caseNo when none exists', async () => {
    const c = await svc.upsertOpen({
      businessDate: '2026-06-16', assetId: 'a-usdt', assetCode: 'USDT', layer: 'CRYPTO',
      tbAmount: D('1794.150136'), inTransitAmount: D('243.20'),
      expectedExternal: D('1444.150136'), actualExternal: D('1200.950136'), deltaAmount: D('350'),
      openedByRunId: 'r1',
    });
    expect(c.caseNo).toBe('REC-20260616-USDT-001');
    expect(c.status).toBe('OPEN');
  });
});
