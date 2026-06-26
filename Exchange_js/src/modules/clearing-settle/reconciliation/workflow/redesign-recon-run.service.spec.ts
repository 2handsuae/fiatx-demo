import { Logger } from '@nestjs/common';
import { RedesignReconRunService } from './redesign-recon-run.service';

/**
 * T9 (Phase B, 2026-06-26): RedesignReconRunService is now a deprecation shim that delegates `run()` to
 * WalletReconRunService. The original V8 five-formula assertions (createRun on runSvc, demoManifest JSON
 * on the V8 run row) are obsolete — the legacy collaborators are no longer touched. These tests verify
 * the delegation, the legacy DRY_RUN contract (0 落库, stub envelope), and the deprecation warning.
 */
describe('RedesignReconRunService (T9 wallet-engine delegation shim)', () => {
  let service: RedesignReconRunService;
  let deps: any;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    deps = {
      prisma: {
        // Used by the shim to re-read the run row after delegation, so it can recover `runNo`.
        reconciliationRun: {
          findUnique: jest.fn().mockResolvedValue({ runNo: 'RUN-20260621-WALLET-1' }),
        },
      },
      // Legacy V8 collaborators — still injected for DI-graph stability, never invoked by the shim.
      formulaRecon: { runFormulas: jest.fn() },
      drilldown: { run: jest.fn() },
      runSvc: { createRun: jest.fn(), finish: jest.fn() },
      caseSvc: { upsertOpen: jest.fn() },
      recordSvc: { saveFormulaChecks: jest.fn(), saveBucketedLineItems: jest.fn() },
      audit: { recordSystem: jest.fn() },
      // The new collaborator the shim actually calls.
      walletReconRun: {
        run: jest.fn().mockResolvedValue({
          runId: 'wallet-run-1',
          status: 'PASS',
          walletsChecked: 3,
          casesOpened: 0,
          orphanInternal: 0,
          orphanExternal: 0,
          mismatch: 0,
        }),
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
      deps.walletReconRun,
    );

    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('APPLY delegates to WalletReconRunService and returns runNo from the persisted run row (engineVersion stamped WALLET_V1 by the wallet engine)', async () => {
    const manifest = { generatedAt: 'x', breaks: [{ currency: 'AED' }] };
    const res = await service.run({
      businessDate: '2026-06-21',
      triggerType: 'MANUAL',
      mode: 'APPLY',
      demoManifest: manifest,
    } as any);

    // Legacy V8 collaborators must NOT be invoked.
    expect(deps.runSvc.createRun).not.toHaveBeenCalled();
    expect(deps.formulaRecon.runFormulas).not.toHaveBeenCalled();
    expect(deps.drilldown.run).not.toHaveBeenCalled();

    // Wallet engine IS invoked. We pass cutoff = D+1 00:00 UTC and forward the manifest verbatim.
    expect(deps.walletReconRun.run).toHaveBeenCalledTimes(1);
    const [callArg] = deps.walletReconRun.run.mock.calls[0];
    expect(callArg.cutoff).toBeInstanceOf(Date);
    expect(callArg.cutoff.toISOString()).toBe('2026-06-22T00:00:00.000Z');
    expect(callArg.manifest).toBe(manifest);

    // The shim re-reads the run row and surfaces its runNo in the legacy envelope.
    expect(deps.prisma.reconciliationRun.findUnique).toHaveBeenCalledWith({
      where: { id: 'wallet-run-1' },
      select: { runNo: true },
    });
    expect(res).toEqual({
      runNo: 'RUN-20260621-WALLET-1',
      mode: 'APPLY',
      businessDate: '2026-06-21',
      currencies: [],
      openedCount: 0,
    });
  });

  it('APPLY without demoManifest still delegates (manifest forwarded as undefined)', async () => {
    await service.run({
      businessDate: '2026-06-21',
      triggerType: 'MANUAL',
      mode: 'APPLY',
    } as any);
    expect(deps.walletReconRun.run).toHaveBeenCalledTimes(1);
    expect(deps.walletReconRun.run.mock.calls[0][0].manifest).toBeUndefined();
  });

  it('APPLY propagates casesOpened from the wallet engine into the legacy openedCount slot', async () => {
    deps.walletReconRun.run.mockResolvedValueOnce({
      runId: 'wallet-run-2',
      status: 'BREAK',
      walletsChecked: 5,
      casesOpened: 3,
      orphanInternal: 1,
      orphanExternal: 1,
      mismatch: 1,
    });
    const res = await service.run({
      businessDate: '2026-06-21',
      triggerType: 'MANUAL',
      mode: 'APPLY',
    } as any);
    expect(res.openedCount).toBe(3);
  });

  it('DRY_RUN short-circuits before delegation and returns the legacy stub envelope (0 落库)', async () => {
    const res = await service.run({
      businessDate: '2026-06-21',
      triggerType: 'MANUAL',
      mode: 'DRY_RUN',
    });
    expect(deps.walletReconRun.run).not.toHaveBeenCalled();
    expect(deps.runSvc.createRun).not.toHaveBeenCalled();
    expect(res.runNo).toBe('(dry-run)');
    expect(res.currencies).toEqual([]);
    expect(res.openedCount).toBe(0);
  });

  it('logs a deprecation warning every time run() is called', async () => {
    await service.run({
      businessDate: '2026-06-21',
      triggerType: 'MANUAL',
      mode: 'APPLY',
    } as any);
    // At least one warn call from RedesignReconRunService should mention the V8-deprecated marker.
    const deprecationCalls = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes('[V8 deprecated] RedesignReconRunService.run'),
    );
    expect(deprecationCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('uses cutoffDateForExternal when provided instead of businessDate', async () => {
    await service.run({
      businessDate: '2026-06-21',
      cutoffDateForExternal: '2026-06-25',
      triggerType: 'MANUAL',
      mode: 'APPLY',
    } as any);
    const cutoffArg = deps.walletReconRun.run.mock.calls[0][0].cutoff as Date;
    expect(cutoffArg.toISOString()).toBe('2026-06-26T00:00:00.000Z');
  });
});
