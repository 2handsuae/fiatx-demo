import { ReconciliationRunService } from './reconciliation-run.service';

describe('ReconciliationRunService', () => {
  let prisma: any;
  let svc: ReconciliationRunService;
  beforeEach(() => {
    prisma = {
      reconciliationRun: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'r1', ...data })),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'r1', ...data })),
      },
    };
    svc = new ReconciliationRunService(prisma);
  });
  it('createRun computes seq and runNo', async () => {
    prisma.reconciliationRun.count.mockResolvedValue(1); // 当天已有 1 次 → seq 2
    const run = await svc.createRun({ businessDate: '2026-06-16', layer: 'CRYPTO', triggerType: 'POST_FIX', mode: 'APPLY' });
    expect(run.seq).toBe(2);
    expect(run.runNo).toBe('RUN-20260616-CRYPTO-2');
  });

  describe('traceId format', () => {
    it('mints UUID v4 traceId at run creation (no business-field embedding)', async () => {
      const run = await svc.createRun({ layer: 'CLIENT', businessDate: '2026-06-28', triggerType: 'POST_FIX', mode: 'APPLY' });
      expect(run.traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(run.traceId).not.toMatch(/^V8:/);
    });
  });
});
