import { Prisma } from '@prisma/client';
import { ReconciliationRunWorkflowService } from './reconciliation-run-workflow.service';

const D = (n: string | number) => new Prisma.Decimal(n);

describe('ReconciliationRunWorkflowService', () => {
  let deps: any;
  let wf: ReconciliationRunWorkflowService;
  beforeEach(() => {
    deps = {
      prisma: { $transaction: jest.fn((cb) => cb(deps.prisma)), settlementBatch: { findFirst: jest.fn().mockResolvedValue({ status: 'COMPLETED' }) }, asset: { findMany: jest.fn().mockResolvedValue([{ id: 'a-usdt', currency: 'USDT', type: 'CRYPTO' }]) } },
      snapshot: { balancesAtCutoff: jest.fn().mockResolvedValue({ 'A.CLIENT_CUSTODY': D('1794.150136'), 'L.CLIENT_PAYABLE': D('1395.720136'), 'L.DEPOSIT_SUSPENSE': D('398.43'), 'L.TRADE_CLEARING': D('0'), 'A.FX_POSITION': D('0'), 'R.FX_UNREALIZED_PNL': D('0') }) },
      invariants: { check: jest.fn().mockReturnValue([]) },
      inTransit: { computeCrypto: jest.fn().mockResolvedValue(D('243.20')), computeFiat: jest.fn() },
      balanceProvider: { balanceAt: jest.fn().mockResolvedValue(D('1550.950136')) },
      txProvider: { txsForDate: jest.fn().mockResolvedValue([]) },
      balanceRecon: { computeI5: jest.fn().mockReturnValue({ invariantCode: 'I5', currency: 'USDT', tbAmount: D('1794.150136'), externalAmount: D('1550.950136'), inTransitAmount: D('243.20'), expectedExternal: D('1794.150136'), delta: D('0'), status: 'PASS', severity: 'ACCOUNT_ACTUAL' }) },
      matchEngine: { match: jest.fn().mockReturnValue({ matched: [], amountMismatch: [], orphanInternal: [], orphanExternal: [] }) },
      classifier: { classify: jest.fn().mockReturnValue([]) },
      internalActions: { collect: jest.fn().mockResolvedValue([]) },
      runSvc: { createRun: jest.fn().mockResolvedValue({ id: 'r1', runNo: 'RUN-20260616-CRYPTO-1' }), finish: jest.fn() },
      caseSvc: { upsertOpen: jest.fn() },
      recordSvc: { saveInvariantCheck: jest.fn(), saveLineItems: jest.fn() },
      audit: { recordSystem: jest.fn() },
    };
    wf = new ReconciliationRunWorkflowService(
      deps.prisma, deps.snapshot, deps.invariants, deps.inTransit, deps.balanceProvider,
      deps.txProvider, deps.balanceRecon, deps.matchEngine, deps.classifier, deps.internalActions,
      deps.runSvc, deps.caseSvc, deps.recordSvc, deps.audit,
    );
  });

  it('DRY_RUN: computes result but does not persist case/line-items', async () => {
    const res = await wf.run({ businessDate: '2026-06-16', layer: 'CRYPTO', triggerType: 'MANUAL', mode: 'DRY_RUN' });
    expect(res.cases[0].delta.toString()).toBe('0');
    expect(deps.caseSvc.upsertOpen).not.toHaveBeenCalled();
    expect(deps.recordSvc.saveLineItems).not.toHaveBeenCalled();
    // spec §6.3: DRY_RUN 0 落库 —— 连 run 行都不创建
    expect(deps.runSvc.createRun).not.toHaveBeenCalled();
    expect(res.runNo).toBe('(dry-run)');
  });
});
