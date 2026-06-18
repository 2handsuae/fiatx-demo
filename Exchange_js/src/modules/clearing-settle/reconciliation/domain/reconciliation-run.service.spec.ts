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
});
