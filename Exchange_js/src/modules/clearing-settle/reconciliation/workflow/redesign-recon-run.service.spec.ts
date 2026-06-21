import { Prisma } from '@prisma/client';
import { RedesignReconRunService } from './redesign-recon-run.service';

const D = (n: string | number) => new Prisma.Decimal(n);

/** Minimal FormulaReconCurrencyResult stub — all 5 formulas PASS, no break. */
const makeFormulaResult = (currency = 'AED') => ({
  currency,
  assetId: `a-${currency.toLowerCase()}`,
  layer: 'FIAT' as const,
  cn: {},
  results: [
    { formula: '式1', status: 'PASS', lhs: D(0), rhs: D(0), delta: D(0) },
    { formula: '式2', status: 'PASS', lhs: D(0), rhs: D(0), delta: D(0) },
    { formula: '式3', status: 'PASS', lhs: D(0), rhs: D(0), delta: D(0) },
    { formula: '式4', status: 'PASS', lhs: D(0), rhs: D(0), delta: D(0) },
    { formula: '式5', status: 'PASS', lhs: D(0), rhs: D(0), delta: D(0) },
  ],
});

/** Minimal DrilldownResult stub — no breaks. */
const makeDrilldown = () => ({
  currency: 'AED',
  classified: {
    summary: { amountMismatch: 0, orphanInternal: 0, orphanExternal: 0, manual: 0, pass: 0, internalBookLeg: 0 },
    amountMismatch: [],
    orphanInternal: [],
    orphanExternal: [],
    manual: [],
    pass: [],
    internalBookLeg: [],
  },
});

describe('RedesignReconRunService', () => {
  let service: RedesignReconRunService;
  let deps: any;

  beforeEach(() => {
    deps = {
      prisma: {
        $transaction: jest.fn((cb: any) => cb(deps.prisma)),
        reconciliationCase: { update: jest.fn() },
      },
      formulaRecon: {
        runFormulas: jest.fn().mockResolvedValue([makeFormulaResult()]),
      },
      drilldown: {
        run: jest.fn().mockResolvedValue(makeDrilldown()),
      },
      runSvc: {
        createRun: jest.fn().mockResolvedValue({ id: 'run-1', runNo: 'RUN-20260621-REDESIGN-1', traceId: 'V8:REDESIGN:20260621' }),
        finish: jest.fn().mockResolvedValue({}),
      },
      caseSvc: {
        upsertOpen: jest.fn(),
      },
      recordSvc: {
        saveFormulaChecks: jest.fn().mockResolvedValue(undefined),
        saveBucketedLineItems: jest.fn().mockResolvedValue(undefined),
      },
      audit: {
        recordSystem: jest.fn().mockResolvedValue(undefined),
      },
    };

    service = new RedesignReconRunService(
      deps.prisma,
      deps.formulaRecon,
      deps.drilldown,
      deps.runSvc,
      deps.caseSvc,
      deps.recordSvc,
      deps.audit,
    );
  });

  it('APPLY persists demoManifest JSON on the created run when provided', async () => {
    const manifest = { generatedAt: 'x', breaks: [{ currency: 'AED' }] };
    await service.run({
      businessDate: '2026-06-21',
      triggerType: 'MANUAL',
      mode: 'APPLY',
      demoManifest: manifest,
    } as any);
    expect(deps.runSvc.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ demoManifest: JSON.stringify(manifest) }),
    );
  });

  it('APPLY without demoManifest sets demoManifest null', async () => {
    await service.run({
      businessDate: '2026-06-21',
      triggerType: 'MANUAL',
      mode: 'APPLY',
    } as any);
    expect(deps.runSvc.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ demoManifest: null }),
    );
  });

  it('DRY_RUN does not call createRun', async () => {
    const res = await service.run({
      businessDate: '2026-06-21',
      triggerType: 'MANUAL',
      mode: 'DRY_RUN',
    });
    expect(deps.runSvc.createRun).not.toHaveBeenCalled();
    expect(res.runNo).toBe('(dry-run)');
  });
});
