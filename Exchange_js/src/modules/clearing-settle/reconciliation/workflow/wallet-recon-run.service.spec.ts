// Phase B / T7: WalletReconRunService unit tests (TDD).
//
// Orchestrates the per-wallet engine:
//   1. Internal-identity pre-gate (sum payable+suspense == sum client_asset, etc.)
//   2. Per-wallet balance + flow checks (T6 + flow matcher)
//   3. Cross-wallet same-externalRef invariant (e.g. WITHDRAW_FEE_POST +
//      WITHDRAW_FEE_FIRM must have equal amounts)
//   4. Summarize → ReconciliationRun row (layer='WALLET').

import { Prisma } from '@prisma/client';
import { WalletReconRunService } from './wallet-recon-run.service';

const D = (n: string | number) => new Prisma.Decimal(n);

function makeDeps(overrides: any = {}) {
  // ── Identity-pre-gate inputs ──
  // accountFlow.groupBy is the cheapest way to sum amount per (tbAccountId, direction);
  // here we mock the higher-level call we'll add: a method that returns the per-code
  // aggregate. For test isolation we stub it directly via internalIdentity() spy.
  const reconciliationRun = {
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  };
  const reconciliationCase = {
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(async ({ data }: any) => ({ id: `case-${Math.random().toString(36).slice(2, 8)}`, ...data })),
    update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
  };
  // T2 upsert deletes prior line items before re-inserting the current run's
  // findings; auto-heal also looks at findMany / update on cases. Default mocks
  // here so individual tests don't need to wire them.
  const reconciliationLineItem = { create: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() };
  const externalBalance = { findMany: jest.fn().mockResolvedValue([]) };
  const externalStatementLine = { findMany: jest.fn().mockResolvedValue([]) };
  const accountFlow = {
    groupBy: jest.fn().mockResolvedValue([]),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const tbAccountRegistry = { findMany: jest.fn().mockResolvedValue([]) };

  const prisma: any = {
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
    reconciliationRun,
    reconciliationCase,
    reconciliationLineItem,
    externalBalance,
    externalStatementLine,
    accountFlow,
    tbAccountRegistry,
  };

  const balanceChecker = {
    checkBalance: jest.fn().mockResolvedValue({
      pass: true,
      walletRef: 'w-default',
      walletKind: 'CUSTOMER',
      coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
      ownerNo: 'c-default',
      internal: { payable: 0n, suspense: 0n, total: 0n },
      external: 0n,
      delta: 0n,
    }),
  };
  const flowMatcher = {
    matchFlows: jest.fn().mockResolvedValue({
      matched: [], orphanInternal: [], orphanExternal: [], mismatch: [],
    }),
  };
  const tigerBeetle = {
    lookupAccounts: jest.fn().mockResolvedValue([]),
  };

  Object.assign(prisma, overrides.prisma ?? {});
  if (overrides.balanceChecker) Object.assign(balanceChecker, overrides.balanceChecker);
  if (overrides.flowMatcher) Object.assign(flowMatcher, overrides.flowMatcher);
  if (overrides.tigerBeetle) Object.assign(tigerBeetle, overrides.tigerBeetle);

  // Default identity-pre-gate: balanced (asset == liab, asset == equity).
  // Tests stub computeInternalIdentity directly on the service to bypass
  // TB lookup entirely; tigerBeetle mock is only there to satisfy DI.
  return { prisma, balanceChecker, flowMatcher, tigerBeetle };
}

describe('WalletReconRunService', () => {
  const cutoff = new Date('2026-06-26T23:59:59Z');

  it('internal balanced + no wallets to check → run.status=PASS, walletsChecked=0', async () => {
    const deps = makeDeps();
    deps.prisma.reconciliationRun.create.mockResolvedValue({
      id: 'run-1', runNo: 'RUN-WALLET-1',
    });
    deps.prisma.externalBalance.findMany.mockResolvedValue([]); // no wallets

    const svc = new WalletReconRunService(deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any);
    // Stub identity pre-gate to balanced.
    (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });

    const result = await svc.run({ cutoff });

    expect(result.status).toBe('PASS');
    expect(result.walletsChecked).toBe(0);
    expect(result.casesOpened).toBe(0);
    expect(deps.prisma.reconciliationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ layer: 'WALLET' }),
      }),
    );
  });

  it('internal NOT balanced → status=INTERNAL_BREAK, no per-wallet processing', async () => {
    const deps = makeDeps();
    deps.prisma.reconciliationRun.create.mockResolvedValue({
      id: 'run-2', runNo: 'RUN-WALLET-2',
    });

    const svc = new WalletReconRunService(deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any);
    (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({
      balanced: false,
      breaks: [{ ledger: 1, side: 'CLIENT', asset: '1000', liab: '900', delta: '100' }],
    });

    const result = await svc.run({ cutoff });

    expect(result.status).toBe('INTERNAL_BREAK');
    expect(result.walletsChecked).toBe(0);
    expect(deps.balanceChecker.checkBalance).not.toHaveBeenCalled();
    expect(deps.flowMatcher.matchFlows).not.toHaveBeenCalled();
  });

  it('one wallet balance mismatch → 1 case opened, status=BREAK', async () => {
    const deps = makeDeps();
    deps.prisma.reconciliationRun.create.mockResolvedValue({
      id: 'run-3', runNo: 'RUN-WALLET-3',
    });
    deps.prisma.externalBalance.findMany.mockResolvedValue([
      { walletRef: 'w-cust-1', closingBalance: D(1000), book: 'CLIENT', currency: 'USDT', accountRef: 'acc-1' },
    ]);
    // Asset lookup for case
    deps.prisma.externalStatementLine.findMany.mockResolvedValue([]);

    deps.balanceChecker.checkBalance.mockResolvedValue({
      pass: false,
      walletRef: 'w-cust-1',
      walletKind: 'CUSTOMER',
      coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
      ownerNo: 'c-001',
      internal: { payable: 800n, suspense: 100n, total: 900n },
      external: 1000n,
      delta: 100n,
    });

    const svc = new WalletReconRunService(deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any);
    (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
    (svc as any).resolveAssetId = jest.fn().mockResolvedValue('a-usdt');

    const result = await svc.run({ cutoff });

    expect(result.status).toBe('BREAK');
    expect(result.walletsChecked).toBe(1);
    expect(result.casesOpened).toBeGreaterThanOrEqual(1);
    expect(deps.prisma.reconciliationCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          walletRef: 'w-cust-1',
          coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
          ownerNo: 'c-001',
          book: 'CUSTOMER',
        }),
      }),
    );
  });

  it('wallet has flow orphan_internal → case opened with line items', async () => {
    const deps = makeDeps();
    deps.prisma.reconciliationRun.create.mockResolvedValue({
      id: 'run-4', runNo: 'RUN-WALLET-4',
    });
    deps.prisma.externalBalance.findMany.mockResolvedValue([
      { walletRef: 'w-cust-2', closingBalance: D(0), book: 'CLIENT', currency: 'USDT', accountRef: 'acc-2' },
    ]);
    // Balance passes — but flow has an orphan
    deps.balanceChecker.checkBalance.mockResolvedValue({
      pass: true,
      walletRef: 'w-cust-2', walletKind: 'CUSTOMER', coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
      ownerNo: 'c-002', internal: { total: 0n }, external: 0n, delta: 0n,
    });
    deps.flowMatcher.matchFlows.mockResolvedValue({
      matched: [],
      orphanInternal: [
        { internalFlowId: 'flow-x', eventCode: 'DEPOSIT_CONFIRMED', amount: '500', direction: 'IN', externalRef: '0xabc' },
      ],
      orphanExternal: [],
      mismatch: [],
    });

    const svc = new WalletReconRunService(deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any);
    (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
    (svc as any).resolveAssetId = jest.fn().mockResolvedValue('a-usdt');

    const result = await svc.run({ cutoff });

    expect(result.status).toBe('BREAK');
    expect(result.orphanInternal).toBe(1);
    expect(result.casesOpened).toBeGreaterThanOrEqual(1);
    expect(deps.prisma.reconciliationLineItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matchStatus: 'ORPHAN_INTERNAL',
          walletRef: 'w-cust-2',
          externalRef: '0xabc',
        }),
      }),
    );
  });

  // (removed) "cross-wallet same-ref invariant" test — feature retired. The
  // old algorithm produced false-positive CROSS_REF cases by grouping flows
  // naively per externalRef without netting same-wallet two-leg projections
  // (e.g. WITHDRAW_NET_POST debit+credit both landing on the same C_CMA
  // wallet). One case ↔ one wallet is the surviving invariant.

  // ── traceId format and never-regenerate ──────────────────────────────────
  describe('traceId format and inheritance rules', () => {
    it('mints UUID v4 traceId at run creation', async () => {
      const deps = makeDeps();
      let capturedData: any;
      deps.prisma.reconciliationRun.create.mockImplementation(async ({ data }: any) => {
        capturedData = data;
        return { id: 'run-tid-1', ...data };
      });
      deps.prisma.externalBalance.findMany.mockResolvedValue([]);

      const svc = new WalletReconRunService(deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any);
      (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });

      await svc.run({ cutoff });

      expect(capturedData.traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('mints UUID v4 traceId at case creation', async () => {
      const deps = makeDeps();
      deps.prisma.reconciliationRun.create.mockResolvedValue({ id: 'run-tid-2', runNo: 'RUN-TID-2' });
      deps.prisma.externalBalance.findMany.mockResolvedValue([
        { walletRef: 'w-tid-new', closingBalance: new Prisma.Decimal(1000), book: 'CLIENT', currency: 'USDT', accountRef: 'acc-tid' },
      ]);

      let capturedCaseData: any;
      deps.prisma.reconciliationCase.create.mockImplementation(async ({ data }: any) => {
        capturedCaseData = data;
        return { id: 'case-tid-1', ...data };
      });

      deps.balanceChecker.checkBalance.mockResolvedValue({
        pass: false, walletRef: 'w-tid-new', walletKind: 'CUSTOMER',
        coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE', ownerNo: 'c-001',
        internal: { total: 0n }, external: 1000n, delta: 100n,
      });

      const svc = new WalletReconRunService(deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any);
      (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
      (svc as any).resolveAssetId = jest.fn().mockResolvedValue('a-usdt');

      await svc.run({ cutoff });

      expect(capturedCaseData.traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('does NOT overwrite traceId when updating an existing case', async () => {
      // Use the shared-store harness so two sequential runs see the same case row.
      const caseStore = new Map<string, any>();
      let runSeq = 0;

      function drive(breakDelta: bigint) {
        runSeq += 1;
        const runId = `run-tid-${runSeq}`;
        const deps = makeDeps();
        deps.prisma.reconciliationRun.create.mockResolvedValue({ id: runId, runNo: `RUN-TID-${runSeq}` });
        deps.prisma.externalBalance.findMany.mockResolvedValue([
          { walletRef: 'w-tid-exist', closingBalance: new Prisma.Decimal(0), book: 'CLIENT', currency: 'USDT', accountRef: 'acc-e' },
        ]);
        deps.balanceChecker.checkBalance.mockResolvedValue({
          pass: false, walletRef: 'w-tid-exist', walletKind: 'CUSTOMER',
          coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE', ownerNo: 'c-001',
          internal: { total: 0n }, external: breakDelta, delta: breakDelta,
        });
        deps.prisma.reconciliationCase.findFirst.mockImplementation(async ({ where }: any) => {
          for (const row of caseStore.values()) {
            if (row.walletRef === where.walletRef && row.businessDate === where.businessDate && row.status === where.status)
              return { id: row.id };
          }
          return null;
        });
        deps.prisma.reconciliationCase.create.mockImplementation(async ({ data }: any) => {
          const id = `case-${Math.random().toString(36).slice(2, 8)}`;
          caseStore.set(id, { id, ...data });
          return { id, ...data };
        });
        deps.prisma.reconciliationCase.update.mockImplementation(async ({ where, data }: any) => {
          const row = caseStore.get(where.id);
          if (row) Object.assign(row, data);
          return row ?? { id: where.id, ...data };
        });
        deps.prisma.reconciliationCase.findMany.mockResolvedValue([]);

        const svc = new WalletReconRunService(deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any);
        (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
        (svc as any).resolveAssetId = jest.fn().mockResolvedValue('a-usdt');
        return { svc, deps };
      }

      // 1st run: creates the case, traceId minted at creation.
      await drive(100n).svc.run({ cutoff });
      const originalTraceId = Array.from(caseStore.values())[0].traceId;
      expect(originalTraceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

      // 2nd run: same (walletRef, businessDate) → hits the update path.
      const { deps: deps2 } = drive(200n);
      // Capture what data was passed to reconciliationCase.update
      let updateData: any;
      deps2.prisma.reconciliationCase.update.mockImplementation(async ({ where, data }: any) => {
        updateData = data;
        const row = caseStore.get(where.id);
        if (row) Object.assign(row, data);
        return row ?? { id: where.id, ...data };
      });
      // Re-create svc with the overridden mock
      const svc2 = new WalletReconRunService(deps2.prisma, deps2.balanceChecker as any, deps2.flowMatcher as any, deps2.tigerBeetle as any);
      (svc2 as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
      (svc2 as any).resolveAssetId = jest.fn().mockResolvedValue('a-usdt');
      await svc2.run({ cutoff });

      // The update payload must NOT contain traceId.
      expect(updateData).toBeDefined();
      expect(updateData).not.toHaveProperty('traceId');
      // And the stored case still has the original traceId.
      const afterTraceId = Array.from(caseStore.values())[0].traceId;
      expect(afterTraceId).toBe(originalTraceId);
    });
  });

  // ── T2: (walletRef, businessDate) idempotent upsert + auto-heal ──────────
  describe('T2 idempotent upsert + auto-heal', () => {
    /**
     * Helper: drives a single recon run with one configurable breaking wallet.
     * Wires deps fresh per run so we can simulate sequential runs by reusing
     * the same DB-shaped state (caseStore Map) across them.
     */
    function makeRunHarness() {
      // Shared mutable "DB" — one Map row per real-life ReconciliationCase.
      const caseStore = new Map<string, any>();
      let runSeq = 0;

      function drive(opts: {
        cutoff: Date;
        breakingWallet?: {
          walletRef: string;
          assetCode: string;
          delta: bigint;
          ownerNo?: string;
          walletKind?: 'CUSTOMER' | 'FIRM';
        };
        // If omitted, no wallets present → run will auto-heal anything OPEN.
        wallets?: Array<{ walletRef: string; assetCode: string }>;
      }) {
        runSeq += 1;
        const runId = `run-${runSeq}`;
        const businessDate = opts.cutoff.toISOString().slice(0, 10);

        const deps = makeDeps();
        deps.prisma.reconciliationRun.create.mockResolvedValue({
          id: runId, runNo: `RUN-WALLET-${runSeq}`,
        });

        // External balances → drives which wallets the engine iterates.
        const wallets = opts.wallets ?? (opts.breakingWallet ? [opts.breakingWallet] : []);
        deps.prisma.externalBalance.findMany.mockResolvedValue(
          wallets.map((w) => ({
            walletRef: w.walletRef,
            closingBalance: D(0),
            book: 'CLIENT',
            currency: w.assetCode,
            accountRef: `acc-${w.walletRef}`,
          })),
        );

        // Per-wallet balance check
        deps.balanceChecker.checkBalance.mockImplementation(async ({ walletRef }: any) => {
          const isBreaking = opts.breakingWallet && walletRef === opts.breakingWallet.walletRef;
          if (isBreaking) {
            return {
              pass: false,
              walletRef,
              walletKind: opts.breakingWallet!.walletKind ?? 'CUSTOMER',
              coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
              ownerNo: opts.breakingWallet!.ownerNo ?? 'c-001',
              internal: { total: 0n },
              external: opts.breakingWallet!.delta,
              delta: opts.breakingWallet!.delta,
            };
          }
          return {
            pass: true,
            walletRef,
            walletKind: 'CUSTOMER',
            coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
            ownerNo: 'c-default',
            internal: { total: 0n },
            external: 0n,
            delta: 0n,
          };
        });

        // findFirst by (walletRef, businessDate, status:OPEN) — read from caseStore
        deps.prisma.reconciliationCase.findFirst.mockImplementation(async ({ where }: any) => {
          for (const row of caseStore.values()) {
            if (
              row.walletRef === where.walletRef &&
              row.businessDate === where.businessDate &&
              row.status === where.status
            ) return { id: row.id };
          }
          return null;
        });

        // create → insert into caseStore
        deps.prisma.reconciliationCase.create.mockImplementation(async ({ data }: any) => {
          const id = `case-${Math.random().toString(36).slice(2, 8)}`;
          caseStore.set(id, { id, ...data });
          return { id, ...data };
        });

        // update → mutate caseStore (so subsequent runs see new state)
        deps.prisma.reconciliationCase.update.mockImplementation(async ({ where, data }: any) => {
          const row = caseStore.get(where.id);
          if (row) Object.assign(row, data);
          return row ?? { id: where.id, ...data };
        });

        // findMany used by auto-heal — return all OPEN cases for the businessDate
        // whose walletRef is NOT in the excluded list.
        deps.prisma.reconciliationCase.findMany.mockImplementation(async ({ where }: any) => {
          const excluded: string[] = where.walletRef?.notIn ?? [];
          const rows: any[] = [];
          for (const row of caseStore.values()) {
            if (
              row.status === where.status &&
              row.businessDate === where.businessDate &&
              row.layer === where.layer &&
              !excluded.includes(row.walletRef)
            ) rows.push(row);
          }
          return rows;
        });

        const svc = new WalletReconRunService(
          deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any,
        );
        (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
        (svc as any).resolveAssetId = jest.fn(async (currency: string) => `a-${currency.toLowerCase()}`);

        return { svc, runId, deps, cutoff: opts.cutoff };
      }

      function getStore() { return caseStore; }
      return { drive, getStore };
    }

    it('same wallet breaks in 3 sequential runs → 1 OPEN case; firstSeenRunId pins run 1; lastUpdatedRunId follows', async () => {
      const harness = makeRunHarness();
      const cutoff = new Date('2026-06-26T23:59:59Z');
      const breaking = { walletRef: 'w-cust-1', assetCode: 'USDT', delta: 100n };
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { svc, runId } = harness.drive({ cutoff, breakingWallet: breaking });
        ids.push(runId);
        await svc.run({ cutoff });
      }

      const openCases = Array.from(harness.getStore().values()).filter((c: any) => c.status === 'OPEN');
      // Idempotency: only one OPEN case for the wallet, not three.
      expect(openCases).toHaveLength(1);
      const c = openCases[0];
      expect(c.walletRef).toBe('w-cust-1');
      // firstSeenRunId == run 1 (pinned on create).
      expect(c.firstSeenRunId).toBe(ids[0]);
      // lastUpdatedRunId == run 3 (bumped on each rerun's update).
      expect(c.lastUpdatedRunId).toBe(ids[2]);
      expect(c.firstSeenRunId).not.toBe(c.lastUpdatedRunId);
    });

    it('wallet breaks in run A then recovers in run B → run A case RESOLVED with AUTO_HEALED', async () => {
      const harness = makeRunHarness();
      const cutoff = new Date('2026-06-26T23:59:59Z');

      // Run A: wallet breaks → 1 OPEN case
      const a = harness.drive({ cutoff, breakingWallet: { walletRef: 'w-cust-1', assetCode: 'USDT', delta: 100n } });
      await a.svc.run({ cutoff });

      // Run B: same wallet present but PASSES (no breaking). Engine sees the
      // wallet in externalBalances and the balanceChecker returns pass=true
      // → auto-heal sees it's not in currentBreakingWallets → resolves it.
      const b = harness.drive({ cutoff, wallets: [{ walletRef: 'w-cust-1', assetCode: 'USDT' }] });
      const bResult = await b.svc.run({ cutoff });

      const cases = Array.from(harness.getStore().values());
      expect(cases).toHaveLength(1);
      const c: any = cases[0];
      expect(c.status).toBe('RESOLVED');
      expect(c.resolutionReason).toBe('AUTO_HEALED');
      expect(c.resolvedAt).toBeInstanceOf(Date);
      expect(c.lastUpdatedRunId).toBe(b.runId);
      expect(c.closedByRunId).toBe(b.runId);
      // And the run result surfaces the heal count for the cockpit summary.
      expect(bResult.casesAutoHealed).toBe(1);
    });

    it('same wallet breaks on two different businessDates → 2 independent OPEN cases', async () => {
      const harness = makeRunHarness();
      const day1 = new Date('2026-06-26T23:59:59Z');
      const day2 = new Date('2026-06-27T23:59:59Z');
      const breaking = { walletRef: 'w-cust-1', assetCode: 'USDT', delta: 100n };

      await harness.drive({ cutoff: day1, breakingWallet: breaking }).svc.run({ cutoff: day1 });
      await harness.drive({ cutoff: day2, breakingWallet: breaking }).svc.run({ cutoff: day2 });

      const openCases = Array.from(harness.getStore().values()).filter((c: any) => c.status === 'OPEN');
      // One case per (walletRef, businessDate) — two distinct rows.
      expect(openCases).toHaveLength(2);
      const dates = openCases.map((c: any) => c.businessDate).sort();
      expect(dates).toEqual(['2026-06-26', '2026-06-27']);
    });

    it('severity bucketing: delta>=10000 → HIGH, >=100 → MEDIUM, else LOW', async () => {
      const cases = [
        { delta: 15_000n, expected: 'HIGH' },
        { delta: -15_000n, expected: 'HIGH' },
        { delta: 500n, expected: 'MEDIUM' },
        { delta: -100n, expected: 'MEDIUM' },
        { delta: 10n, expected: 'LOW' },
        { delta: 0n, expected: 'LOW' },
      ] as const;

      // Pure unit test of the exported helper — no run plumbing needed.
      const { computeSeverity } = await import('./wallet-recon-run.service');
      for (const tc of cases) {
        expect(computeSeverity(tc.delta)).toBe(tc.expected);
      }

      // And one round-trip through the upsert path to prove severity lands
      // on the persisted Case row.
      const harness = makeRunHarness();
      const cutoff = new Date('2026-06-26T23:59:59Z');
      const { svc } = harness.drive({ cutoff, breakingWallet: { walletRef: 'w-sev-1', assetCode: 'USDT', delta: 15_000n } });
      await svc.run({ cutoff });
      const c: any = Array.from(harness.getStore().values())[0];
      expect(c.severity).toBe('HIGH');
    });
  });
});
