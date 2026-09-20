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
import { ReconciliationCaseService } from '../domain/reconciliation-case.service';

const D = (n: string | number) => new Prisma.Decimal(n);

// 第六幕波三 T2：recon-run 的 Case 表写点已换线到 ReconciliationCaseService。
// 工厂在 mock prisma 上挂一个真服务实例——写点行为（create/update 载荷）仍落
// 在同一套 mock 上，既有断言零改动；只是调用路径从直写变成经服务。
const buildSvc = (deps: any) =>
  new WalletReconRunService(
    deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any,
    deps.auditLogs as any, deps.explainedDifferences as any,
    new ReconciliationCaseService(deps.prisma, deps.auditLogs),
  );

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
    // 波三 T2：ReconciliationCaseService.resolveAutoHealed 在 update 前先
    // findUnique 校验 status 以便走 assertTransition——findMany 挑出的 stale
    // 案件按查询条件本就 status='OPEN'，故默认回显 OPEN 满足迁移表校验。
    findUnique: jest.fn().mockResolvedValue({ status: 'OPEN' }),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(async ({ data }: any) => ({ id: `case-${Math.random().toString(36).slice(2, 8)}`, ...data })),
    update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
  };
  // T2 upsert deletes prior line items before re-inserting the current run's
  // findings; auto-heal also looks at findMany / update on cases. Default mocks
  // here so individual tests don't need to wire them.
  const reconciliationLineItem = { create: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() };
  const reconciliationRunWallet = { createMany: jest.fn() };
  const externalBalance = { findMany: jest.fn().mockResolvedValue([]) };
  const externalStatementLine = { findMany: jest.fn().mockResolvedValue([]) };
  const accountFlow = {
    groupBy: jest.fn().mockResolvedValue([]),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const tbAccountRegistry = { findMany: jest.fn().mockResolvedValue([]) };
  // canonical-minor: run body batch-loads asset.decimals per currency
  // (asset.findMany). Default → empty so decimalsByCurrency.get(...) ?? 0
  // yields 0 (identity 元→分) for these fully-stubbed matcher tests.
  // findFirst kept for resolveAssetId callers that aren't spied over.
  const asset = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
  };

  const prisma: any = {
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
    reconciliationRun,
    reconciliationCase,
    reconciliationLineItem,
    reconciliationRunWallet,
    externalBalance,
    externalStatementLine,
    accountFlow,
    tbAccountRegistry,
    asset,
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
      matched: [], orphanInternal: [], orphanExternal: [], mismatch: [], inTransit: [],
    }),
  };
  const tigerBeetle = {
    lookupAccounts: jest.fn().mockResolvedValue([]),
  };
  const auditLogs = {
    recordSystem: jest.fn(),
  };
  // ④ 解释索引：默认空——这些用例里没有调账单，所有差异都算异常（改动前的口径）。
  const explainedDifferences = {
    indexForWallet: jest.fn().mockResolvedValue({ byFlowId: new Map(), byExternalLineId: new Map() }),
  };

  Object.assign(prisma, overrides.prisma ?? {});
  if (overrides.balanceChecker) Object.assign(balanceChecker, overrides.balanceChecker);
  if (overrides.flowMatcher) Object.assign(flowMatcher, overrides.flowMatcher);
  if (overrides.tigerBeetle) Object.assign(tigerBeetle, overrides.tigerBeetle);
  if (overrides.auditLogs) Object.assign(auditLogs, overrides.auditLogs);
  if (overrides.explainedDifferences) Object.assign(explainedDifferences, overrides.explainedDifferences);

  // Default identity-pre-gate: balanced (asset == liab, asset == equity).
  // Tests stub computeInternalIdentity directly on the service to bypass
  // TB lookup entirely; tigerBeetle mock is only there to satisfy DI.
  return { prisma, balanceChecker, flowMatcher, tigerBeetle, auditLogs, explainedDifferences };
}

describe('WalletReconRunService', () => {
  const cutoff = new Date('2026-06-26T23:59:59Z');

  it('internal balanced + no wallets to check → run.status=PASS, walletsChecked=0', async () => {
    const deps = makeDeps();
    deps.prisma.reconciliationRun.create.mockResolvedValue({
      id: 'run-1', runNo: 'RUN-WALLET-1',
    });
    deps.prisma.externalBalance.findMany.mockResolvedValue([]); // no wallets

    const svc = buildSvc(deps);
    // Stub identity pre-gate to balanced.
    (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });

    const result = await svc.run({ cutoff });

    expect(result.status).toBe('PASS');
    expect(result.walletsChecked).toBe(0);
    expect(result.casesOpened).toBe(0);
    expect(deps.prisma.reconciliationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ layer: 'WALLET', cutoffAt: cutoff }),
      }),
    );
  });

  it('internal NOT balanced → status=INTERNAL_BREAK, no per-wallet processing', async () => {
    const deps = makeDeps();
    deps.prisma.reconciliationRun.create.mockResolvedValue({
      id: 'run-2', runNo: 'RUN-WALLET-2',
    });

    const svc = buildSvc(deps);
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

    const svc = buildSvc(deps);
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
      inTransit: [],
    });

    const svc = buildSvc(deps);
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

  it('in-transit line item payload: externalTimestamp 透传 + 键集合逐键相等（红3甲·写行防线）', async () => {
    const deps = makeDeps();
    deps.prisma.reconciliationRun.create.mockResolvedValue({ id: 'run-7', runNo: 'RUN-WALLET-7' });
    deps.prisma.externalBalance.findMany.mockResolvedValue([
      { walletRef: 'w-cust-7', closingBalance: D(100), book: 'CLIENT', currency: 'USDT', accountRef: 'acc-7' },
    ]);
    deps.balanceChecker.checkBalance.mockResolvedValue({
      pass: false, walletRef: 'w-cust-7', walletKind: 'CUSTOMER',
      coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE', ownerNo: 'c-007',
      internal: { total: 0n }, external: 100n, delta: 100n,
    });
    const at = new Date('2026-06-25T16:00:00Z');
    deps.flowMatcher.matchFlows.mockResolvedValue({
      matched: [], orphanInternal: [], orphanExternal: [], mismatch: [],
      inTransit: [{
        externalLineId: 'ext-7', fundsOrderId: 'fo7', fundsOrderNo: 'FO-7',
        orderStatus: 'CONFIRMING', amount: '100', direction: 'IN',
        externalRef: '0xabc', externalTimestamp: at,
      }],
    });

    const svc = buildSvc(deps);
    (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
    (svc as any).resolveAssetId = jest.fn().mockResolvedValue('a-usdt');

    const result = await svc.run({ cutoff });

    expect(result.casesOpened).toBeGreaterThanOrEqual(1);
    const payload = deps.prisma.reconciliationLineItem.create.mock.calls
      .map(([arg]: any[]) => arg.data)
      .find((d: any) => d.matchStatus === 'IN_TRANSIT');
    expect(payload).toBeDefined();
    // 值断言：写库载荷的时间 = 上游外部行时间（不是 mock 回显——mock 只当捕获器，值是生产代码算的）
    expect(payload.externalTimestamp).toEqual(at);
    // 形状断言：多写一键、少写一键都红——这是「省略可选字段」类缺陷的唯一防线（闸①不咬）
    expect(Object.keys(payload).sort()).toEqual([
      'caseId', 'externalAmount', 'externalDirection', 'externalRef', 'externalTimestamp',
      'externalTxId', 'foundByRunId', 'internalSourceId', 'internalSourceNo',
      'internalSourceType', 'lineNo', 'matchStatus', 'walletRef',
    ]);
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

      const svc = buildSvc(deps);
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

      const svc = buildSvc(deps);
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
            if (row.walletRef === where.walletRef && row.status === where.status)
              return { id: row.id, caseNo: row.caseNo };
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
        deps.prisma.reconciliationRunWallet.createMany.mockResolvedValue({ count: 0 });

        const svc = buildSvc(deps);
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
      const svc2 = buildSvc(deps2);
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
        // 省略 = 本轮一个钱包都没查到（外部对账单为空）。2026-08-29 之后这种
        // run **不再关任何案件**——见下方「查了 0 个钱包」用例。
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

        // findFirst by (walletRef, status:OPEN) — cross-day unique per T5 Step③.
        // businessDate intentionally NOT part of the probe: an OPEN case
        // persists across reruns regardless of which day re-observes it.
        deps.prisma.reconciliationCase.findFirst.mockImplementation(async ({ where }: any) => {
          for (const row of caseStore.values()) {
            if (
              row.walletRef === where.walletRef &&
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

        // findMany used by auto-heal — 忠实复刻 autoHealCases 的 where：
        // walletRef ∈ 可愈合集合（本轮查过且没破口），且 businessDate ≤ 本轮业务日。
        deps.prisma.reconciliationCase.findMany.mockImplementation(async ({ where }: any) => {
          const healable: string[] | undefined = where.walletRef?.in;
          const maxBusinessDate: string | undefined = where.businessDate?.lte;
          const rows: any[] = [];
          for (const row of caseStore.values()) {
            if (row.status !== where.status) continue;
            if (row.layer !== where.layer) continue;
            if (healable && !healable.includes(row.walletRef)) continue;
            if (maxBusinessDate && row.businessDate > maxBusinessDate) continue;
            rows.push(row);
          }
          return rows;
        });

        deps.prisma.reconciliationRunWallet.createMany.mockResolvedValue({ count: 0 });

        const svc = buildSvc(deps);
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

    it('查了 0 个钱包的 run（当天没有外部对账单）→ 一个案件都不许关', async () => {
      // 2026-08-29 业主走查的事故复现：自愈此前只判「不在破口集合里」，破口集合
      // 为空时 `notIn []` 命中所有 OPEN 案件 → 一轮 walletCount=0 的对账把 8 个
      // 案子全关成 AUTO_HEALED。业务口径：**没收到对账单是一类异常（no-feed），
      // 不是「账平了」的证据。**
      const harness = makeRunHarness();
      const cutoff = new Date('2026-06-26T23:59:59Z');

      const a = harness.drive({ cutoff, breakingWallet: { walletRef: 'w-cust-1', assetCode: 'USDT', delta: 100n } });
      await a.svc.run({ cutoff });
      expect((Array.from(harness.getStore().values())[0] as any).status).toBe('OPEN');

      // 同一天再跑一次，但外部对账单一行都没有 → 一个钱包都没查。
      const b = harness.drive({ cutoff });
      const bResult = await b.svc.run({ cutoff });

      expect(bResult.walletsChecked).toBe(0);
      expect(bResult.casesAutoHealed).toBe(0);
      const c: any = Array.from(harness.getStore().values())[0];
      expect(c.status).toBe('OPEN');
      expect(c.resolutionReason).toBeUndefined();
      expect(c.closedByRunId).toBeUndefined();
    });

    it('更早业务日的 run 不许关掉更晚业务日的案件（时间只能往前走）', async () => {
      // 同一次走查的第二条：业务日 2026-08-27 的 run 关掉了业务日 2026-08-28 的
      // 案件。跨天自愈（D 日破口在 D+1 日平了 → 自愈）是要保留的，但只许往前。
      const harness = makeRunHarness();
      const day2 = new Date('2026-06-27T23:59:59Z');
      const day1 = new Date('2026-06-26T23:59:59Z');

      // day2 开案。
      const a = harness.drive({ cutoff: day2, breakingWallet: { walletRef: 'w-cust-1', assetCode: 'USDT', delta: 100n } });
      await a.svc.run({ cutoff: day2 });

      // day1（更早）跑一轮：钱包查到了、也确实不破口——但它证明不了 day2 的差异已消失。
      const b = harness.drive({ cutoff: day1, wallets: [{ walletRef: 'w-cust-1', assetCode: 'USDT' }] });
      const bResult = await b.svc.run({ cutoff: day1 });

      expect(bResult.walletsChecked).toBe(1);
      expect(bResult.casesAutoHealed).toBe(0);
      expect((Array.from(harness.getStore().values())[0] as any).status).toBe('OPEN');
    });

    it('case 唯一性跨日：昨日 OPEN case（不同 businessDate）今日复观察——不新建、firstSeenRunId 不变、bucket 刷新', async () => {
      const harness = makeRunHarness();
      const day1 = new Date('2026-06-26T23:59:59Z');
      const day2 = new Date('2026-06-27T23:59:59Z');
      const breaking = { walletRef: 'w-cust-1', assetCode: 'USDT', delta: 100n };

      const runA = harness.drive({ cutoff: day1, breakingWallet: breaking });
      await runA.svc.run({ cutoff: day1 });

      const runB = harness.drive({ cutoff: day2, breakingWallet: breaking });
      await runB.svc.run({ cutoff: day2 });

      const cases = Array.from(harness.getStore().values());
      // Cross-day uniqueness: still ONE case, not two — the probe key dropped
      // businessDate, so day2's re-observation hits the same OPEN row.
      expect(cases).toHaveLength(1);
      const c: any = cases[0];
      expect(c.status).toBe('OPEN');
      // firstSeenRunId pins the original observer (run A / day1), unchanged
      // by day2's re-observation.
      expect(c.firstSeenRunId).toBe(runA.runId);
      expect(c.lastUpdatedRunId).toBe(runB.runId);
      // bucket refreshed by the latest run (still breaking → BREAK).
      expect(c.bucket).toBe('BREAK');
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

  // ── Round3 T5: snapshot rows + unattributed external heads ───────────────
  describe('Round3 orchestrator: run-wallet snapshot + unattributed accounts', () => {
    it('每钱包快照落库：matched 钱包也有 run_wallets 行，run 四桶计数 = 快照聚合', async () => {
      const deps = makeDeps();
      deps.prisma.reconciliationRun.create.mockResolvedValue({ id: 'run-snap-1', runNo: 'RUN-SNAP-1' });
      deps.prisma.externalBalance.findMany.mockResolvedValue([
        { walletRef: 'w-matched-1', closingBalance: D(0), book: 'CLIENT', currency: 'USDT', accountRef: 'acc-m1' },
        { walletRef: 'w-break-1', closingBalance: D(500), book: 'CLIENT', currency: 'USDT', accountRef: 'acc-b1' },
      ]);
      deps.balanceChecker.checkBalance.mockImplementation(async ({ walletRef }: any) => {
        if (walletRef === 'w-break-1') {
          return {
            pass: false, walletRef, walletKind: 'CUSTOMER',
            coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE', ownerNo: 'c-b1',
            internal: { total: 0n }, external: 500n, delta: 500n,
          };
        }
        return {
          pass: true, walletRef, walletKind: 'CUSTOMER',
          coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE', ownerNo: 'c-m1',
          internal: { total: 0n }, external: 0n, delta: 0n,
        };
      });

      const svc = buildSvc(deps);
      (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
      (svc as any).resolveAssetId = jest.fn().mockResolvedValue('a-usdt');

      const result = await svc.run({ cutoff });

      expect(result.walletsChecked).toBe(2);
      expect(deps.prisma.reconciliationRunWallet.createMany).toHaveBeenCalledTimes(1);
      const snapshotRows = (deps.prisma.reconciliationRunWallet.createMany as jest.Mock).mock.calls[0][0].data;
      // Both wallets get a snapshot row — matched wallets are NOT skipped.
      expect(snapshotRows).toHaveLength(2);
      const matchedRow = snapshotRows.find((r: any) => r.walletRef === 'w-matched-1');
      const breakRow = snapshotRows.find((r: any) => r.walletRef === 'w-break-1');
      expect(matchedRow.bucket).toBe('MATCHED');
      expect(matchedRow.caseNo).toBeNull();
      expect(breakRow.bucket).toBe('BREAK');
      expect(breakRow.caseNo).toEqual(expect.any(String));

      // Run's four-bucket counters == snapshot aggregation.
      const updateCall = (deps.prisma.reconciliationRun.update as jest.Mock).mock.calls.find(
        ([arg]: any) => arg.where.id === 'run-snap-1' && arg.data.status === 'COMPLETED',
      );
      expect(updateCall[0].data.walletCount).toBe(2);
      expect(updateCall[0].data.matchedCount).toBe(1);
      expect(updateCall[0].data.breakCount).toBe(1);
      expect(updateCall[0].data.inTransitCount).toBe(0);
      expect(updateCall[0].data.softFlagCount).toBe(0);
    });

    it('无主外部余额头（walletRef=null）→ 开 BREAK case（caseReason=unattributed_external_account、walletRef=accountRef）+ 快照行，不再静默跳过', async () => {
      const deps = makeDeps();
      deps.prisma.reconciliationRun.create.mockResolvedValue({ id: 'run-unattr-1', runNo: 'RUN-UNATTR-1' });
      deps.prisma.externalBalance.findMany.mockResolvedValue([
        { walletRef: null, closingBalance: D(750), book: 'FIRM', currency: 'AED', accountRef: 'acc-orphan-1' },
      ]);
      let capturedCaseData: any;
      deps.prisma.reconciliationCase.create.mockImplementation(async ({ data }: any) => {
        capturedCaseData = data;
        return { id: 'case-unattr-1', ...data };
      });

      const svc = buildSvc(deps);
      (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
      (svc as any).resolveAssetId = jest.fn().mockResolvedValue('a-aed');

      const result = await svc.run({ cutoff });

      // Neither engine is invoked for the unattributed head (no internal face to compare).
      expect(deps.balanceChecker.checkBalance).not.toHaveBeenCalled();
      expect(deps.flowMatcher.matchFlows).not.toHaveBeenCalled();

      expect(result.status).toBe('BREAK');
      expect(result.casesOpened).toBe(1);
      expect(capturedCaseData).toBeDefined();
      expect(capturedCaseData.walletRef).toBe('acc-orphan-1');
      expect(capturedCaseData.book).toBe('FIRM');
      expect(capturedCaseData.coaCode).toBeNull();
      expect(capturedCaseData.ownerNo).toBeNull();
      expect(capturedCaseData.deltaAmount.toString()).toBe('750');
      expect(capturedCaseData.actualExternal.toString()).toBe('750');
      expect(capturedCaseData.tbAmount.toString()).toBe('0');

      // And a snapshot row was written for the orphan head too — not skipped.
      const snapshotRows = (deps.prisma.reconciliationRunWallet.createMany as jest.Mock).mock.calls[0][0].data;
      expect(snapshotRows).toHaveLength(1);
      expect(snapshotRows[0].walletRef).toBe('acc-orphan-1');
      expect(snapshotRows[0].bucket).toBe('BREAK');
      expect(snapshotRows[0].internalTotal.toString()).toBe('0');
      expect(snapshotRows[0].externalClosing.toString()).toBe('750');
    });
  });
});

describe('平账 A 批：开案设账龄截止（spec §2.1）', () => {
  it('新开案件 slaDeadline = 业务日日终 + 3 天；开案审计 metadata 带 slaDeadline', async () => {
    const deps = makeDeps();
    deps.prisma.reconciliationRun.create.mockResolvedValue({ id: 'run-a', runNo: 'RUN20260901-1', traceId: 't' });
    deps.prisma.externalBalance.findMany.mockResolvedValue([
      { walletRef: 'w-1', closingBalance: new Prisma.Decimal(500), book: 'CLIENT', currency: 'AED', accountRef: 'acc-1' },
    ]);
    deps.prisma.asset.findFirst.mockResolvedValue({ id: 'asset-aed' });
    deps.balanceChecker.checkBalance.mockResolvedValue({
      pass: false, walletRef: 'w-1', walletKind: 'CUSTOMER', coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE', ownerNo: 'CU1',
      internal: { payable: 0n, suspense: 0n, total: 0n }, external: 500n, delta: 500n,
    });
    const svc = buildSvc(deps);
    (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
    (svc as any).fetchExternalLinesForWallet = jest.fn().mockResolvedValue([]);

    await svc.run({ cutoff: new Date('2026-09-01T10:00:00Z') });

    const created = deps.prisma.reconciliationCase.create.mock.calls[0][0].data;
    expect(created.slaDeadline.toISOString()).toBe('2026-09-04T23:59:59.999Z');
    const opened = deps.auditLogs.recordSystem.mock.calls.find((c: any[]) => c[0].action === 'RECON_CASE_OPENED')![0];
    expect(opened.metadata.slaDeadline).toBe('2026-09-04T23:59:59.999Z');
  });
  it('既有 OPEN 案件被复观察——update 的 data 不带 slaDeadline、也不新建 case（spec §2.1 复观察不重置）', async () => {
    const deps = makeDeps();
    deps.prisma.reconciliationRun.create.mockResolvedValue({ id: 'run-a', runNo: 'RUN20260901-1', traceId: 't' });
    deps.prisma.reconciliationCase.findFirst.mockResolvedValue({ id: 'case-existing', caseNo: 'REC20260901-001' });
    deps.prisma.externalBalance.findMany.mockResolvedValue([
      { walletRef: 'w-1', closingBalance: new Prisma.Decimal(500), book: 'CLIENT', currency: 'AED', accountRef: 'acc-1' },
    ]);
    deps.prisma.asset.findFirst.mockResolvedValue({ id: 'asset-aed' });
    deps.balanceChecker.checkBalance.mockResolvedValue({
      pass: false, walletRef: 'w-1', walletKind: 'CUSTOMER', coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE', ownerNo: 'CU1',
      internal: { payable: 0n, suspense: 0n, total: 0n }, external: 500n, delta: 500n,
    });
    const svc = buildSvc(deps);
    (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
    (svc as any).fetchExternalLinesForWallet = jest.fn().mockResolvedValue([]);

    await svc.run({ cutoff: new Date('2026-09-01T10:00:00Z') });

    expect(deps.prisma.reconciliationCase.create).not.toHaveBeenCalled();
    const updateData = deps.prisma.reconciliationCase.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('slaDeadline');
  });
});

describe('平账 A 批：跑批完成审计带截止时刻（spec §6.1 / §2.8）', () => {
  it('RECON_RUN_COMPLETED metadata.cutoffAt = 本轮截止', async () => {
    const deps = makeDeps();
    deps.prisma.reconciliationRun.create.mockResolvedValue({ id: 'run-c', runNo: 'RUN20260901-2', traceId: 't' });
    deps.prisma.externalBalance.findMany.mockResolvedValue([]);
    const svc = buildSvc(deps);
    (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
    const cutoff = new Date('2026-09-01T10:00:00Z');
    await svc.run({ cutoff });
    const done = deps.auditLogs.recordSystem.mock.calls.find((c: any[]) => c[0].action === 'RECON_RUN_COMPLETED')![0];
    expect(done.metadata.cutoffAt).toBe('2026-09-01T10:00:00.000Z');
  });
});
