import { Prisma } from '@prisma/client';
import { ReconciliationCaseService } from './reconciliation-case.service';

const D = (n: string | number) => new Prisma.Decimal(n);

describe('ReconciliationCaseService', () => {
  let prisma: any;
  let svc: ReconciliationCaseService;
  beforeEach(() => {
    prisma = {
      reconciliationCase: {
        findFirst: jest.fn().mockResolvedValue(null),
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
    expect(c.book).toBeNull(); // legacy (no book) → book=null, no caseNo suffix
  });

  it('upsertOpen tags book + adds C/F suffix to caseNo for per-book cases', async () => {
    const client = await svc.upsertOpen({
      businessDate: '2026-06-16', assetId: 'a-aed', assetCode: 'AED', layer: 'FIAT', book: 'CLIENT',
      tbAmount: D('0'), inTransitAmount: D('0'), expectedExternal: D('0'), actualExternal: D('0'), deltaAmount: D('5'),
      openedByRunId: 'r1',
    });
    expect(client.caseNo).toBe('REC-20260616-AED-C-001');
    expect(client.book).toBe('CLIENT');

    prisma.reconciliationCase.count.mockResolvedValueOnce(1);
    const firm = await svc.upsertOpen({
      businessDate: '2026-06-16', assetId: 'a-aed', assetCode: 'AED', layer: 'FIAT', book: 'FIRM',
      tbAmount: D('0'), inTransitAmount: D('0'), expectedExternal: D('0'), actualExternal: D('0'), deltaAmount: D('7'),
      openedByRunId: 'r1',
    });
    expect(firm.caseNo).toBe('REC-20260616-AED-F-002');
    expect(firm.book).toBe('FIRM');
  });

  it('upsertOpen looks up existing by (businessDate, assetId, book)', async () => {
    await svc.upsertOpen({
      businessDate: '2026-06-16', assetId: 'a-aed', assetCode: 'AED', layer: 'FIAT', book: 'FIRM',
      tbAmount: D('0'), inTransitAmount: D('0'), expectedExternal: D('0'), actualExternal: D('0'), deltaAmount: D('7'),
      openedByRunId: 'r1',
    });
    expect(prisma.reconciliationCase.findFirst).toHaveBeenCalledWith({
      where: { businessDate: '2026-06-16', assetId: 'a-aed', book: 'FIRM' },
    });
  });
});
