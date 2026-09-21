import { Prisma } from '@prisma/client';
import { ReconciliationQueryService } from './reconciliation-query.service';
import { FlowComparisonBuilder } from './flow-comparison.builder';
import { CAUSE_REGISTRY, DISPOSITION_LABEL, causesFor, dispositionsFor } from '../disposition/cause-registry';
import { REASON_SPECS } from '../disposition/adjustment-rules';

// Helper: build the query service with a mock for the flow-matcher dependency
// the constructor requires (T3). Tests can override it by passing their own.
// T6: walletBalanceChecker was dropped from the constructor — getRun no
// longer recomputes via the balance checker (it reads the run-wallet
// snapshot table instead), and no other method in this service used it.
// 波三 T6：buildFlowComparison 挪进独立 FlowComparisonBuilder——query service
// 不再直接持有 flowMatcher/explainedDifferences，改注入 builder 实例。这里在
// 同一套 mock 上现构一个真 builder（同 T2 buildSvc 手法），既有断言零改动。
function mkSvc(
  prisma: any,
  opts: { flowMatcher?: any; explainedDifferences?: any; accounting?: any } = {},
) {
  const flowMatcher = opts.flowMatcher ?? {
    matchFlows: jest.fn().mockResolvedValue({
      matched: [], orphanInternal: [], orphanExternal: [], mismatch: [],
    }),
  };
  // ④ 解释索引：默认空——这些用例里没有调账单，差异行都不带解释标记。
  const explainedDifferences = opts.explainedDifferences ?? {
    indexForWallet: jest.fn().mockResolvedValue({ byFlowId: new Map(), byExternalLineId: new Map() }),
  };
  // 平账二期 Task 8：getCase/listCases 的补款 / 垫款回挂只在极少数用例里真正触发
  // availableMinor()（都在下面单独 override）——默认给 0，够挡住其余所有用例。
  const accounting = opts.accounting ?? {
    getCustomerAvailableBalance: jest.fn(async () => ({ available: 0n })),
  };
  const flowComparisonBuilder = new FlowComparisonBuilder(prisma, flowMatcher as any, explainedDifferences as any);
  return new ReconciliationQueryService(prisma, accounting, flowComparisonBuilder);
}

describe('listRuns — single engine surface', () => {
  // Single engine now. No engineVersion filter.
  function mkPrisma(rows: any[]) {
    return {
      reconciliationRun: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    } as any;
  }
  const row = { id: 'r1', runNo: 'RUN20260625-1', businessDate: '2026-06-25', layer: 'WALLET' };

  it('returns all rows without engine filtering', async () => {
    const svc = mkSvc(mkPrisma([row]));
    const rows = await svc.listRuns({});
    expect(rows).toHaveLength(1);
  });
});

describe('getExternalBalanceByWallet — statement lines scoped to the balance business day', () => {
  it('filters lines by the balance cutoffDate day window (no multi-day bleed)', async () => {
    const wallet = { id: 'W1', walletNo: 'WA-ZAND-001', walletRole: 'C_VIBAN' };
    const balance = {
      id: 'b1', walletRef: 'W1',
      source: 'ZAND', accountRef: 'C_CMA-AED-0001', currency: 'AED', cutoffDate: '2026-06-22',
    };
    const prisma = {
      wallet: { findFirst: jest.fn().mockResolvedValue(wallet) },
      externalBalance: { findFirst: jest.fn().mockResolvedValue(balance) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue([]) },
      asset: { findFirst: jest.fn().mockResolvedValue({ decimals: 2 }) },
    };
    const svc = mkSvc(prisma);
    await svc.getExternalBalanceByWallet('WA-ZAND-001', '2026-06-22');
    expect(prisma.externalStatementLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source: 'ZAND',
          accountRef: 'C_CMA-AED-0001',
          currency: 'AED',
          datetime: {
            gte: new Date('2026-06-22T00:00:00.000Z'),
            lte: new Date('2026-06-22T23:59:59.999Z'),
          },
        }),
      }),
    );
  });
});

// ─── T3 ──────────────────────────────────────────────────────────────────────

describe('getCase — flowComparison (T3)', () => {
  const kase = {
    id: 'case-x', caseNo: 'REC-20260627-AED-W-002',
    walletRef: 'walletX', businessDate: '2026-06-27', lineItems: [],
    openedByRunId: 'run-fc', lastUpdatedRunId: null,
    slaDeadline: null, book: null,
    status: 'OPEN', bucket: 'BREAK', createdAt: new Date('2026-06-27T00:00:00Z'),
    tbAmount: new Prisma.Decimal(0), actualExternal: new Prisma.Decimal(0), deltaAmount: new Prisma.Decimal(0),
    firstSeenRunId: null, lastObservedRunId: null, closedByRunId: null,
  };
  // Hand-built source datasets covering all 4 match types.
  const externalLines = [
    { id: 'ext-1', direction: 'IN',  amount: new Prisma.Decimal(100), externalRef: 'REF-1', datetime: new Date('2026-06-27T10:00:00Z'), description: 'wire in' },
    { id: 'ext-2', direction: 'OUT', amount: new Prisma.Decimal(50),  externalRef: 'REF-2', datetime: new Date('2026-06-27T11:00:00Z'), description: null },
    { id: 'ext-3', direction: 'IN',  amount: new Prisma.Decimal(75),  externalRef: 'REF-3', datetime: new Date('2026-06-27T12:00:00Z'), description: 'orphan ext' },
  ];
  const internalFlows = [
    { id: 'int-1', direction: 'IN',  amount: new Prisma.Decimal(100), externalRef: 'REF-1', eventCode: 'DEPOSIT_IN', sourceType: 'PAYIN', sourceNo: 'PAY-1', createdAt: new Date('2026-06-27T10:00:30Z') },
    { id: 'int-2', direction: 'OUT', amount: new Prisma.Decimal(60),  externalRef: 'REF-2', eventCode: 'WITHDRAW_OUT', sourceType: 'WITHDRAW', sourceNo: 'WD-2', createdAt: new Date('2026-06-27T11:00:30Z') },
    { id: 'int-4', direction: 'OUT', amount: new Prisma.Decimal(30),  externalRef: 'REF-4', eventCode: 'WITHDRAW_OUT', sourceType: 'WITHDRAW', sourceNo: 'WD-4', createdAt: new Date('2026-06-27T13:00:00Z') },
  ];

  it('produces matched + orphan + mismatch rows from the source datasets', async () => {
    const prisma = {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) },
      externalBalance: { findMany: jest.fn().mockResolvedValue([{ accountRef: 'ACC-X' }]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue(externalLines) },
      accountFlow: { findMany: jest.fn().mockResolvedValue(internalFlows) },
      wallet: { findUnique: jest.fn().mockResolvedValue(null) },
      // ⚡ 差异行级推荐（本任务）：getCase 现在无条件发一次 findFirst 反查 demoManifest
      // （真实钱包案件）——真实/pass 轮场景，返回 null 即可，本组用例不关心推荐字段。
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue({ id: 'run-fc', runNo: 'REC-FC' }), findFirst: jest.fn().mockResolvedValue(null) },
      // T4/T1: getCase (unconditional) + buildFlowComparison both look up
      // asset.decimals by assetCode via findUnique. decimals=2 here.
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: 2 }) },
      // Task 7: getCase's案件级 adjustments 查询也是 unconditional（不依赖
      // lineItems，见 reconciliation-query.service.ts getCase 里的新增块）。
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账一期半（T7 案件读面）：getCase 的行注解块同样 unconditional 发一次。
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账二期 Task 8：补款 / 垫款回挂块的划转单查询同样 unconditional。
      internalTransfer: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账三期 Task 9：案件级事故摘要查询同样 unconditional。
      incident: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const flowMatcher = {
      matchFlows: jest.fn().mockResolvedValue({
        matched: [{ internalFlowId: 'int-1', externalLineId: 'ext-1', via: 'ref' }],
        orphanInternal: [{ internalFlowId: 'int-4', eventCode: 'WITHDRAW_OUT', amount: '30', direction: 'OUT', externalRef: 'REF-4' }],
        orphanExternal: [{ externalLineId: 'ext-3', amount: '75', direction: 'IN', externalRef: 'REF-3' }],
        mismatch: [{ internalFlowId: 'int-2', externalLineId: 'ext-2', internalAmount: '60', externalAmount: '50', ref: 'REF-2' }],
      }),
    };
    const svc = mkSvc(prisma, { flowMatcher });
    const result: any = await svc.getCase(kase.caseNo);

    const types = result.flowComparison.map((r: any) => r.matchType);
    expect(types).toContain('MATCHED');
    expect(types).toContain('ORPHAN_INTERNAL');
    expect(types).toContain('ORPHAN_EXTERNAL');
    expect(types).toContain('AMOUNT_MISMATCH');
    expect(result.flowComparison).toHaveLength(4);

    const matched = result.flowComparison.find((r: any) => r.matchType === 'MATCHED');
    expect(matched.externalLine.id).toBe('ext-1');
    expect(matched.internalFlow.id).toBe('int-1');
    expect(matched.internalFlow.eventCode).toBe('DEPOSIT_IN');

    const orphanInt = result.flowComparison.find((r: any) => r.matchType === 'ORPHAN_INTERNAL');
    expect(orphanInt.externalLine).toBeNull();
    expect(orphanInt.internalFlow.id).toBe('int-4');

    const orphanExt = result.flowComparison.find((r: any) => r.matchType === 'ORPHAN_EXTERNAL');
    expect(orphanExt.internalFlow).toBeNull();
    expect(orphanExt.externalLine.id).toBe('ext-3');

    const mm = result.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH');
    expect(mm.externalLine.id).toBe('ext-2');
    expect(mm.internalFlow.id).toBe('int-2');
    expect(mm.deltaAmount).toBe('-10'); // ext(50) - int(60) = -10

    expect(result.flowSummary).toEqual({ matched: 1, orphanInternal: 1, orphanExternal: 1, mismatch: 1 });
  });

  it('returns empty flowComparison for XREF synthetic-wallet cases', async () => {
    const prisma = {
      reconciliationCase: {
        findUnique: jest.fn().mockResolvedValue({ ...kase, walletRef: 'XREF:REF-X' }),
      },
      externalBalance: { findMany: jest.fn() },
      externalStatementLine: { findMany: jest.fn() },
      accountFlow: { findMany: jest.fn() },
      wallet: { findUnique: jest.fn() },
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue({ id: 'run-fc', runNo: 'REC-FC' }) },
      // T4: getCase's asset.decimals lookup is unconditional — runs even for
      // XREF cases (which skip buildFlowComparison). Must return, not undefined.
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: 2 }) },
      // Task 7: 案件级 adjustments 查询同样 unconditional，XREF case 也要发。
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账一期半（T7 案件读面）：getCase 的行注解块同样 unconditional 发一次。
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账二期 Task 8：补款 / 垫款回挂块的划转单查询同样 unconditional，XREF case 也要发。
      internalTransfer: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账三期 Task 9：案件级事故摘要查询同样 unconditional，XREF case 也要发。
      incident: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const flowMatcher = { matchFlows: jest.fn() };
    const svc = mkSvc(prisma, { flowMatcher });
    const result: any = await svc.getCase('REC-XREF');
    expect(result.flowComparison).toEqual([]);
    expect(flowMatcher.matchFlows).not.toHaveBeenCalled();
  });
});

describe('getRun — walletNo on accountStatusTable rows (T6 snapshot source)', () => {
  // Minimal run + snapshot-row fixture to test walletNo resolution on AccountStatusRow.
  const run = {
    id: 'run-wno',
    runNo: 'RUN-2026-0628-001',
    businessDate: '2026-06-28',
    layer: 'WALLET',
    demoManifest: null,
    walletCount: 1, matchedCount: 1, inTransitCount: 0, softFlagCount: 0, breakCount: 0,
    openedCount: 0, reObservedCount: 0, closedCount: 0,
  };

  function mkSnapshotRow(walletRef: string) {
    return {
      walletRef, assetCode: 'AED', book: 'CUSTOMER', coaCode: 'L.CLIENT_PAYABLE', ownerNo: 'CU-X', bucket: 'MATCHED',
      internalTotal: new Prisma.Decimal(100), externalClosing: new Prisma.Decimal(100), deltaAmount: new Prisma.Decimal(0),
      inTransitAmount: new Prisma.Decimal(0), matchedCount: 1, orphanInternal: 0, orphanExternal: 0, mismatchCount: 0,
      inTransitCount: 0, caseNo: null,
    };
  }

  function mkPrismaWalletNo(walletRef: string, walletNo: string | null) {
    return {
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue(run) },
      reconciliationCase: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationRunWallet: { findMany: jest.fn().mockResolvedValue([mkSnapshotRow(walletRef)]) },
      wallet: {
        findMany: jest.fn().mockResolvedValue(
          walletNo !== null
            ? [{ id: walletRef, walletNo, walletRole: 'C_DEP' }]
            : [],
        ),
      },
      // T4: getRun looks up asset.decimals per row (assetCode → decimals) to
      // scale display amounts 分→元. Snapshot rows here are AED (decimals=2).
      asset: { findMany: jest.fn().mockResolvedValue([{ code: 'AED', decimals: 2 }]) },
    };
  }

  it('returns walletNo for each accountStatusRow when wallet exists', async () => {
    const prisma = mkPrismaWalletNo('W1', 'WAL-001');
    const svc = mkSvc(prisma);
    const result: any = await svc.getRun('RUN-2026-0628-001');
    expect(result.accountStatusTable[0].walletNo).toBe('WAL-001');
  });

  it('returns null walletNo for XREF synthetic walletRefs (retired wallets)', async () => {
    const xref = 'XREF:synthetic-id-1';
    const run2 = { ...run, runNo: 'RUN-XREF-CASE', id: 'run-xref' };
    const prisma = {
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue(run2) },
      reconciliationCase: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationRunWallet: { findMany: jest.fn().mockResolvedValue([mkSnapshotRow(xref)]) },
      wallet: { findMany: jest.fn().mockResolvedValue([]) }, // no wallet row for XREF
      // T4: asset.decimals lookup (snapshot row is AED). Runs against assetCode,
      // independent of the XREF walletRef so this still returns for the row.
      asset: { findMany: jest.fn().mockResolvedValue([{ code: 'AED', decimals: 2 }]) },
    };
    const svc = mkSvc(prisma);
    const result: any = await svc.getRun('RUN-XREF-CASE');
    const xrefRow = result.accountStatusTable.find((r: any) => r.walletRef.startsWith('XREF:'));
    expect(xrefRow?.walletNo).toBeNull();
  });
});

describe('getCase — walletNo / linkedRunNo / slaDeadline / book', () => {
  const run = { id: 'ra', runNo: 'REC-A' };
  const wallet = { id: 'W1', walletNo: 'WAL-001' };

  function mkKase(overrides: Record<string, unknown> = {}) {
    return {
      id: 'case-id-1',
      caseNo: 'CASE-001',
      walletRef: 'W1',
      lastUpdatedRunId: 'ra',
      openedByRunId: 'ra',
      slaDeadline: new Date('2026-07-01'),
      book: 'CLIENT',
      businessDate: '2026-06-28',
      lineItems: [],
      status: 'OPEN', bucket: 'BREAK', createdAt: new Date('2026-06-28T00:00:00Z'),
      tbAmount: new Prisma.Decimal(0), actualExternal: new Prisma.Decimal(0), deltaAmount: new Prisma.Decimal(0),
      firstSeenRunId: null, lastObservedRunId: null, closedByRunId: null,
      ...overrides,
    };
  }

  function mkPrismaCase(kaseOverrides: Record<string, unknown> = {}, walletRow: any = wallet) {
    return {
      reconciliationCase: {
        findUnique: jest.fn().mockResolvedValue(mkKase(kaseOverrides)),
      },
      wallet: {
        findUnique: jest.fn().mockResolvedValue(walletRow),
      },
      reconciliationRun: {
        findUnique: jest.fn().mockResolvedValue(run),
        // ⚡ 差异行级推荐（本任务）：真实钱包案件会无条件发一次 findFirst 反查
        // demoManifest——真实/pass 轮场景，返回 null 即可。
        findFirst: jest.fn().mockResolvedValue(null),
      },
      // buildFlowComparison path (walletRef is a real wallet, not XREF):
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue([]) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([]) },
      // T4/T1: asset.decimals lookup (getCase unconditional + buildFlowComparison).
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: 2 }) },
      // Task 7: 案件级 adjustments 查询同样 unconditional。
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账一期半（T7 案件读面）：getCase 的行注解块同样 unconditional 发一次。
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账二期 Task 8：补款 / 垫款回挂块的划转单查询同样 unconditional。
      internalTransfer: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账三期 Task 9：案件级事故摘要查询同样 unconditional。
      incident: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
  }

  it('returns walletNo + linkedRunNo + slaDeadline + book', async () => {
    const prisma = mkPrismaCase();
    const svc = mkSvc(prisma);
    const result: any = await svc.getCase('CASE-001');
    expect(result.walletNo).toBe('WAL-001');
    expect(result.linkedRunNo).toBe('REC-A');
    expect(result.slaDeadline).toBeTruthy();
    expect(result.book).toBe('CLIENT');
  });

  it('falls back to openedByRunId when lastUpdatedRunId is null', async () => {
    const prisma = mkPrismaCase({ caseNo: 'CASE-002', lastUpdatedRunId: null });
    const svc = mkSvc(prisma);
    const result: any = await svc.getCase('CASE-002');
    expect(result.linkedRunNo).toBe('REC-A');
  });

  it('波四：case 级下发 adjustmentBook（book null → CLIENT）', async () => {
    const prisma = mkPrismaCase({ book: null });
    const svc = mkSvc(prisma);
    const result: any = await svc.getCase('CASE-001');
    expect(result.adjustmentBook).toBe('CLIENT');
  });

  it('returns null walletNo for XREF synthetic walletRef', async () => {
    const prisma = {
      reconciliationCase: {
        findUnique: jest.fn().mockResolvedValue(mkKase({ caseNo: 'CASE-XREF', walletRef: 'XREF:synthetic-id-1' })),
      },
      wallet: { findUnique: jest.fn() },
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue(run) },
      // T4: getCase's asset.decimals lookup is unconditional (runs for XREF too).
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: 2 }) },
      // Task 7: 案件级 adjustments 查询同样 unconditional，XREF case 也要发。
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账一期半（T7 案件读面）：getCase 的行注解块同样 unconditional 发一次。
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账二期 Task 8：补款 / 垫款回挂块的划转单查询同样 unconditional，XREF case 也要发。
      internalTransfer: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账三期 Task 9：案件级事故摘要查询同样 unconditional，XREF case 也要发。
      incident: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const svc = mkSvc(prisma);
    const result: any = await svc.getCase('CASE-XREF');
    expect(result.walletNo).toBeNull();
    expect((prisma.wallet.findUnique as jest.Mock).mock.calls).toHaveLength(0);
  });
});

describe('listCases — T3 default OPEN + aging desc', () => {
  // T3 cockpit default: omitting status filters to OPEN; aging derived from
  // createdAt; sort by aging desc so the oldest break floats to the top.
  const old = { id: 'c-old', caseNo: 'OLD', status: 'OPEN', firstSeenRunId: 'r1', lastUpdatedRunId: 'r3', createdAt: new Date(Date.now() - 5 * 86_400_000) };
  const mid = { id: 'c-mid', caseNo: 'MID', status: 'OPEN', firstSeenRunId: 'r2', lastUpdatedRunId: 'r4', createdAt: new Date(Date.now() - 2 * 86_400_000) };
  const nu  = { id: 'c-new', caseNo: 'NEW', status: 'OPEN', firstSeenRunId: 'r5', lastUpdatedRunId: 'r5', createdAt: new Date(Date.now() - 0 * 86_400_000) };

  // Shared reconciliationRun mock for tests that don't assert on runNo resolution.
  const noRunLookup = {
    // Task 5（读面翻转）：demoScenarios 气泡数据源查询——默认无 demoManifest 跑批
    // （findFirst 落空），这批用例不关心气泡，行为等价于本任务之前。
    reconciliationRun: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    // 平账一期半（T7 案件读面）：listCases 新增 dispositionCount/anomalyLineCount/
    // decimals 三个 groupBy/findMany 查询，非空行 fixture 都会触发。
    // 平账二期 Task 8：同一 reconciliationDisposition 模型上又加了一条
    // findMany（退汇账单行徽标用）——与上面的 groupBy 是两个不同的 mock 方法。
    reconciliationDisposition: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
    reconciliationLineItem: { groupBy: jest.fn().mockResolvedValue([]) },
    asset: { findMany: jest.fn().mockResolvedValue([]) },
    // 平账二期 Task 8：列表徽标——待补款 / 待垫款 / 进行中，非空行 fixture 都会触发。
    reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
    internalTransfer: { findMany: jest.fn().mockResolvedValue([]) },
  };

  it('defaults to status=OPEN when status omitted', async () => {
    const findMany = jest.fn().mockResolvedValue([old, mid, nu]);
    const prisma = { reconciliationCase: { findMany }, ...noRunLookup };
    const svc = mkSvc(prisma);
    await svc.listCases({});
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'OPEN' }),
    }));
  });

  it("treats status='ALL' as no filter", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { reconciliationCase: { findMany }, ...noRunLookup };
    const svc = mkSvc(prisma);
    await svc.listCases({ status: 'ALL' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: undefined }),
    }));
  });

  it('respects explicit status override', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { reconciliationCase: { findMany }, ...noRunLookup };
    const svc = mkSvc(prisma);
    await svc.listCases({ status: 'RESOLVED' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'RESOLVED' }),
    }));
  });

  it('sorts by aging desc and decorates rows with aging / firstSeenRunId / lastUpdatedRunId', async () => {
    // Return out of order; service should reorder by aging desc.
    const findMany = jest.fn().mockResolvedValue([mid, nu, old]);
    const prisma = { reconciliationCase: { findMany }, ...noRunLookup };
    const svc = mkSvc(prisma);
    const rows = await svc.listCases({});
    expect(rows.map((r: any) => r.caseNo)).toEqual(['OLD', 'MID', 'NEW']);
    expect(rows[0].aging).toBeGreaterThanOrEqual(4);
    expect(rows[2].aging).toBeLessThanOrEqual(0);
    expect(rows[0].firstSeenRunId).toBe('r1');
    expect(rows[0].lastUpdatedRunId).toBe('r3');
  });

  it('joins firstSeenRunId/lastUpdatedRunId → runNo', async () => {
    const caseRow = {
      id: 'c-join',
      caseNo: 'JOIN-001',
      status: 'OPEN',
      firstSeenRunId: 'ra',
      lastUpdatedRunId: 'rb',
      createdAt: new Date(),
    };
    const prisma = {
      reconciliationCase: { findMany: jest.fn().mockResolvedValue([caseRow]) },
      reconciliationRun: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'ra', runNo: 'REC-A' },
          { id: 'rb', runNo: 'REC-B' },
        ]),
        // Task 5（读面翻转）：demoScenarios 气泡数据源查询——本用例不关心气泡。
        findFirst: jest.fn().mockResolvedValue(null),
      },
      // 平账一期半（T7 案件读面）：同上，非空行会触发新增的 groupBy/findMany。
      // 平账二期 Task 8：同一模型上再加一条 findMany（退汇账单行徽标）。
      reconciliationDisposition: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
      reconciliationLineItem: { groupBy: jest.fn().mockResolvedValue([]) },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账二期 Task 8：列表徽标查询。
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      internalTransfer: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = mkSvc(prisma);
    const result = await svc.listCases({});
    expect((result[0] as any).firstSeenRunNo).toBe('REC-A');
    expect((result[0] as any).lastUpdatedRunNo).toBe('REC-B');
  });
});

describe('listExternalBalances — wallet join', () => {
  it('joins walletRef → walletNo + walletRole on each row', async () => {
    const prisma = {
      externalBalance: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'eb1', walletRef: 'W1', cutoffDate: '2026-06-28', book: 'CLIENT', source: 'ZAND', currency: 'AED', accountRef: 'ACC-1' },
        ]),
      },
      wallet: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'W1', walletNo: 'WA-001', walletRole: 'C_VIBAN' },
        ]),
      },
      asset: {
        findMany: jest.fn().mockResolvedValue([
          { code: 'AED', decimals: 2 },
        ]),
      },
    };
    const svc = mkSvc(prisma);
    const result = await svc.listExternalBalances({ cutoffDate: '2026-06-28' });
    expect(result[0].walletNo).toBe('WA-001');
    expect(result[0].walletRole).toBe('C_VIBAN');
    expect(result[0].decimals).toBe(2);
  });

  it('returns null walletNo/walletRole for XREF synthetic walletRefs', async () => {
    const prisma = {
      externalBalance: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'eb2', walletRef: 'XREF:synthetic-1', cutoffDate: '2026-06-28', book: 'CLIENT', source: 'ZAND', currency: 'AED', accountRef: 'ACC-2' },
        ]),
      },
      wallet: { findMany: jest.fn().mockResolvedValue([]) },
      asset: {
        findMany: jest.fn().mockResolvedValue([
          { code: 'AED', decimals: 2 },
        ]),
      },
    };
    const svc = mkSvc(prisma);
    const result = await svc.listExternalBalances({ cutoffDate: '2026-06-28' });
    const xref = result.find((r: any) => (r.walletRef as string).startsWith('XREF:'))!;
    expect(xref.walletNo).toBeNull();
    expect(xref.walletRole).toBeNull();
    expect(xref.decimals).toBe(2);
    // wallet.findMany should not be called because all walletRefs are XREF
    expect((prisma.wallet.findMany as jest.Mock).mock.calls).toHaveLength(0);
  });
});

describe('getExternalBalanceByWallet', () => {
  it('returns balance + lines when walletNo + date match', async () => {
    const wallet = { id: 'W1', walletNo: 'WA-001', walletRole: 'C_VIBAN' };
    const balance = {
      id: 'b1', walletRef: 'W1', cutoffDate: '2026-06-28',
      source: 'ZAND', accountRef: 'ACC-1', currency: 'AED',
    };
    const lines = [
      { id: 'l1', direction: 'IN', amount: '100' },
      { id: 'l2', direction: 'OUT', amount: '50' },
    ];
    const prisma = {
      wallet: { findFirst: jest.fn().mockResolvedValue(wallet) },
      externalBalance: { findFirst: jest.fn().mockResolvedValue(balance) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue(lines) },
      asset: { findFirst: jest.fn().mockResolvedValue({ decimals: 2 }) },
    };
    const svc = mkSvc(prisma);
    const result: any = await svc.getExternalBalanceByWallet('WA-001', '2026-06-28');
    expect(result.walletNo).toBe('WA-001');
    expect(result.walletRole).toBe('C_VIBAN');
    expect(result.decimals).toBe(2);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toHaveProperty('direction');
    expect(result.lines[0]).toHaveProperty('amount');
  });

  it('throws 404 when walletNo not found in wallets table', async () => {
    const prisma = {
      wallet: { findFirst: jest.fn().mockResolvedValue(null) },
      externalBalance: { findFirst: jest.fn() },
      externalStatementLine: { findMany: jest.fn() },
    };
    const svc = mkSvc(prisma);
    await expect(svc.getExternalBalanceByWallet('WA-DOES-NOT-EXIST', '2026-06-28'))
      .rejects.toThrow(/no external balance for WA-DOES-NOT-EXIST/);
  });

  it('throws 404 when no externalBalance row for that walletRef + date', async () => {
    const wallet = { id: 'W1', walletNo: 'WA-001', walletRole: 'C_VIBAN' };
    const prisma = {
      wallet: { findFirst: jest.fn().mockResolvedValue(wallet) },
      externalBalance: { findFirst: jest.fn().mockResolvedValue(null) },
      externalStatementLine: { findMany: jest.fn() },
    };
    const svc = mkSvc(prisma);
    await expect(svc.getExternalBalanceByWallet('WA-001', '2099-01-01'))
      .rejects.toThrow(/no external balance for WA-001/);
  });
});

describe('listCases with runNo filter', () => {
  // Fixture: 2 runs, 3 cases
  //   case-a-only:  firstSeenRunId='run-a', lastUpdatedRunId='run-a'
  //   case-b-only:  firstSeenRunId='run-b', lastUpdatedRunId='run-b'
  //   case-both:    firstSeenRunId='run-a', lastUpdatedRunId='run-b'
  const caseAOnly = {
    id: 'ca', caseNo: 'CASE-A', status: 'OPEN',
    firstSeenRunId: 'run-a', lastUpdatedRunId: 'run-a',
    createdAt: new Date(),
  };
  const caseBOnly = {
    id: 'cb', caseNo: 'CASE-B', status: 'OPEN',
    firstSeenRunId: 'run-b', lastUpdatedRunId: 'run-b',
    createdAt: new Date(),
  };
  const caseBoth = {
    id: 'cc', caseNo: 'CASE-BOTH', status: 'OPEN',
    firstSeenRunId: 'run-a', lastUpdatedRunId: 'run-b',
    createdAt: new Date(),
  };

  function mkPrismaRunNo(allCases: any[], runRow: { id: string; runNo: string } | null) {
    return {
      reconciliationCase: {
        // Simulate Prisma's OR filter: when where.OR is present, only return rows
        // that match firstSeenRunId OR lastUpdatedRunId against the filter run id.
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.OR) {
            const ids = where.OR.flatMap((clause: any) =>
              Object.values(clause) as string[]
            );
            return Promise.resolve(
              allCases.filter((c: any) =>
                ids.includes(c.firstSeenRunId) || ids.includes(c.lastUpdatedRunId)
              )
            );
          }
          return Promise.resolve(allCases);
        }),
      },
      reconciliationRun: {
        // findUnique: resolves runNo → run row (used by new runNo filter)
        findUnique: jest.fn().mockResolvedValue(runRow),
        // findMany: resolves run ids → runNo for decoration (existing path)
        findMany: jest.fn().mockResolvedValue(
          runRow ? [runRow] : [],
        ),
        // Task 5（读面翻转）：demoScenarios 气泡数据源查询——本组用例不关心气泡。
        findFirst: jest.fn().mockResolvedValue(null),
      },
      // 平账一期半（T7 案件读面）：过滤后仍有 2 行，会触发新增的 groupBy/findMany
      // （另一条 runNo 不存在的用例在到达这里之前就已经 return [] 短路）。
      // 平账二期 Task 8：同一 reconciliationDisposition 模型上再加一条 findMany
      // （退汇账单行徽标）；列表徽标另两条查询也一并跟上。
      reconciliationDisposition: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
      reconciliationLineItem: { groupBy: jest.fn().mockResolvedValue([]) },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      internalTransfer: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
  }

  it('filters by runNo (matching firstSeenRunId OR lastUpdatedRunId)', async () => {
    const prisma = mkPrismaRunNo([caseAOnly, caseBOnly, caseBoth], { id: 'run-a', runNo: 'REC-A' });
    const svc = mkSvc(prisma);
    const result = await svc.listCases({ runNo: 'REC-A' });
    expect(result.length).toBe(2); // case-a-only and case-both
    expect(result.every((c: any) =>
      c.firstSeenRunNo === 'REC-A' || c.lastUpdatedRunNo === 'REC-A'
    )).toBe(true);
  });

  it('returns empty list when runNo does not exist', async () => {
    const prisma = mkPrismaRunNo([], null);
    const svc = mkSvc(prisma);
    const result = await svc.listCases({ runNo: 'REC-DOES-NOT-EXIST' });
    expect(result).toEqual([]);
  });
});

// ─── T6 ──────────────────────────────────────────────────────────────────────

describe('getRun — reads reconciliationRunWallet snapshot rows (T6)', () => {
  const run = {
    id: 'run-snap-1',
    runNo: 'RUN20260703-1',
    businessDate: '2026-07-03',
    layer: 'WALLET',
    demoManifest: null,
    walletCount: 2,
    matchedCount: 1,
    inTransitCount: 0,
    softFlagCount: 1,
    breakCount: 0,
    openedCount: 1,
    reObservedCount: 0,
    closedCount: 0,
  };

  it('getRun：从 reconciliationRunWallet 快照表读钱包表，不再调 balanceChecker/matcher；summary 直接用 run 行的四桶计数+三元组', async () => {
    const snapshotRows = [
      {
        walletRef: 'walletA', assetCode: 'AED', book: 'CUSTOMER', coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
        ownerNo: 'CU-1', bucket: 'MATCHED',
        internalTotal: new Prisma.Decimal(1000), externalClosing: new Prisma.Decimal(1000), deltaAmount: new Prisma.Decimal(0),
        inTransitAmount: new Prisma.Decimal(0), matchedCount: 2, orphanInternal: 0, orphanExternal: 0, mismatchCount: 0,
        inTransitCount: 0, caseNo: null,
      },
      {
        walletRef: 'walletB', assetCode: 'AED', book: 'CUSTOMER', coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
        ownerNo: 'CU-2', bucket: 'COMPENSATING',
        internalTotal: new Prisma.Decimal(500), externalClosing: new Prisma.Decimal(500), deltaAmount: new Prisma.Decimal(0),
        inTransitAmount: new Prisma.Decimal(0), matchedCount: 0, orphanInternal: 0, orphanExternal: 1, mismatchCount: 0,
        inTransitCount: 0, caseNo: 'REC20260703-001',
      },
    ];
    // T6: walletBalanceChecker is no longer a constructor dependency (getRun
    // reads the snapshot table, not a recompute) — only flowMatcher remains
    // to verify against.
    const flowMatcher = { matchFlows: jest.fn() };
    const prisma: any = {
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue(run) },
      reconciliationCase: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationRunWallet: { findMany: jest.fn().mockResolvedValue(snapshotRows) },
      wallet: { findMany: jest.fn().mockResolvedValue([]) },
      // T4: asset.decimals per row (both snapshot rows are AED).
      asset: { findMany: jest.fn().mockResolvedValue([{ code: 'AED', decimals: 2 }]) },
    };
    const svc = mkSvc(prisma, { flowMatcher });
    const result: any = await svc.getRun(run.runNo);

    expect(prisma.reconciliationRunWallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ runId: run.id }) }),
    );
    expect(flowMatcher.matchFlows).not.toHaveBeenCalled();

    expect(result.accountStatusTable).toHaveLength(2);
    const a = result.accountStatusTable.find((r: any) => r.walletRef === 'walletA');
    expect(a.bucket).toBe('MATCHED');
    expect(a.caseNo).toBeNull();
    const b = result.accountStatusTable.find((r: any) => r.walletRef === 'walletB');
    expect(b.bucket).toBe('COMPENSATING');
    expect(b.caseNo).toBe('REC20260703-001');
    expect(b.inTransitAmount).toBeDefined();

    expect(result.summary.walletCount).toBe(2);
    expect(result.summary.matchedCount).toBe(1);
    expect(result.summary.inTransitCount).toBe(0);
    expect(result.summary.softFlagCount).toBe(1);
    expect(result.summary.breakCount).toBe(0);
    expect(result.summary.openedCount).toBe(1);
    expect(result.summary.reObservedCount).toBe(0);
    expect(result.summary.closedCount).toBe(0);
  });

  it('getRun：旧 run（无快照行，legacy）返回空钱包表 + legacy:true 标记', async () => {
    const legacyRun = { ...run, runNo: 'RUN-LEGACY-1', id: 'run-legacy' };
    const prisma: any = {
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue(legacyRun) },
      reconciliationCase: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationRunWallet: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = mkSvc(prisma);
    const result: any = await svc.getRun('RUN-LEGACY-1');
    expect(result.legacy).toBe(true);
    expect(result.accountStatusTable).toEqual([]);
  });
});

describe('getCase — explain / observation / bucket (T6)', () => {
  const firstSeenRun = { id: 'run-first', runNo: 'RUN20260630-1', startedAt: new Date('2026-06-30T08:00:00Z') };
  const lastObservedRun = { id: 'run-last', runNo: 'RUN20260703-2', startedAt: new Date('2026-07-03T08:00:00Z'), completedAt: new Date('2026-07-03T08:05:00Z'), businessDate: '2026-07-03' };

  function mkKase(overrides: Record<string, unknown> = {}) {
    return {
      id: 'case-explain-1',
      caseNo: 'REC20260630-005',
      walletRef: 'walletX',
      businessDate: '2026-06-30', // frozen at first-seen day — must NOT drive cutoff (T5 leftover fix)
      status: 'OPEN',
      bucket: 'IN_TRANSIT',
      tbAmount: new Prisma.Decimal(1000),
      actualExternal: new Prisma.Decimal(1200),
      deltaAmount: new Prisma.Decimal(200),
      firstSeenRunId: 'run-first',
      lastObservedRunId: 'run-last',
      lastUpdatedRunId: 'run-last',
      closedByRunId: null,
      createdAt: new Date('2026-06-30T08:00:00Z'),
      lineItems: [
        {
          id: 'li-1', matchStatus: 'IN_TRANSIT', externalDirection: 'IN',
          externalAmount: new Prisma.Decimal(200), internalSourceNo: 'FO-2026-000123',
          foundByRunId: 'run-last',
        },
      ],
      ...overrides,
    };
  }

  function mkPrismaCase(kaseOverrides: Record<string, unknown> = {}) {
    return {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(mkKase(kaseOverrides)) },
      wallet: { findUnique: jest.fn().mockResolvedValue(null) },
      reconciliationRun: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.id === 'run-first') return Promise.resolve(firstSeenRun);
          if (where.id === 'run-last') return Promise.resolve(lastObservedRun);
          return Promise.resolve(null);
        }),
        // ⚡ 差异行级推荐（本任务）：真实钱包案件会无条件发一次 findFirst 反查
        // demoManifest——真实/pass 轮场景，返回 null 即可。
        findFirst: jest.fn().mockResolvedValue(null),
      },
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue([]) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([]) },
      // T4 push-disposition: getCase batch-looks up in-transit funds orders'
      // status to badge "已推进·待重对账". No matching row here → status null,
      // fundsOrderNo still comes from li.internalSourceNo (asserted below).
      fundsOrder: { findMany: jest.fn().mockResolvedValue([]) },
      // T4/T1: asset.decimals lookup (getCase unconditional + buildFlowComparison).
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: 2 }) },
      // Task 7: getCase's案件级 adjustments 查询是 unconditional，总会发一次。
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账一期半（T7 案件读面）：getCase 的行注解块同样 unconditional 发一次。
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账二期 Task 8：补款 / 垫款回挂块的划转单查询同样 unconditional。
      internalTransfer: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账三期 Task 9：案件级事故摘要查询同样 unconditional。
      incident: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
  }

  it('返回体含 explain{internalTotal,externalClosing,delta,inTransitSigned,residual} 与 observation{firstSeenRunNo,firstSeenAt,lastObservedRunNo,reObservedCount,closedByRunNo,ageDays} 与 bucket；IN_TRANSIT line item 带 fundsOrderNo', async () => {
    const prisma = mkPrismaCase();
    const svc = mkSvc(prisma);
    const result: any = await svc.getCase('REC20260630-005');

    expect(result.bucket).toBe('IN_TRANSIT');

    expect(result.explain.internalTotal).toBe('1000');
    expect(result.explain.externalClosing).toBe('1200');
    expect(result.explain.delta).toBe('200');
    expect(result.explain.inTransitSigned).toBe('200'); // one IN_TRANSIT line, direction IN → +200
    expect(result.explain.residual).toBe('0'); // 200 - 200

    expect(result.observation.firstSeenRunNo).toBe('RUN20260630-1');
    expect(result.observation.firstSeenAt).toBeTruthy();
    expect(result.observation.lastObservedRunNo).toBe('RUN20260703-2');
    expect(result.observation.closedByRunNo).toBeNull(); // status=OPEN
    expect(result.observation.ageDays).toBeGreaterThanOrEqual(0);

    const inTransitRow = result.flowComparison.find((r: any) => r.matchType === 'IN_TRANSIT');
    expect(inTransitRow).toBeDefined();
    expect(inTransitRow.fundsOrderNo).toBe('FO-2026-000123');
  });

  it('IN_TRANSIT line item 带 externalTimestamp → 下发真实 ISO 串（红3甲·读端）', async () => {
    const at = new Date('2026-06-25T16:00:00Z');
    const prisma = mkPrismaCase({
      bucket: 'IN_TRANSIT',
      lineItems: [{
        id: 'li-ts', matchStatus: 'IN_TRANSIT', externalDirection: 'IN',
        externalAmount: new Prisma.Decimal(200), internalSourceNo: 'FO-2026-000123',
        foundByRunId: 'run-last', externalTimestamp: at,
      }],
    });
    const svc = mkSvc(prisma);
    const result: any = await svc.getCase('REC20260630-005');
    const row = result.flowComparison.find((r: any) => r.matchType === 'IN_TRANSIT');
    expect(row.externalLine.timestamp).toBe('2026-06-25T16:00:00.000Z');
  });

  it('IN_TRANSIT line item 无 externalTimestamp → 下发 null 而非 epoch（红3甲·读端）', async () => {
    const prisma = mkPrismaCase(); // 既有夹具 li-1 不带 externalTimestamp
    const svc = mkSvc(prisma);
    const result: any = await svc.getCase('REC20260630-005');
    const row = result.flowComparison.find((r: any) => r.matchType === 'IN_TRANSIT');
    expect(row.externalLine.timestamp).toBeNull();
  });

  it('observation.closedByRunNo 在 status=RESOLVED 时解析 closedByRunId', async () => {
    const closedRun = { id: 'run-closed', runNo: 'RUN20260703-3' };
    const prisma = mkPrismaCase({ status: 'RESOLVED', closedByRunId: 'run-closed' });
    prisma.reconciliationRun.findUnique = jest.fn().mockImplementation(({ where }: any) => {
      if (where.id === 'run-first') return Promise.resolve(firstSeenRun);
      if (where.id === 'run-last') return Promise.resolve(lastObservedRun);
      if (where.id === 'run-closed') return Promise.resolve(closedRun);
      return Promise.resolve(null);
    });
    const svc = mkSvc(prisma);
    const result: any = await svc.getCase('REC20260630-005');
    expect(result.observation.closedByRunNo).toBe('RUN20260703-3');
    expect(result.observation.ageDays).toBeNull(); // not OPEN → no aging
  });

  it('buildFlowComparison cutoff 来自 lastObservedRunId 关联 run 的 completedAt/businessDate，而非 case.businessDate（跨日复用不读过期数据）', async () => {
    const prisma = mkPrismaCase();
    const svc = mkSvc(prisma);
    await svc.getCase('REC20260630-005');
    // case.businessDate = '2026-06-30' (frozen at first-seen); lastObservedRun.businessDate = '2026-07-03'.
    // The cutoff passed to externalStatementLine/accountFlow lookups must reflect 2026-07-03, not 2026-06-30.
    const extCall = (prisma.externalStatementLine.findMany as jest.Mock).mock.calls[0][0];
    expect(extCall.where.datetime.lte.toISOString().slice(0, 10)).toBe('2026-07-03');
  });
});

// Task 7（调账单 admin 前端 · 控制方裁定）：案件级调账单列表 adjustments，按
// caseNo 直查，不依赖 lineItems 是否为空、不依赖 lineItemId 是否非空——lineItemId
// 为 null（新表单开单的常态，见 adjustment-rules.ts/CreateAdjustmentDto 顶部注释）
// 的行也必须出现在这份列表里，这正是本任务要解决的问题（brief 原方案的"整行置灰"
// 做不到：flowComparison 行 id 和 ReconciliationLineItem.id 不是一张表）。
//
// Fix 6（末站整改）：Task 6 曾在这里另建一条按 lineItemId 精确匹配的查询，把
// { adjustmentNo, status } 挂到每条差异项上供前端"整行置灰"；Task 7 之后该用途
// 被这条 caseNo 查询取代，且前端从未渲染过 kase.lineItems——查询与它的两条专属
// 测试（"已开调账单的行返回..."/"案件没有任何行项目时旧的 lineItemId IN 查询短
// 路..."）随 decoratedLineItems 一并删除；getCase 现在只发这一条
// reconciliationAdjustment 查询，下面两个测试相应从"第 1/2 次调用"改成单次调用。
describe('getCase — 案件级调账单列表 adjustments（Task 7）', () => {
  const run = { id: 'run-adj2', runNo: 'REC-ADJ2' };

  function mkKase(overrides: Record<string, unknown> = {}) {
    return {
      id: 'case-adj-2',
      caseNo: 'REC20260828-ADJ',
      walletRef: 'walletAdj2',
      businessDate: '2026-08-28',
      status: 'OPEN',
      bucket: 'BREAK',
      tbAmount: new Prisma.Decimal(0),
      actualExternal: new Prisma.Decimal(0),
      deltaAmount: new Prisma.Decimal(0),
      firstSeenRunId: null,
      lastObservedRunId: null,
      lastUpdatedRunId: null,
      openedByRunId: 'run-adj2',
      closedByRunId: null,
      createdAt: new Date('2026-08-28T00:00:00Z'),
      lineItems: [{ id: 'li-x', matchStatus: 'AMOUNT_MISMATCH', foundByRunId: 'run-adj2' }],
      ...overrides,
    };
  }

  function mkPrismaBase(kaseOverrides: Record<string, unknown> = {}) {
    return {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(mkKase(kaseOverrides)) },
      wallet: { findUnique: jest.fn().mockResolvedValue(null) },
      // ⚡ 差异行级推荐（本任务）：真实钱包案件会无条件发一次 findFirst 反查
      // demoManifest——真实/pass 轮场景，返回 null 即可。
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue(run), findFirst: jest.fn().mockResolvedValue(null) },
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue([]) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([]) },
      fundsOrder: { findMany: jest.fn().mockResolvedValue([]) },
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: 2 }) },
      // 平账一期半（T7 案件读面）：getCase 的行注解块同样 unconditional 发一次。
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账二期 Task 8：补款 / 垫款回挂块的划转单查询同样 unconditional。
      internalTransfer: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账三期 Task 9：案件级事故摘要查询同样 unconditional。
      incident: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
  }

  it('返回体含案件级 adjustments 数组，形状 { adjustmentNo, status, reasonCode, direction, amount }；查询按 caseNo 过滤（Fix 6 之后 getCase 只发这一条 reconciliationAdjustment 查询——Task 6 的 lineItemId IN 查询已随 decoratedLineItems 一并删除）', async () => {
    const prisma = mkPrismaBase();
    const rows = [
      { adjustmentNo: 'ADJ20260828001', status: 'POSTED', reasonCode: 'BANK_INTEREST_UNBOOKED', direction: 'INCREASE', amount: '500' },
      { adjustmentNo: 'ADJ20260828002', status: 'PENDING_APPROVAL', reasonCode: 'AMT_MISBOOKED', direction: 'REDUCE', amount: '1200' },
    ];
    prisma.reconciliationAdjustment = {
      findMany: jest.fn().mockResolvedValue(rows),
    };
    const svc = mkSvc(prisma);
    const result: any = await svc.getCase('REC20260828-ADJ');

    expect(result.adjustments).toEqual(rows);

    const calls = (prisma.reconciliationAdjustment.findMany as jest.Mock).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0].where).toEqual({ caseNo: 'REC20260828-ADJ' });
  });

  it('lineItemId 为 null 的行（新表单开单的常态）照样出现在 adjustments 里——这是本任务要解决的核心问题，旧的 lineItemId 标记查询做不到这一点', async () => {
    const prisma = mkPrismaBase();
    const rowWithNullLineItemId = {
      adjustmentNo: 'ADJ20260828004', status: 'DRAFT', reasonCode: 'AMT_MISBOOKED',
      direction: 'INCREASE', amount: '900',
    };
    prisma.reconciliationAdjustment = {
      findMany: jest.fn().mockResolvedValue([rowWithNullLineItemId]),
    };
    const svc = mkSvc(prisma);
    const result: any = await svc.getCase('REC20260828-ADJ');
    expect(result.adjustments).toEqual([rowWithNullLineItemId]);
  });

  it('案件没有任何行项目时：案件级 caseNo 查询照常发——不依赖 lineItems 是否为空', async () => {
    const prisma = mkPrismaBase({ lineItems: [] });
    const rows = [
      { adjustmentNo: 'ADJ20260828003', status: 'DRAFT', reasonCode: 'BANK_CHARGE_UNBOOKED', direction: 'REDUCE', amount: '300' },
    ];
    const findMany = jest.fn().mockResolvedValue(rows);
    prisma.reconciliationAdjustment = { findMany };
    const svc = mkSvc(prisma);
    const result: any = await svc.getCase('REC20260828-ADJ');

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toEqual({ caseNo: 'REC20260828-ADJ' });
    expect(result.adjustments).toEqual(rows);
  });
});

describe('listCases — bucket filter (T6)', () => {
  it('q.bucket 过滤生效', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { reconciliationCase: { findMany }, reconciliationRun: { findMany: jest.fn().mockResolvedValue([]) } };
    const svc = mkSvc(prisma);
    await svc.listCases({ bucket: 'IN_TRANSIT' } as any);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ bucket: 'IN_TRANSIT' }),
    }));
  });

  it('未传 bucket 时不加筛选条件（undefined 等价不筛）', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { reconciliationCase: { findMany }, reconciliationRun: { findMany: jest.fn().mockResolvedValue([]) } };
    const svc = mkSvc(prisma);
    await svc.listCases({});
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ bucket: undefined }),
    }));
  });
});

// ─── 平账一期半 T7（案件读面）──────────────────────────────────────────────
// 行注解三件套（disposition / duplicateTwinRef / menu）+ 列表进度计数 + decimals。
// 与「getCase — 案件级调账单列表 adjustments（Task 7）」是两个不同批次的 Task 7
// （旧编号撞车，见该 describe 块上方注释）——这里的 T7 特指 2026-09-01 平账一期半
// 计划的第 7 个任务。

describe('getCase 行注解（spec §3/§8）', () => {
  const baseKase = {
    id: 'case-anno-1',
    caseNo: 'REC-ANNO-001',
    walletRef: 'walletAnno',
    businessDate: '2026-06-27',
    lineItems: [] as any[],
    openedByRunId: 'run-anno',
    lastUpdatedRunId: null,
    slaDeadline: null,
    book: 'CLIENT',
    status: 'OPEN',
    bucket: 'BREAK',
    createdAt: new Date('2026-06-27T00:00:00Z'),
    tbAmount: new Prisma.Decimal(0),
    actualExternal: new Prisma.Decimal(0),
    deltaAmount: new Prisma.Decimal(0),
    firstSeenRunId: null,
    lastObservedRunId: null,
    closedByRunId: null,
  };

  // Common plumbing every getCase() call touches regardless of scenario —
  // mirrors the "getCase — flowComparison (T3)" fixtures' mock shape.
  function mkBasePrisma(overrides: Record<string, any> = {}) {
    return {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(baseKase) },
      wallet: { findUnique: jest.fn().mockResolvedValue(null) },
      // ⚡ 差异行级推荐（本任务）：真实钱包案件会无条件发一次 findFirst 反查
      // demoManifest——默认无 manifest（真实/pass 轮），个别用例按需 override。
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue({ id: 'run-anno', runNo: 'REC-ANNO-RUN' }), findFirst: jest.fn().mockResolvedValue(null) },
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: 2 }) },
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([]) },
      fundsOrder: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账二期 Task 8：补款 / 垫款回挂块的划转单查询同样 unconditional。
      internalTransfer: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账三期 Task 9：案件级事故摘要查询同样 unconditional。
      incident: { findMany: jest.fn().mockResolvedValue([]) },
      ...overrides,
    } as any;
  }

  it('ORPHAN_INTERNAL 行：已匹配里有同 ref 同额行 → duplicateTwinRef 命中；其余为 null', async () => {
    // 银行只报一次「REF-DUP / 100」；我方入了两次——一次被匹配器认领配对
    // （int-dup-matched），一次没有对应外部行、成了孤儿（int-dup-orphan）。
    // int-dup-diffamt 同参考号「REF-DUP」但金额是 50——单独验证复合键里「金额也要
    // 比」这一半（评审 Important：此前唯一的反例 int-other-orphan 连参考号都跟
    // 已匹配池不一样，key 弱化成只比参考号也测不出来，42 个用例全绿一条没红）。
    // int-other-orphan 的 (ref, amount) 跟已匹配池毫无交集，是「假信号」对照组：
    // 不该被误标成双胞胎线索。
    const externalLines = [
      { id: 'ext-dup', direction: 'IN', amount: new Prisma.Decimal(100), externalRef: 'REF-DUP', datetime: new Date('2026-06-27T10:00:00Z'), description: null },
    ];
    const internalFlows = [
      { id: 'int-dup-matched', direction: 'IN', amount: new Prisma.Decimal(100), externalRef: 'REF-DUP', eventCode: 'DEPOSIT_IN', sourceType: 'PAYIN', sourceNo: 'PAY-DUP-1', createdAt: new Date('2026-06-27T10:00:05Z') },
      { id: 'int-dup-orphan', direction: 'IN', amount: new Prisma.Decimal(100), externalRef: 'REF-DUP', eventCode: 'DEPOSIT_IN', sourceType: 'PAYIN', sourceNo: 'PAY-DUP-2', createdAt: new Date('2026-06-27T10:05:00Z') },
      { id: 'int-dup-diffamt', direction: 'IN', amount: new Prisma.Decimal(50), externalRef: 'REF-DUP', eventCode: 'DEPOSIT_IN', sourceType: 'PAYIN', sourceNo: 'PAY-DUP-3', createdAt: new Date('2026-06-27T10:10:00Z') },
      { id: 'int-other-orphan', direction: 'OUT', amount: new Prisma.Decimal(999), externalRef: 'REF-OTHER', eventCode: 'WITHDRAW_OUT', sourceType: 'WITHDRAW', sourceNo: 'WD-OTHER', createdAt: new Date('2026-06-27T11:00:00Z') },
    ];
    const prisma = mkBasePrisma({
      externalBalance: { findMany: jest.fn().mockResolvedValue([{ accountRef: 'ACC-ANNO' }]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue(externalLines) },
      accountFlow: { findMany: jest.fn().mockResolvedValue(internalFlows) },
    });
    const flowMatcher = {
      matchFlows: jest.fn().mockResolvedValue({
        matched: [{ internalFlowId: 'int-dup-matched', externalLineId: 'ext-dup' }],
        orphanInternal: [
          { internalFlowId: 'int-dup-orphan' },
          { internalFlowId: 'int-dup-diffamt' },
          { internalFlowId: 'int-other-orphan' },
        ],
        orphanExternal: [],
        mismatch: [],
      }),
    };
    const svc = mkSvc(prisma, { flowMatcher });
    const result: any = await svc.getCase(baseKase.caseNo);

    const dupOrphan = result.flowComparison.find((r: any) => r.internalFlow?.id === 'int-dup-orphan');
    expect(dupOrphan.matchType).toBe('ORPHAN_INTERNAL');
    expect(dupOrphan.duplicateTwinRef).toBe('REF-DUP');

    // 同参考号、金额不同——复合键必须把这行判定为不命中，否则「金额也要比」这条
    // 规则形同虚设（只比参考号也会让这行显示出线索，但它其实不是同一笔银行来账）。
    const diffAmtOrphan = result.flowComparison.find((r: any) => r.internalFlow?.id === 'int-dup-diffamt');
    expect(diffAmtOrphan.duplicateTwinRef).toBeNull();

    const otherOrphan = result.flowComparison.find((r: any) => r.internalFlow?.id === 'int-other-orphan');
    expect(otherOrphan.duplicateTwinRef).toBeNull();

    // MATCHED 行整体跳过注解循环（continue）——三个注解字段都不应该被赋值。
    const matchedRow = result.flowComparison.find((r: any) => r.matchType === 'MATCHED');
    expect(matchedRow.duplicateTwinRef).toBeUndefined();
  });

  // Task 5（读面翻转）：expected 值不手写字面量清单——跟实现一样调 dispositionsFor/
  // causesFor 现算，保持「唯一真相在注册表」这条既有惯例（旧 menuFor 测试同款写法）。
  const expectedDispositions = (
    matchType: 'AMOUNT_MISMATCH' | 'ORPHAN_INTERNAL' | 'ORPHAN_EXTERNAL',
    book: 'CLIENT' | 'FIRM',
    facts: { internalDirection?: 'IN' | 'OUT'; internalSourceType?: string; externalDirection?: 'IN' | 'OUT' } = {},
  ) =>
    dispositionsFor({ matchType, book, ...facts }).map((kind) => ({
      kind, label: DISPOSITION_LABEL[kind],
      // Task 9（缺口 1）：SUPPLEMENT 三码按账单行方向过滤——镜像实现里的同一条
      // requiredDirection 判据，不许测试用例自己重复一份独立口径。
      causes: kind === 'SUPPLEMENT'
        ? causesFor(kind, matchType, book).filter((c) => CAUSE_REGISTRY[c.code].requiredDirection === facts.externalDirection)
        : causesFor(kind, matchType, book),
    }));

  it('三类差异行带 dispositions（该格合法处置清单 + 组内成因，Task 5 读面翻转）；MATCHED/IN_TRANSIT 不带；r.menu 不再下发', async () => {
    const externalLines = [
      { id: 'ext-m',  direction: 'IN', amount: new Prisma.Decimal(400), externalRef: 'REF-M',  datetime: new Date('2026-06-27T09:00:00Z'), description: null },
      { id: 'ext-oe', direction: 'IN', amount: new Prisma.Decimal(150), externalRef: 'REF-OE', datetime: new Date('2026-06-27T09:30:00Z'), description: null },
      { id: 'ext-mm', direction: 'IN', amount: new Prisma.Decimal(300), externalRef: 'REF-MM', datetime: new Date('2026-06-27T10:00:00Z'), description: null },
    ];
    const internalFlows = [
      { id: 'int-m',  direction: 'IN',  amount: new Prisma.Decimal(400), externalRef: 'REF-M',  eventCode: 'DEPOSIT_IN',   sourceType: 'DEPOSIT',  sourceNo: 'PAY-M',  createdAt: new Date('2026-06-27T09:00:05Z') },
      { id: 'int-oi', direction: 'OUT', amount: new Prisma.Decimal(77),  externalRef: 'REF-OI', eventCode: 'WITHDRAW_OUT', sourceType: 'WITHDRAW', sourceNo: 'WD-OI',  createdAt: new Date('2026-06-27T09:45:00Z') },
      { id: 'int-mm', direction: 'IN',  amount: new Prisma.Decimal(310), externalRef: 'REF-MM', eventCode: 'DEPOSIT_IN',   sourceType: 'DEPOSIT',  sourceNo: 'PAY-MM', createdAt: new Date('2026-06-27T10:00:05Z') },
    ];
    const prisma = mkBasePrisma({
      externalBalance: { findMany: jest.fn().mockResolvedValue([{ accountRef: 'ACC-ANNO' }]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue(externalLines) },
      accountFlow: { findMany: jest.fn().mockResolvedValue(internalFlows) },
      // 案件带一条 IN_TRANSIT line item——追加段生成的行必须也验一遍不带 dispositions。
      reconciliationCase: {
        findUnique: jest.fn().mockResolvedValue({
          ...baseKase,
          lineItems: [{
            id: 'li-it', matchStatus: 'IN_TRANSIT', externalDirection: 'IN',
            externalAmount: new Prisma.Decimal(50), internalSourceNo: 'FO-MENU-1',
            foundByRunId: 'run-anno',
          }],
        }),
      },
    });
    const flowMatcher = {
      matchFlows: jest.fn().mockResolvedValue({
        matched: [{ internalFlowId: 'int-m', externalLineId: 'ext-m' }],
        orphanInternal: [{ internalFlowId: 'int-oi' }],
        orphanExternal: [{ externalLineId: 'ext-oe' }],
        mismatch: [{ internalFlowId: 'int-mm', externalLineId: 'ext-mm' }],
      }),
    };
    const svc = mkSvc(prisma, { flowMatcher });
    const result: any = await svc.getCase(baseKase.caseNo);

    // book='CLIENT'（baseKase 显式设置）——三格 dispositions 跟 Task 1 注册表按格
    // 现算的结果逐字相等；r.menu 是被取代的旧字段，本任务起恒 undefined。
    const orphanInt = result.flowComparison.find((r: any) => r.matchType === 'ORPHAN_INTERNAL');
    expect(orphanInt.dispositions).toEqual(
      expectedDispositions('ORPHAN_INTERNAL', 'CLIENT', { internalDirection: 'OUT', internalSourceType: 'WITHDRAW' }),
    );
    expect(orphanInt.dispositions[0].kind).toBe('REVERSE'); // dispositionsFor 声明顺序第一位
    expect(orphanInt.dispositions[0].causes[0].code).toBe('DUP_BOOKING'); // 手册顺序第一位
    expect(orphanInt.menu).toBeUndefined();

    const orphanExt = result.flowComparison.find((r: any) => r.matchType === 'ORPHAN_EXTERNAL');
    expect(orphanExt.dispositions).toEqual(
      expectedDispositions('ORPHAN_EXTERNAL', 'CLIENT', { externalDirection: 'IN' }),
    );
    expect(orphanExt.menu).toBeUndefined();

    const mismatch = result.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH');
    expect(mismatch.dispositions).toEqual(
      expectedDispositions('AMOUNT_MISMATCH', 'CLIENT', { internalDirection: 'IN', internalSourceType: 'DEPOSIT' }),
    );
    expect(mismatch.dispositions.some((d: any) => d.kind === 'CORRECT')).toBe(true); // DEPOSIT 可冲正
    expect(mismatch.menu).toBeUndefined();

    const matchedRow = result.flowComparison.find((r: any) => r.matchType === 'MATCHED');
    expect(matchedRow.dispositions).toBeUndefined();
    expect(matchedRow.menu).toBeUndefined();

    const inTransitRow = result.flowComparison.find((r: any) => r.matchType === 'IN_TRANSIT');
    expect(inTransitRow).toBeDefined();
    expect(inTransitRow.dispositions).toBeUndefined();
    expect(inTransitRow.menu).toBeUndefined();
  });

  it('波四：AMOUNT_MISMATCH 行下发 adjustmentPrefill（出账翻符号：OUT + delta 正 → REDUCE）', async () => {
    // 内部 WITHDRAW 记 95（OUT），银行实扣 100（IN 视角的外部行）——原始差 external(100) −
    // internal(95) = +5，内部方向 OUT 触发 resolveWriteOff 的出账翻符号 → REDUCE
    // （旧前端 rowAdjustmentPrefill 漏了这一步会算成 INCREASE，回显 mock 骗不过这条断言）。
    const externalLines = [
      { id: 'ext-match', direction: 'IN', amount: new Prisma.Decimal(200), externalRef: 'REF-MATCH', datetime: new Date('2026-06-27T08:00:00Z'), description: null },
      { id: 'ext-am',    direction: 'IN', amount: new Prisma.Decimal(100), externalRef: 'REF-AM',    datetime: new Date('2026-06-27T09:00:00Z'), description: null },
    ];
    const internalFlows = [
      { id: 'int-match', direction: 'IN',  amount: new Prisma.Decimal(200), externalRef: 'REF-MATCH', eventCode: 'DEPOSIT_IN',   sourceType: 'DEPOSIT',  sourceNo: 'PAY-MATCH', createdAt: new Date('2026-06-27T08:00:05Z') },
      { id: 'int-am',    direction: 'OUT', amount: new Prisma.Decimal(95),  externalRef: 'REF-AM',    eventCode: 'WITHDRAW_OUT', sourceType: 'WITHDRAW', sourceNo: 'WD-AM',     createdAt: new Date('2026-06-27T09:00:05Z') },
    ];
    const prisma = mkBasePrisma({
      externalBalance: { findMany: jest.fn().mockResolvedValue([{ accountRef: 'ACC-ANNO' }]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue(externalLines) },
      accountFlow: { findMany: jest.fn().mockResolvedValue(internalFlows) },
      // 案件带一条 IN_TRANSIT line item——同款附加行也要验一遍不带 adjustmentPrefill。
      reconciliationCase: {
        findUnique: jest.fn().mockResolvedValue({
          ...baseKase,
          lineItems: [{
            id: 'li-it-am', matchStatus: 'IN_TRANSIT', externalDirection: 'IN',
            externalAmount: new Prisma.Decimal(50), internalSourceNo: 'FO-AM-1',
            foundByRunId: 'run-anno',
          }],
        }),
      },
    });
    const flowMatcher = {
      matchFlows: jest.fn().mockResolvedValue({
        matched: [{ internalFlowId: 'int-match', externalLineId: 'ext-match' }],
        orphanInternal: [], orphanExternal: [],
        mismatch: [{ internalFlowId: 'int-am', externalLineId: 'ext-am' }],
      }),
    };
    const svc = mkSvc(prisma, { flowMatcher });
    const result: any = await svc.getCase(baseKase.caseNo);

    const mismatch = result.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH');
    expect(mismatch.adjustmentPrefill).toEqual({ amountMinor: '5', direction: 'REDUCE', reattributionSide: 'TO' });

    const matchedRow = result.flowComparison.find((r: any) => r.matchType === 'MATCHED');
    expect(matchedRow.adjustmentPrefill).toBeUndefined();

    const inTransitRow = result.flowComparison.find((r: any) => r.matchType === 'IN_TRANSIT');
    expect(inTransitRow).toBeDefined();
    expect(inTransitRow.adjustmentPrefill).toBeUndefined();
  });

  // 缺口 1（Task 9）：SUPPLEMENT 三码（MISSED_DEPOSIT/BOUNCED_FUNDS/PAYOUT_RETURNED）
  // 此前不分方向全出——IN 行能选中 OUT 专属的「退汇认领」，一路填到发起才被
  // assertClaimable 400。读面按 externalLine.direction 过滤，判据 = CAUSE_REGISTRY
  // 里的 requiredDirection（写端 resolveOutlet 用的同一份注册表字段）。
  it('ORPHAN_EXTERNAL × CLIENT：IN 行 SUPPLEMENT causes 只出 MISSED_DEPOSIT/PAYOUT_RETURNED，不含 OUT 专属的 BOUNCED_FUNDS（Task 9 缺口 1）', async () => {
    const externalLines = [
      { id: 'ext-supp-in', direction: 'IN', amount: new Prisma.Decimal(200), externalRef: 'REF-SUPP-IN', datetime: new Date('2026-06-27T09:00:00Z'), description: null },
    ];
    const prisma = mkBasePrisma({
      externalBalance: { findMany: jest.fn().mockResolvedValue([{ accountRef: 'ACC-ANNO' }]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue(externalLines) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const flowMatcher = {
      matchFlows: jest.fn().mockResolvedValue({
        matched: [], orphanInternal: [],
        orphanExternal: [{ externalLineId: 'ext-supp-in' }],
        mismatch: [],
      }),
    };
    const svc = mkSvc(prisma, { flowMatcher });
    const result: any = await svc.getCase(baseKase.caseNo);

    const row = result.flowComparison.find((r: any) => r.externalLine?.id === 'ext-supp-in');
    const supplement = row.dispositions.find((d: any) => d.kind === 'SUPPLEMENT');
    expect(supplement.causes.map((c: any) => c.code)).toEqual(['MISSED_DEPOSIT', 'PAYOUT_RETURNED']);
  });

  it('ORPHAN_EXTERNAL × CLIENT：OUT 行 SUPPLEMENT causes 只出 BOUNCED_FUNDS，不含 IN 专属的 MISSED_DEPOSIT/PAYOUT_RETURNED（Task 9 缺口 1）', async () => {
    const externalLines = [
      { id: 'ext-supp-out', direction: 'OUT', amount: new Prisma.Decimal(300), externalRef: 'REF-SUPP-OUT', datetime: new Date('2026-06-27T09:30:00Z'), description: null },
    ];
    const prisma = mkBasePrisma({
      externalBalance: { findMany: jest.fn().mockResolvedValue([{ accountRef: 'ACC-ANNO' }]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue(externalLines) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const flowMatcher = {
      matchFlows: jest.fn().mockResolvedValue({
        matched: [], orphanInternal: [],
        orphanExternal: [{ externalLineId: 'ext-supp-out' }],
        mismatch: [],
      }),
    };
    const svc = mkSvc(prisma, { flowMatcher });
    const result: any = await svc.getCase(baseKase.caseNo);

    const row = result.flowComparison.find((r: any) => r.externalLine?.id === 'ext-supp-out');
    const supplement = row.dispositions.find((d: any) => d.kind === 'SUPPLEMENT');
    expect(supplement.causes.map((c: any) => c.code)).toEqual(['BOUNCED_FUNDS']);
  });

  it('AMOUNT_MISMATCH × CLIENT 行 internalSourceType=SWAP → dispositions 不含 CORRECT（A1b 甲，读面联调）', async () => {
    const externalLines = [
      { id: 'ext-swap', direction: 'IN', amount: new Prisma.Decimal(200), externalRef: 'REF-SWAP', datetime: new Date('2026-06-27T09:00:00Z'), description: null },
    ];
    const internalFlows = [
      { id: 'int-swap', direction: 'IN', amount: new Prisma.Decimal(210), externalRef: 'REF-SWAP', eventCode: 'SWAP_IN', sourceType: 'SWAP', sourceNo: 'SWP-1', createdAt: new Date('2026-06-27T09:00:05Z') },
    ];
    const prisma = mkBasePrisma({
      externalBalance: { findMany: jest.fn().mockResolvedValue([{ accountRef: 'ACC-ANNO' }]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue(externalLines) },
      accountFlow: { findMany: jest.fn().mockResolvedValue(internalFlows) },
    });
    const flowMatcher = {
      matchFlows: jest.fn().mockResolvedValue({
        matched: [], orphanInternal: [], orphanExternal: [],
        mismatch: [{ internalFlowId: 'int-swap', externalLineId: 'ext-swap' }],
      }),
    };
    const svc = mkSvc(prisma, { flowMatcher });
    const result: any = await svc.getCase(baseKase.caseNo);
    const row = result.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH');
    expect(row.dispositions.map((d: any) => d.kind)).toEqual(['HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']);
    expect(row.dispositions.some((d: any) => d.kind === 'CORRECT')).toBe(false);
  });

  it('行有定性记录、未挂调账单 → disposition 注解（outletLabel 由存储 outlet 反查；family/reasonCode/direction 省略）', async () => {
    const externalLines: any[] = [];
    const internalFlows = [
      { id: 'int-anchor', direction: 'OUT', amount: new Prisma.Decimal(60), externalRef: 'REF-ANCHOR', eventCode: 'WITHDRAW_OUT', sourceType: 'WITHDRAW', sourceNo: 'WD-ANCHOR', createdAt: new Date('2026-06-27T12:00:00Z') },
    ];
    const dispositionRow = {
      dispositionNo: 'DISP-2026-000001',
      caseNo: baseKase.caseNo,
      explainedFlowId: 'int-anchor',   // 锚：内部流水 id
      explainedExternalLineId: null,
      matchType: 'ORPHAN_INTERNAL',
      book: 'CLIENT',
      causeCode: 'PHANTOM_BOOKING',
      outlet: 'ADJUST_REVERSE',        // 写端（Task 1-4）已存成 outletOf('REVERSE')
      deferredTarget: null,
      findingNote: '银行/链上查无此笔，客户确认未收到通知',
      adjustmentNo: null,               // 还没开调账单——family/reasonCode/direction 无处读，应省略
      incidentNo: 'INC2026000001',      // 平账三期（Task 9）：非空值证明是真透传，不是硬编码 null
      createdByUserId: 'user-ops-1',
      createdAt: new Date('2026-06-27T12:30:00Z'),
      updatedAt: new Date('2026-06-27T13:00:00Z'), // 比 createdAt 晚——用来验证「取 updatedAt 优先」
    };
    const prisma = mkBasePrisma({
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue(externalLines) },
      accountFlow: { findMany: jest.fn().mockResolvedValue(internalFlows) },
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([dispositionRow]) },
    });
    const flowMatcher = {
      matchFlows: jest.fn().mockResolvedValue({
        matched: [], orphanInternal: [{ internalFlowId: 'int-anchor' }], orphanExternal: [], mismatch: [],
      }),
    };
    const svc = mkSvc(prisma, { flowMatcher });
    const result: any = await svc.getCase(baseKase.caseNo);

    const row = result.flowComparison.find((r: any) => r.internalFlow?.id === 'int-anchor');
    expect(row.disposition).toEqual({
      dispositionNo: 'DISP-2026-000001',
      causeCode: 'PHANTOM_BOOKING',
      causeLabel: CAUSE_REGISTRY.PHANTOM_BOOKING.label,
      outlet: 'ADJUST_REVERSE',
      outletLabel: DISPOSITION_LABEL.REVERSE, // 存储 outlet 反查处置种类（KIND_OF_OUTLET）→ DISPOSITION_LABEL
      findingNote: '银行/链上查无此笔，客户确认未收到通知',
      adjustmentNo: null,
      deferredTarget: null,
      supplementNo: null,
      supplementRef: null,
      incidentNo: 'INC2026000001',
      createdBy: 'user-ops-1',
      createdAt: dispositionRow.updatedAt.toISOString(), // 优先 updatedAt，不是 createdAt
      // family/reasonCode/direction 没有——没开单，读面不替这个决定编答案。
    });
    expect(row.disposition.family).toBeUndefined();
    expect(row.disposition.reasonCode).toBeUndefined();
    expect(row.disposition.direction).toBeUndefined();

    // 反证：reconciliationDisposition.findMany 确实按 caseNo 过滤查询（① 的锚点）。
    expect((prisma.reconciliationDisposition.findMany as jest.Mock).mock.calls[0][0]).toEqual({
      where: { caseNo: baseKase.caseNo },
    });
  });

  it('行有定性记录且已挂调账单 → family/reasonCode/direction 从单上读（不是从成因反推）', async () => {
    const externalLines: any[] = [];
    const internalFlows = [
      { id: 'int-anchor2', direction: 'OUT', amount: new Prisma.Decimal(60), externalRef: 'REF-ANCHOR2', eventCode: 'WITHDRAW_OUT', sourceType: 'WITHDRAW', sourceNo: 'WD-ANCHOR2', createdAt: new Date('2026-06-27T12:00:00Z') },
    ];
    const dispositionRow = {
      dispositionNo: 'DISP-2026-000002',
      caseNo: baseKase.caseNo,
      explainedFlowId: 'int-anchor2',
      explainedExternalLineId: null,
      matchType: 'ORPHAN_INTERNAL',
      book: 'CLIENT',
      causeCode: 'PHANTOM_BOOKING',
      outlet: 'ADJUST_REVERSE',
      deferredTarget: null,
      findingNote: '银行/链上查无此笔',
      adjustmentNo: 'ADJ-2026-000001',  // 已联到调账单
      incidentNo: null,
      createdByUserId: 'user-ops-1',
      createdAt: new Date('2026-06-27T12:30:00Z'),
      updatedAt: new Date('2026-06-27T13:00:00Z'),
    };
    // 调账单本身按 AMT_MISBOOKED/INCREASE 开出——跟这条定性记录的成因
    // （PHANTOM_BOOKING → REVERSE 族）刻意不一致，用来证明读的是单上的字段而不是
    // 从 causeCode 反推出来的族。
    const linkedAdjustment = {
      adjustmentNo: 'ADJ-2026-000001', status: 'POSTED',
      reasonCode: 'AMT_MISBOOKED', direction: 'INCREASE', amount: '6000',
    };
    const prisma = mkBasePrisma({
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue(externalLines) },
      accountFlow: { findMany: jest.fn().mockResolvedValue(internalFlows) },
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([dispositionRow]) },
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([linkedAdjustment]) },
    });
    const flowMatcher = {
      matchFlows: jest.fn().mockResolvedValue({
        matched: [], orphanInternal: [{ internalFlowId: 'int-anchor2' }], orphanExternal: [], mismatch: [],
      }),
    };
    const svc = mkSvc(prisma, { flowMatcher });
    const result: any = await svc.getCase(baseKase.caseNo);

    const row = result.flowComparison.find((r: any) => r.internalFlow?.id === 'int-anchor2');
    expect(row.disposition.family).toBe(REASON_SPECS.AMT_MISBOOKED.family); // 'CORRECT'
    expect(row.disposition.reasonCode).toBe('AMT_MISBOOKED');
    expect(row.disposition.direction).toBe('INCREASE');
    expect(row.disposition.adjustmentNo).toBe('ADJ-2026-000001');
  });

  // 平账三期（Task 9）：案件对象的事故列表——独立于上面按行回贴的
  // disposition.incidentNo（那个只覆盖 UNAUTHORIZED_OUTFLOW 一类，锚在具体定性行
  // 上）；这里按 sourceCaseNo 直查 Incident，是**全类型**案件级列表（UNAUTHORIZED_
  // OUTFLOW 建单时同样带 sourceCaseNo，并非只覆盖 LARGE_UNEXPLAINED/CLIENT_
  // SHORTFALL），供案子上「升级事故」等按钮判断是否已经登记过。
  it('案件对象带出关联事故列表 incidents（号/状态/类型）——按 sourceCaseNo 查询', async () => {
    const prisma = mkBasePrisma({
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue([]) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([]) },
      incident: {
        findMany: jest.fn().mockResolvedValue([{ incidentNo: 'INC2026000002', status: 'INVESTIGATING', type: 'LARGE_UNEXPLAINED' }]),
      },
    });
    const svc = mkSvc(prisma);
    const result: any = await svc.getCase(baseKase.caseNo);
    expect(result.incidents).toEqual([{ incidentNo: 'INC2026000002', status: 'INVESTIGATING', type: 'LARGE_UNEXPLAINED' }]);
    expect((prisma.incident.findMany as jest.Mock).mock.calls[0][0]).toEqual(
      expect.objectContaining({ where: { sourceCaseNo: baseKase.caseNo } }),
    );
  });

  it('一案两事故（不同类型）都在列表里、按创建倒序', async () => {
    const prisma = mkBasePrisma({
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue([]) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([]) },
      incident: {
        findMany: jest.fn().mockResolvedValue([
          { incidentNo: 'INC2026000003', status: 'REGISTERED', type: 'UNAUTHORIZED_OUTFLOW' },
          { incidentNo: 'INC2026000002', status: 'INVESTIGATING', type: 'LARGE_UNEXPLAINED' },
        ]),
      },
    });
    const svc = mkSvc(prisma);
    const result: any = await svc.getCase(baseKase.caseNo);
    expect(result.incidents).toEqual([
      { incidentNo: 'INC2026000003', status: 'REGISTERED', type: 'UNAUTHORIZED_OUTFLOW' },
      { incidentNo: 'INC2026000002', status: 'INVESTIGATING', type: 'LARGE_UNEXPLAINED' },
    ]);
    expect((prisma.incident.findMany as jest.Mock).mock.calls[0][0]).toEqual(
      expect.objectContaining({ where: { sourceCaseNo: baseKase.caseNo }, orderBy: { createdAt: 'desc' } }),
    );
  });

  it('案子从未挂过事故 → incidents 为空数组', async () => {
    const prisma = mkBasePrisma({
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue([]) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([]) },
    }); // 默认 incident.findMany 解析为 []
    const svc = mkSvc(prisma);
    const result: any = await svc.getCase(baseKase.caseNo);
    expect(result.incidents).toEqual([]);
  });

  // 平账三期（Task 12）：出口 = INCIDENT（未授权转出）的定性行，事故一旦定损为
  // 「公司承损」（FIRM_LOSS），案件页要给出「认损」开单入口——不受账龄线约束
  // （这条行天生不是 HOLD_INVESTIGATING，走不进上面那组超期判断）。复用 WRITE_OFF
  // 这个 nextStep 形状，金额锁定为事故定损额（元→最小单位）。
  it('出口 = INCIDENT 且事故已定损 FIRM_LOSS → nextStep = WRITE_OFF（认损开单入口，金额锁定为定损额，不受账龄线约束）', async () => {
    const externalLines = [
      { id: 'ext-uo', direction: 'OUT', amount: new Prisma.Decimal(500), externalRef: 'REF-UO', datetime: new Date('2026-06-27T09:00:00Z'), description: null },
    ];
    const dispositionRow = {
      dispositionNo: 'DISP-UO-1', caseNo: baseKase.caseNo,
      explainedFlowId: null, explainedExternalLineId: 'ext-uo',
      matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', causeCode: 'UNAUTHORIZED_OUTFLOW', outlet: 'INCIDENT',
      deferredTarget: null, findingNote: '客户确认未授权，链上核实转出地址非白名单',
      adjustmentNo: null, incidentNo: 'INC1', createdByUserId: 'user-ops-1',
      createdAt: new Date('2026-06-27T12:00:00Z'), updatedAt: new Date('2026-06-27T12:00:00Z'),
    };
    const prisma = mkBasePrisma({
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue(externalLines) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([dispositionRow]) },
      incident: {
        findMany: jest.fn().mockResolvedValue([
          { incidentNo: 'INC1', status: 'ASSESSED', type: 'UNAUTHORIZED_OUTFLOW', assessedAmount: new Prisma.Decimal('123.45'), assessmentBasis: 'FIRM_LOSS' },
        ]),
      },
    });
    const flowMatcher = { matchFlows: jest.fn().mockResolvedValue({ matched: [], orphanInternal: [], orphanExternal: [{ externalLineId: 'ext-uo' }], mismatch: [] }) };
    const svc = mkSvc(prisma, { flowMatcher });
    const result: any = await svc.getCase(baseKase.caseNo);
    const row = result.flowComparison.find((r: any) => r.externalLine?.id === 'ext-uo');
    // decimals=2（mkBasePrisma 默认）：123.45 → 12345 最小单位。
    expect(row.nextStep).toEqual({ kind: 'WRITE_OFF', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE', amount: '12345', effectiveDate: baseKase.businessDate });
  });

  it('出口 = INCIDENT 但事故还没定损（REGISTERED）→ 没有 nextStep（等定损结论，不许提前解锁）', async () => {
    const externalLines = [
      { id: 'ext-uo2', direction: 'OUT', amount: new Prisma.Decimal(500), externalRef: 'REF-UO2', datetime: new Date('2026-06-27T09:00:00Z'), description: null },
    ];
    const dispositionRow = {
      dispositionNo: 'DISP-UO-2', caseNo: baseKase.caseNo,
      explainedFlowId: null, explainedExternalLineId: 'ext-uo2',
      matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', causeCode: 'UNAUTHORIZED_OUTFLOW', outlet: 'INCIDENT',
      deferredTarget: null, findingNote: 'n', adjustmentNo: null, incidentNo: 'INC2', createdByUserId: 'user-ops-1',
      createdAt: new Date(), updatedAt: new Date(),
    };
    const prisma = mkBasePrisma({
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue(externalLines) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([dispositionRow]) },
      incident: {
        findMany: jest.fn().mockResolvedValue([
          { incidentNo: 'INC2', status: 'REGISTERED', type: 'UNAUTHORIZED_OUTFLOW', assessedAmount: null, assessmentBasis: null },
        ]),
      },
    });
    const flowMatcher = { matchFlows: jest.fn().mockResolvedValue({ matched: [], orphanInternal: [], orphanExternal: [{ externalLineId: 'ext-uo2' }], mismatch: [] }) };
    const svc = mkSvc(prisma, { flowMatcher });
    const result: any = await svc.getCase(baseKase.caseNo);
    const row = result.flowComparison.find((r: any) => r.externalLine?.id === 'ext-uo2');
    expect(row.nextStep).toBeUndefined();
  });
});

describe('listCases 进度与 decimals', () => {
  it('每行带 dispositionCount / anomalyLineCount / decimals', async () => {
    const caseRow = { id: 'case-prog-1', caseNo: 'REC-PROG-001', status: 'OPEN', assetCode: 'AED', createdAt: new Date() };
    const prisma = {
      reconciliationCase: { findMany: jest.fn().mockResolvedValue([caseRow]) },
      // Task 5（读面翻转）：demoScenarios 气泡数据源查询——本用例不关心气泡。
      reconciliationRun: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      reconciliationDisposition: {
        groupBy: jest.fn().mockResolvedValue([{ caseNo: 'REC-PROG-001', _count: { _all: 3 } }]),
        // 平账二期 Task 8：同一模型上再加一条 findMany（退汇账单行徽标）——与上面
        // 的 groupBy 是两个不同的 mock 方法，不影响它的 mock.calls 断言。
        findMany: jest.fn().mockResolvedValue([]),
      },
      reconciliationLineItem: {
        groupBy: jest.fn().mockResolvedValue([{ caseId: 'case-prog-1', _count: { _all: 5 } }]),
      },
      asset: { findMany: jest.fn().mockResolvedValue([{ code: 'AED', decimals: 2 }]) },
      // 平账二期 Task 8：列表徽标查询。
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      internalTransfer: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = mkSvc(prisma);
    const rows = await svc.listCases({});
    expect(rows[0].dispositionCount).toBe(3);
    expect(rows[0].anomalyLineCount).toBe(5);
    expect(rows[0].decimals).toBe(2);

    // 反证：三条查询确实按这批案子的 caseNo/id/assetCode 过滤，不是全表扫描。
    expect((prisma.reconciliationDisposition.groupBy as jest.Mock).mock.calls[0][0].where).toEqual({ caseNo: { in: ['REC-PROG-001'] } });
    expect((prisma.reconciliationLineItem.groupBy as jest.Mock).mock.calls[0][0].where).toEqual({
      caseId: { in: ['case-prog-1'] },
      matchStatus: { in: ['AMOUNT_MISMATCH', 'ORPHAN_INTERNAL', 'ORPHAN_EXTERNAL'] },
    });
    expect((prisma.asset.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ code: { in: ['AED'] } });
  });

  it('没有定性记录 / 查不到资产时三个字段回落到 0', async () => {
    const caseRow = { id: 'case-prog-2', caseNo: 'REC-PROG-002', status: 'OPEN', assetCode: 'ZZZ', createdAt: new Date() };
    const prisma = {
      reconciliationCase: { findMany: jest.fn().mockResolvedValue([caseRow]) },
      reconciliationRun: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      reconciliationDisposition: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
      reconciliationLineItem: { groupBy: jest.fn().mockResolvedValue([]) },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      internalTransfer: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = mkSvc(prisma);
    const rows = await svc.listCases({});
    expect(rows[0].dispositionCount).toBe(0);
    expect(rows[0].anomalyLineCount).toBe(0);
    expect(rows[0].decimals).toBe(0);
  });
});

describe('平账 A 批：案件页按跑批截止时刻重建差异行（spec §6.1）', () => {
  function prismaForCase(cutoffAt: Date | null) {
    const kase = {
      id: 'c1', caseNo: 'REC20260902-007', businessDate: '2026-09-02', assetCode: 'USDT-TRON', walletRef: 'w-1', status: 'OPEN',
      book: 'CLIENT', lastObservedRunId: 'run-x', firstSeenRunId: 'run-x', closedByRunId: null, openedByRunId: 'run-x',
      tbAmount: new Prisma.Decimal(0), actualExternal: new Prisma.Decimal(0), deltaAmount: new Prisma.Decimal(0),
      createdAt: new Date(), lineItems: [],
    };
    return {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) },
      // ⚡ 差异行级推荐（本任务）：真实钱包案件会无条件发一次 findFirst 反查
      // demoManifest——真实/pass 轮场景，返回 null 即可。
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue({ runNo: 'RUN20260902-1', businessDate: '2026-09-02', cutoffAt, startedAt: new Date(), completedAt: new Date() }), findFirst: jest.fn().mockResolvedValue(null) },
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue([]) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([]) },
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: 6, currency: 'USDT' }) },
      wallet: { findUnique: jest.fn().mockResolvedValue({ walletNo: 'WA1' }) },
      fundsOrder: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账二期 Task 8：补款 / 垫款回挂块的划转单查询同样 unconditional。
      internalTransfer: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账三期 Task 9：案件级事故摘要查询同样 unconditional。
      incident: { findMany: jest.fn().mockResolvedValue([]) },
    };
  }
  it('run 记了 cutoffAt → 外部行与内部流水都按它截止', async () => {
    const cutoffAt = new Date('2026-09-02T10:00:00Z');
    const prisma: any = prismaForCase(cutoffAt);
    const flowMatcher = { matchFlows: jest.fn().mockResolvedValue({ matched: [], orphanInternal: [], orphanExternal: [], mismatch: [] }) };
    await mkSvc(prisma, { flowMatcher }).getCase('REC20260902-007');
    expect(prisma.externalStatementLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ datetime: { lte: cutoffAt } }),
    }));
    expect(flowMatcher.matchFlows).toHaveBeenCalledWith(expect.objectContaining({ cutoff: cutoffAt }));
  });
  it('历史 run 没记 cutoffAt → 回落当天日终', async () => {
    const prisma: any = prismaForCase(null);
    await mkSvc(prisma).getCase('REC20260902-007');
    expect(prisma.externalStatementLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ datetime: { lte: new Date('2026-09-02T23:59:59.999Z') } }),
    }));
  });
});

describe('平账 A 批：超期后的下一步 nextStep（spec §2.6）', () => {
  const flowId = 'flow-1'; const extId = 'ext-1';
  function prismaFor(opts: { book: 'CLIENT' | 'FIRM'; slaBreached: boolean; disposition: any | null; currency?: string; decimals?: number }) {
    const kase = {
      id: 'c1', caseNo: 'REC-A', businessDate: '2026-09-02', assetCode: opts.currency === 'USDT' ? 'USDT-TRON' : 'AED', walletRef: 'w-1', status: 'OPEN',
      book: opts.book, slaBreached: opts.slaBreached, lastObservedRunId: 'run-x', firstSeenRunId: 'run-x', closedByRunId: null, openedByRunId: 'run-x',
      tbAmount: new Prisma.Decimal(0), actualExternal: new Prisma.Decimal(0), deltaAmount: new Prisma.Decimal(-7), createdAt: new Date(), lineItems: [],
    };
    return {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) },
      // ⚡ 差异行级推荐（本任务）：真实钱包案件会无条件发一次 findFirst 反查
      // demoManifest——真实/pass 轮场景，返回 null 即可。
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue({ runNo: 'RUN-1', businessDate: '2026-09-02', cutoffAt: new Date('2026-09-02T10:00:00Z'), startedAt: new Date(), completedAt: new Date() }), findFirst: jest.fn().mockResolvedValue(null) },
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue(opts.disposition ? [opts.disposition] : []) },
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue([{ id: extId, direction: 'IN', amount: new Prisma.Decimal(4993), externalRef: 'R1', datetime: new Date('2026-09-02T09:00:00Z'), description: null }]) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([{ id: flowId, direction: 'IN', amount: new Prisma.Decimal(5000), externalRef: 'R1', eventCode: 'E2E', sourceType: 'DEPOSIT', sourceNo: 'S1', createdAt: new Date('2026-09-02T09:00:00Z') }]) },
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: opts.decimals ?? 2, currency: opts.currency ?? 'AED' }) },
      wallet: { findUnique: jest.fn().mockResolvedValue({ walletNo: 'WA1' }) },
      fundsOrder: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账二期 Task 8：补款 / 垫款回挂块的划转单查询同样 unconditional。
      internalTransfer: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账三期 Task 9：案件级事故摘要查询同样 unconditional。
      incident: { findMany: jest.fn().mockResolvedValue([]) },
    };
  }
  const mismatchMatcher = { matchFlows: jest.fn().mockResolvedValue({ matched: [], orphanInternal: [], orphanExternal: [], mismatch: [{ internalFlowId: flowId, externalLineId: extId }] }) };
  const held = { dispositionNo: 'RCD1', explainedFlowId: flowId, explainedExternalLineId: extId, matchType: 'AMOUNT_MISMATCH', book: 'FIRM', causeCode: 'UNEXPLAINED', outlet: 'HOLD_INVESTIGATING', findingNote: 'n', adjustmentNo: null, createdByUserId: 'ADM', createdAt: new Date(), updatedAt: new Date() };

  it('公司池 + 超期 + 调查中 + 小额 → WRITE_OFF，四项预填齐（金额最小单位、生效日 = 案件业务日）', async () => {
    const res = await mkSvc(prismaFor({ book: 'FIRM', slaBreached: true, disposition: held }), { flowMatcher: mismatchMatcher }).getCase('REC-A');
    const row = res.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!;
    expect(row.nextStep).toEqual({ kind: 'WRITE_OFF', reasonCode: 'UNEXPLAINED_WRITE_OFF', direction: 'REDUCE', amount: '7', effectiveDate: '2026-09-02' });
  });
  it('公司池 + 超期 + 调查中 + 大额 → INCIDENT_DEFERRED', async () => {
    const prisma = prismaFor({ book: 'FIRM', slaBreached: true, disposition: held });
    prisma.externalStatementLine.findMany.mockResolvedValue([{ id: extId, direction: 'IN', amount: new Prisma.Decimal(0), externalRef: 'R1', datetime: new Date(), description: null }]);
    prisma.accountFlow.findMany.mockResolvedValue([{ id: flowId, direction: 'IN', amount: new Prisma.Decimal(20_000), externalRef: 'R1', eventCode: 'E', sourceType: 'DEPOSIT', sourceNo: 'S', createdAt: new Date() }]);
    const res = await mkSvc(prisma, { flowMatcher: mismatchMatcher }).getCase('REC-A');
    // Task 12：nextStep 带上金额（元→最小单位，"升级事故"按钮据此预填）。
    expect(res.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toEqual({ kind: 'INCIDENT_DEFERRED', amount: '20000' });
  });
  // 平账二期 Task 4 改口：客户池超期不再一律 TRANSFER_DEFERRED——小额且「托管里少了」
  // （REDUCE）直接解锁认损（reasonCode 换成 UNEXPLAINED_CLIENT_LOSS，其余三项与公司池
  // 同款预填）；多出来的（INCREASE）→ CLIENT_SURPLUS、大额 → INCIDENT_DEFERRED，
  // 由 adjustment.service 的账簿 × 成因码守卫兜底，本用例只覆盖小额 REDUCE 这一支。
  it('客户池 + 超期 + 调查中 + 小额 + REDUCE → WRITE_OFF（认损码，平账二期解锁）', async () => {
    const res = await mkSvc(prismaFor({ book: 'CLIENT', slaBreached: true, disposition: { ...held, book: 'CLIENT' } }), { flowMatcher: mismatchMatcher }).getCase('REC-A');
    expect(res.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toEqual({ kind: 'WRITE_OFF', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE', amount: '7', effectiveDate: '2026-09-02' });
  });
  // 大额而非小额：金额刻意选在小额线之上，用来证明「多出来的不论大小都指路补录」
  // ——如果 CLIENT_SURPLUS 判断被错放到小额线检查之后，这一支会被误判成 INCIDENT_DEFERRED。
  it('客户池 + 超期 + 调查中 + 大额「多出来」（INCREASE）→ CLIENT_SURPLUS（多出来的不论大小，都不能核销进客户余额）', async () => {
    const prisma = prismaFor({ book: 'CLIENT', slaBreached: true, disposition: { ...held, book: 'CLIENT' } });
    prisma.externalStatementLine.findMany.mockResolvedValue([{ id: extId, direction: 'IN', amount: new Prisma.Decimal(30_000), externalRef: 'R1', datetime: new Date(), description: null }]);
    prisma.accountFlow.findMany.mockResolvedValue([{ id: flowId, direction: 'IN', amount: new Prisma.Decimal(0), externalRef: 'R1', eventCode: 'E2E', sourceType: 'DEPOSIT', sourceNo: 'S1', createdAt: new Date() }]);
    const res = await mkSvc(prisma, { flowMatcher: mismatchMatcher }).getCase('REC-A');
    expect(res.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toEqual({ kind: 'CLIENT_SURPLUS' });
  });
  it('客户池 + 超期 + 调查中 + 大额 REDUCE → INCIDENT_DEFERRED（客户池大额不走认损，同公司池升级事故）', async () => {
    const prisma = prismaFor({ book: 'CLIENT', slaBreached: true, disposition: { ...held, book: 'CLIENT' } });
    prisma.externalStatementLine.findMany.mockResolvedValue([{ id: extId, direction: 'IN', amount: new Prisma.Decimal(0), externalRef: 'R1', datetime: new Date(), description: null }]);
    prisma.accountFlow.findMany.mockResolvedValue([{ id: flowId, direction: 'IN', amount: new Prisma.Decimal(20_000), externalRef: 'R1', eventCode: 'E', sourceType: 'DEPOSIT', sourceNo: 'S', createdAt: new Date() }]);
    const res = await mkSvc(prisma, { flowMatcher: mismatchMatcher }).getCase('REC-A');
    expect(res.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toEqual({ kind: 'INCIDENT_DEFERRED', amount: '20000' });
  });
  it('未超期 / 未定性 / 结论不是调查中 / 已挂单 → 没有 nextStep', async () => {
    const notBreached = await mkSvc(prismaFor({ book: 'FIRM', slaBreached: false, disposition: held }), { flowMatcher: mismatchMatcher }).getCase('REC-A');
    expect(notBreached.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toBeUndefined();
    const noDisp = await mkSvc(prismaFor({ book: 'FIRM', slaBreached: true, disposition: null }), { flowMatcher: mismatchMatcher }).getCase('REC-A');
    expect(noDisp.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toBeUndefined();
    const linked = await mkSvc(prismaFor({ book: 'FIRM', slaBreached: true, disposition: { ...held, adjustmentNo: 'ADJ1' } }), { flowMatcher: mismatchMatcher }).getCase('REC-A');
    expect(linked.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toBeUndefined();
  });

  // Recon disposition rework Task 4 (dead-end fix): attachIncident() never changes outlet away
  // from HOLD_INVESTIGATING — it only writes the incidentNo column (disposition.service.ts).
  // Before this fix, the WRITE_OFF-via-incident block below only fired for outlet==='INCIDENT'
  // (a different static outlet, used only by the UNAUTHORIZED_OUTFLOW cause), so an escalated
  // LARGE_UNEXPLAINED row stayed stuck at INCIDENT_DEFERRED forever even once the incident was
  // assessed — the case page never offered a "Recognize loss" entry. The fix drops the outlet
  // check (any incidentNo routes here); this block sits after the aging block above, so its
  // WRITE_OFF verdict overrides the aging block's own INCIDENT_DEFERRED once the incident is
  // assessed FIRM_LOSS.
  it('公司池 + 超期 + 调查中 + 大额（先判 INCIDENT_DEFERRED）+ 已挂事故且已定损 FIRM_LOSS → nextStep 改判 WRITE_OFF：reasonCode 按簿选码（公司池=UNEXPLAINED_WRITE_OFF）、direction 现算（非硬编码 REDUCE）、金额锁定为定损额而非原始差额', async () => {
    const prisma = prismaFor({ book: 'FIRM', slaBreached: true, disposition: { ...held, incidentNo: 'INC-ESC-1' } });
    // 原始差额 20000 最小单位（200.00 AED），过小额线（100.00 AED）——若无本次修复，
    // 这一行会停在账龄块判出的 INCIDENT_DEFERRED。外部方向 IN、内部为 0 → resolveWriteOff
    // 现算 direction=INCREASE，与客户池硬编码的 REDUCE 不同——证明公司池这里不是硬编码。
    prisma.externalStatementLine.findMany.mockResolvedValue([{ id: extId, direction: 'IN', amount: new Prisma.Decimal(20_000), externalRef: 'R1', datetime: new Date(), description: null }]);
    prisma.accountFlow.findMany.mockResolvedValue([{ id: flowId, direction: 'IN', amount: new Prisma.Decimal(0), externalRef: 'R1', eventCode: 'E', sourceType: 'DEPOSIT', sourceNo: 'S', createdAt: new Date() }]);
    prisma.incident.findMany.mockResolvedValue([
      { incidentNo: 'INC-ESC-1', status: 'ASSESSED', type: 'LARGE_UNEXPLAINED', assessedAmount: new Prisma.Decimal('500.00'), assessmentBasis: 'FIRM_LOSS' },
    ]);
    const res = await mkSvc(prisma, { flowMatcher: mismatchMatcher }).getCase('REC-A');
    const row = res.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!;
    // 金额锁定为定损额 50000（500.00 AED，decimals=2），不是原始差额 20000——证明金额来自
    // 事故定损结论，不是 resolveWriteOff 按行差额算出来的那个数。
    expect(row.nextStep).toEqual({ kind: 'WRITE_OFF', reasonCode: 'UNEXPLAINED_WRITE_OFF', direction: 'INCREASE', amount: '50000', effectiveDate: '2026-09-02' });
  });
});

// 评审 Finding 2（平账二期 Task 8 评审补测）：此前全部 14 组既有 fixture 把
// reconciliationAdjustment/reconciliationDisposition/internalTransfer 的新增查询
// 都喂 []，getCase 的补款/垫款回挂块与 listCases 的徽标循环从未真正跑过一个分支。
// 下面按 T4「超期后的下一步」section 同款 prismaFor 风格补最小行为覆盖。
describe('getCase — 补款 / 垫款回挂行为覆盖（平账二期 Task 8 评审补测）', () => {
  const flowId = 'fund-flow-1';
  const extId = 'fund-ext-1';
  // 复用「超期后的下一步」一节验证过的组合：causeCode=UNEXPLAINED 的 cells 是
  // ALL_CELLS，对任意 matchType×book 都不会被 resolveOutlet 拒——disposition.outlet/
  // deferredTarget 是读面直接展示的落库字段，与 resolveOutlet 重算的 family/reasonCode/
  // direction 互不校验一致性，因此可以照下面这样单独摆 outlet='SUPPLEMENT' 而不触发
  // 「成因不属于该格」。
  function prismaFor(opts: { disposition: any; adjustments?: any[]; transfers?: any[]; externalAmount?: number }) {
    const kase = {
      id: 'c-fund', caseNo: 'REC-FUND', businessDate: '2026-09-05', assetCode: 'AED', walletRef: 'w-fund', status: 'OPEN',
      book: 'CLIENT', ownerNo: 'CU100', slaBreached: false, lastObservedRunId: 'run-x', firstSeenRunId: 'run-x', closedByRunId: null, openedByRunId: 'run-x',
      tbAmount: new Prisma.Decimal(0), actualExternal: new Prisma.Decimal(0), deltaAmount: new Prisma.Decimal(0), createdAt: new Date(), lineItems: [],
    };
    return {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) },
      // ⚡ 差异行级推荐（本任务）：真实钱包案件会无条件发一次 findFirst 反查
      // demoManifest——真实/pass 轮场景，返回 null 即可。
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue({ runNo: 'RUN-1', businessDate: '2026-09-05', cutoffAt: new Date('2026-09-05T10:00:00Z'), startedAt: new Date(), completedAt: new Date() }), findFirst: jest.fn().mockResolvedValue(null) },
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([opts.disposition]) },
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue(opts.adjustments ?? []) },
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue([{ id: extId, direction: 'IN', amount: new Prisma.Decimal(opts.externalAmount ?? 5000), externalRef: 'R1', datetime: new Date('2026-09-05T09:00:00Z'), description: null }]) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([{ id: flowId, direction: 'IN', amount: new Prisma.Decimal(5000), externalRef: 'R1', eventCode: 'E2E', sourceType: 'DEPOSIT', sourceNo: 'S1', createdAt: new Date('2026-09-05T09:00:00Z') }]) },
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: 2, currency: 'AED' }) },
      wallet: { findUnique: jest.fn().mockResolvedValue({ walletNo: 'WA1', ownerId: 'owner-uuid' }) },
      fundsOrder: { findMany: jest.fn().mockResolvedValue([]) },
      internalTransfer: { findMany: jest.fn().mockResolvedValue(opts.transfers ?? []) },
      incident: { findMany: jest.fn().mockResolvedValue([]) },
    };
  }
  const mismatchMatcher = { matchFlows: jest.fn().mockResolvedValue({ matched: [], orphanInternal: [], orphanExternal: [], mismatch: [{ internalFlowId: flowId, externalLineId: extId }] }) };
  // adjustmentNo 非空使旧 write-off nextStep 块的 `!d.adjustmentNo` 守卫恒假，
  // 与补款块互不干扰（同 T4 已证明的写法）。
  const lossLinked = { dispositionNo: 'RCD-FUND-1', explainedFlowId: flowId, explainedExternalLineId: extId, matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', causeCode: 'UNEXPLAINED', outlet: 'HOLD_INVESTIGATING', findingNote: 'n', adjustmentNo: 'ADJ1', deferredTarget: null, supplementNo: null, createdByUserId: 'ADM', createdAt: new Date(), updatedAt: new Date() };

  it('补款：认损已落账（POSTED/UNEXPLAINED_CLIENT_LOSS）、无划转单 → nextStep=COMPENSATION，transfer 不下发', async () => {
    const prisma = prismaFor({
      disposition: lossLinked,
      adjustments: [{ adjustmentNo: 'ADJ1', status: 'POSTED', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE', amount: '4200000' }],
      transfers: [],
    });
    const res: any = await mkSvc(prisma, { flowMatcher: mismatchMatcher }).getCase('REC-FUND');
    const row = res.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH');
    expect(row.nextStep).toEqual({ kind: 'COMPENSATION', adjustmentNo: 'ADJ1', amount: '4200000', customerNo: 'CU100', walletNo: 'WA1' });
    expect(row.transfer).toBeUndefined();
  });

  it('补款：划转单已在走（EXECUTING）→ transfer 回挂三字段，nextStep 收起（不再给按钮）', async () => {
    const prisma = prismaFor({
      disposition: lossLinked,
      adjustments: [{ adjustmentNo: 'ADJ1', status: 'POSTED', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE', amount: '4200000' }],
      transfers: [{ transferNo: 'ITR1', purpose: 'CLIENT_COMPENSATION', status: 'EXECUTING', sourceAdjustmentNo: 'ADJ1', sourceExternalLineId: null }],
    });
    const res: any = await mkSvc(prisma, { flowMatcher: mismatchMatcher }).getCase('REC-FUND');
    const row = res.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH');
    expect(row.transfer).toEqual({ transferNo: 'ITR1', purpose: 'CLIENT_COMPENSATION', status: 'EXECUTING' });
    expect(row.nextStep).toBeUndefined();
  });

  it('垫款：退汇定性（SUPPLEMENT/SUPPLEMENT_BOUNCE）行余额不足 → nextStep=ADVANCE，金额 = 账单行 − 可用', async () => {
    const bounceDisposition = {
      dispositionNo: 'RCD-FUND-2', explainedFlowId: flowId, explainedExternalLineId: extId,
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', causeCode: 'UNEXPLAINED',
      outlet: 'SUPPLEMENT', deferredTarget: 'SUPPLEMENT_BOUNCE', supplementNo: null,
      findingNote: 'n', adjustmentNo: null, createdByUserId: 'ADM', createdAt: new Date(), updatedAt: new Date(),
    };
    const prisma = prismaFor({ disposition: bounceDisposition, adjustments: [], transfers: [], externalAmount: 120_000 });
    const accounting = { getCustomerAvailableBalance: jest.fn(async () => ({ available: 30_000n })) };
    const res: any = await mkSvc(prisma, { flowMatcher: mismatchMatcher, accounting }).getCase('REC-FUND');
    const row = res.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH');
    expect(row.nextStep).toEqual({ kind: 'ADVANCE', amount: '90000', externalLineId: extId, customerNo: 'CU100', walletNo: 'WA1', available: '30000', lineAmount: '120000' });
  });
});

describe('listCases — 补款 / 垫款徽标（平账二期 Task 8 评审补测）', () => {
  it('待补款 PENDING / 挂着划转单 IN_PROGRESS / 已成功不再挂 → pendingFunding 三态', async () => {
    const caseA = { id: 'c-fund-a', caseNo: 'REC-FUND-A', status: 'OPEN', book: 'CLIENT', assetCode: 'AED', createdAt: new Date() };
    const caseB = { id: 'c-fund-b', caseNo: 'REC-FUND-B', status: 'OPEN', book: 'CLIENT', assetCode: 'AED', createdAt: new Date() };
    const caseC = { id: 'c-fund-c', caseNo: 'REC-FUND-C', status: 'OPEN', book: 'CLIENT', assetCode: 'AED', createdAt: new Date() };
    const prisma = {
      reconciliationCase: { findMany: jest.fn().mockResolvedValue([caseA, caseB, caseC]) },
      // Task 5（读面翻转）：demoScenarios 气泡数据源查询——本用例不关心气泡。
      reconciliationRun: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      reconciliationDisposition: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
      reconciliationLineItem: { groupBy: jest.fn().mockResolvedValue([]) },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
      // 三个案子各挂一张 POSTED 客损调账单——B/C 各配一张 sourceAdjustmentNo 对应的
      // 在途划转单（B=EXECUTING，C=SUCCESS），A 没有划转单。
      reconciliationAdjustment: {
        findMany: jest.fn().mockResolvedValue([
          { caseNo: 'REC-FUND-A', adjustmentNo: 'ADJ-A' },
          { caseNo: 'REC-FUND-B', adjustmentNo: 'ADJ-B' },
          { caseNo: 'REC-FUND-C', adjustmentNo: 'ADJ-C' },
        ]),
      },
      internalTransfer: {
        findMany: jest.fn().mockResolvedValue([
          { sourceCaseNo: 'REC-FUND-B', purpose: 'CLIENT_COMPENSATION', status: 'EXECUTING', sourceAdjustmentNo: 'ADJ-B', sourceExternalLineId: null },
          { sourceCaseNo: 'REC-FUND-C', purpose: 'CLIENT_COMPENSATION', status: 'SUCCESS', sourceAdjustmentNo: 'ADJ-C', sourceExternalLineId: null },
        ]),
      },
    };
    const rows = await mkSvc(prisma).listCases({});
    const byCaseNo = new Map(rows.map((r: any) => [r.caseNo, r]));
    expect(byCaseNo.get('REC-FUND-A').pendingFunding).toEqual({ kind: 'COMPENSATION', status: 'PENDING' });
    expect(byCaseNo.get('REC-FUND-B').pendingFunding).toEqual({ kind: 'COMPENSATION', status: 'IN_PROGRESS' });
    expect(byCaseNo.get('REC-FUND-C').pendingFunding).toBeNull();
  });
});

describe('listCases — demoScenarios（Task 5：读面翻转，气泡数据源，业务键）', () => {
  // 场景①（在途）rootCause 用种子专用字面量 'IN_TRANSIT_TIMING'——天生不在
  // CAUSE_REGISTRY 里（recon-demo.ts 的 RootCause 类型注释）；⑥⑦ 同挂一个钱包，
  // 验证「多场景同钱包全部列出、按 manifest 声明顺序」。
  const manifestWithScenarios = {
    cutoff: '2026-09-08T23:59:59.999Z',
    scenarios: [
      { scenarioId: 1, rootCause: 'IN_TRANSIT_TIMING', expectedLines: [{ walletRef: 'wallet-intransit' }] },
      { scenarioId: 5, rootCause: 'AMT_FEE_NETTED', expectedLines: [{ walletRef: 'wallet-fee' }] },
      { scenarioId: 6, rootCause: 'DUP_BOOKING', expectedLines: [{ walletRef: 'wallet-b' }] },
      { scenarioId: 7, rootCause: 'PHANTOM_BOOKING', expectedLines: [{ walletRef: 'wallet-b' }] },
    ],
    wallets: [],
  };

  function mkDemoPrisma(caseRows: any[], demoRun: { demoManifest: string | null } | null) {
    return {
      reconciliationCase: { findMany: jest.fn().mockResolvedValue(caseRows) },
      reconciliationRun: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(demoRun),
      },
      reconciliationDisposition: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
      reconciliationLineItem: { groupBy: jest.fn().mockResolvedValue([]) },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      internalTransfer: { findMany: jest.fn().mockResolvedValue([]) },
      wallet: { findMany: jest.fn().mockResolvedValue([]) }, // walletNo join — not asserted in these tests
    } as any;
  }

  it('命中场景的案件带 demoScenarios（按 manifest 声明顺序聚合，多场景同钱包全部列出）；不带 walletRef/UUID', async () => {
    const caseB = { id: 'c-b', caseNo: 'REC-B', status: 'OPEN', walletRef: 'wallet-b', createdAt: new Date() };
    const prisma = mkDemoPrisma([caseB], { demoManifest: JSON.stringify(manifestWithScenarios) });
    const rows = await mkSvc(prisma).listCases({});
    const row: any = rows.find((r: any) => r.caseNo === 'REC-B');
    expect(row.demoScenarios).toEqual([
      { scenarioId: 6, causeCode: 'DUP_BOOKING', causeLabel: CAUSE_REGISTRY.DUP_BOOKING.label, dispositionLabel: DISPOSITION_LABEL.REVERSE, clue: CAUSE_REGISTRY.DUP_BOOKING.clue },
      { scenarioId: 7, causeCode: 'PHANTOM_BOOKING', causeLabel: CAUSE_REGISTRY.PHANTOM_BOOKING.label, dispositionLabel: DISPOSITION_LABEL.REVERSE, clue: CAUSE_REGISTRY.PHANTOM_BOOKING.clue },
    ]);
    // 铁律⑥：不得输出 walletRef / 任何 UUID——字段集合逐一核对，不是「碰巧没写」。
    for (const entry of row.demoScenarios) {
      expect(Object.keys(entry).sort()).toEqual(['causeCode', 'causeLabel', 'clue', 'dispositionLabel', 'scenarioId']);
    }
  });

  it('场景①（在途，rootCause=IN_TRANSIT_TIMING）不在成因表里 → 命中的案件不产出 demoScenarios', async () => {
    const caseIt = { id: 'c-it', caseNo: 'REC-IT', status: 'OPEN', walletRef: 'wallet-intransit', createdAt: new Date() };
    const prisma = mkDemoPrisma([caseIt], { demoManifest: JSON.stringify(manifestWithScenarios) });
    const rows = await mkSvc(prisma).listCases({});
    const row: any = rows.find((r: any) => r.caseNo === 'REC-IT');
    expect(row.demoScenarios).toBeUndefined();
  });

  it('案件 walletRef 不命中任何场景 → demoScenarios 不下发', async () => {
    const caseNone = { id: 'c-none', caseNo: 'REC-NONE', status: 'OPEN', walletRef: 'wallet-unrelated', createdAt: new Date() };
    const prisma = mkDemoPrisma([caseNone], { demoManifest: JSON.stringify(manifestWithScenarios) });
    const rows = await mkSvc(prisma).listCases({});
    const row: any = rows.find((r: any) => r.caseNo === 'REC-NONE');
    expect(row.demoScenarios).toBeUndefined();
  });

  it('没有 demoManifest 跑批（真实/pass 轮）→ demoScenarios 恒 undefined，即便 walletRef 字面量与别处场景撞了也不误报', async () => {
    const caseB = { id: 'c-b2', caseNo: 'REC-B2', status: 'OPEN', walletRef: 'wallet-b', createdAt: new Date() };
    const prisma = mkDemoPrisma([caseB], null); // findFirst 落空——本轮没有带 demoManifest 的跑批
    const rows = await mkSvc(prisma).listCases({});
    const row: any = rows.find((r: any) => r.caseNo === 'REC-B2');
    expect(row.demoScenarios).toBeUndefined();
    expect((prisma.reconciliationRun.findFirst as jest.Mock).mock.calls[0][0]).toEqual(
      expect.objectContaining({ where: { demoManifest: { not: null } } }),
    );
  });
});

// 差异行级推荐（本任务）：案件详情页每条差异行按行的匹配键（externalLine.externalRef
// ?? internalFlow.externalRef，旧 WIP 同款）反查该案所属最近 break 轮 run.demoManifest，
// 推荐 = 种子成因 usableIn[0] 的处置种类——与 loadDemoScenariosByWalletRef 共用同一份
// loadLatestDemoManifest（不另发一次 findFirst）。四条覆盖：①命中行结构与值
// ②推荐不在合法清单时不下发 ③MISATTRIBUTED 两侧各取本格码 ④无 manifest 不下发。
describe('getCase — ⚡ 差异行级推荐 demoRecommended（平账处置改版承接）', () => {
  function mkKase(overrides: Record<string, unknown> = {}) {
    return {
      id: 'c-rec', caseNo: 'REC-RECO', businessDate: '2026-09-09', assetCode: 'AED',
      walletRef: 'w-demo-1', status: 'OPEN', book: 'CLIENT',
      lastObservedRunId: 'run-x', firstSeenRunId: 'run-x', closedByRunId: null, openedByRunId: 'run-x',
      tbAmount: new Prisma.Decimal(0), actualExternal: new Prisma.Decimal(0), deltaAmount: new Prisma.Decimal(0),
      createdAt: new Date(), lineItems: [],
      ...overrides,
    };
  }

  function prismaFor(opts: {
    kaseOverrides?: Record<string, unknown>;
    externalLines?: any[];
    internalFlows?: any[];
    demoRun: { demoManifest: string | null } | null;
  }) {
    return {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(mkKase(opts.kaseOverrides)) },
      reconciliationRun: {
        findUnique: jest.fn().mockResolvedValue({ runNo: 'RUN-1', businessDate: '2026-09-09', cutoffAt: new Date('2026-09-09T10:00:00Z'), startedAt: new Date(), completedAt: new Date() }),
        // ⚡ 本组用例的核心开关——命中 vs 不命中 demoManifest。
        findFirst: jest.fn().mockResolvedValue(opts.demoRun),
      },
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue(opts.externalLines ?? []) },
      accountFlow: { findMany: jest.fn().mockResolvedValue(opts.internalFlows ?? []) },
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: 2, currency: 'AED' }) },
      wallet: { findUnique: jest.fn().mockResolvedValue({ walletNo: 'WA1' }) },
      fundsOrder: { findMany: jest.fn().mockResolvedValue([]) },
      internalTransfer: { findMany: jest.fn().mockResolvedValue([]) },
      incident: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
  }

  const flowMatcherFor = (m: { matched?: any[]; orphanInternal?: any[]; orphanExternal?: any[]; mismatch?: any[] }) => ({
    matchFlows: jest.fn().mockResolvedValue({
      matched: m.matched ?? [], orphanInternal: m.orphanInternal ?? [], orphanExternal: m.orphanExternal ?? [], mismatch: m.mismatch ?? [],
    }),
  });

  it('① 命中行：demoRecommended 结构与值——按行 externalRef 反查种子成因，推荐取该成因 usableIn[0]（DUP_BOOKING → REVERSE）', async () => {
    const internalFlows = [{ id: 'int-dup', direction: 'OUT', amount: new Prisma.Decimal(100), externalRef: 'REF-DUP', eventCode: 'WITHDRAW_OUT', sourceType: 'WITHDRAW', sourceNo: 'WD-DUP', createdAt: new Date() }];
    const manifest = { scenarios: [{ scenarioId: 6, rootCause: 'DUP_BOOKING', expectedLines: [{ walletRef: 'w-demo-1', externalRef: 'REF-DUP' }] }] };
    const prisma = prismaFor({ internalFlows, demoRun: { demoManifest: JSON.stringify(manifest) } });
    const flowMatcher = flowMatcherFor({ orphanInternal: [{ internalFlowId: 'int-dup' }] });
    const res: any = await mkSvc(prisma, { flowMatcher }).getCase('REC-RECO');
    const row = res.flowComparison.find((r: any) => r.internalFlow?.id === 'int-dup');
    expect(row.demoRecommended).toEqual({
      scenarioId: 6, causeCode: 'DUP_BOOKING', causeLabel: CAUSE_REGISTRY.DUP_BOOKING.label,
      disposition: 'REVERSE', dispositionLabel: DISPOSITION_LABEL.REVERSE,
    });
  });

  it('② 推荐处置不在该行当下合法清单里（SWAP 来源无冲正码，A1b 甲）→ 宁缺勿错，不下发', async () => {
    const internalFlows = [{ id: 'int-swap-dup', direction: 'OUT', amount: new Prisma.Decimal(100), externalRef: 'REF-DUP-SWAP', eventCode: 'SWAP_OUT', sourceType: 'SWAP', sourceNo: 'SWP-1', createdAt: new Date() }];
    const manifest = { scenarios: [{ scenarioId: 6, rootCause: 'DUP_BOOKING', expectedLines: [{ walletRef: 'w-demo-1', externalRef: 'REF-DUP-SWAP' }] }] };
    const prisma = prismaFor({ internalFlows, demoRun: { demoManifest: JSON.stringify(manifest) } });
    const flowMatcher = flowMatcherFor({ orphanInternal: [{ internalFlowId: 'int-swap-dup' }] });
    const res: any = await mkSvc(prisma, { flowMatcher }).getCase('REC-RECO');
    const row = res.flowComparison.find((r: any) => r.internalFlow?.id === 'int-swap-dup');
    expect(row.dispositions.some((d: any) => d.kind === 'REVERSE')).toBe(false); // SWAP 来源不可冲正——推荐的处置压根不在这一行的按钮组里
    expect(row.demoRecommended).toBeUndefined();
  });

  it('③ MISATTRIBUTED_FROM/TO 同一 rootCause 铺两侧——发出端（ORPHAN_INTERNAL）直取 FROM 码，接收端（ORPHAN_EXTERNAL）FROM 码在该格不合法、改取 sibling TO 码', async () => {
    const manifest = {
      scenarios: [{
        scenarioId: 8, rootCause: 'MISATTRIBUTED_FROM',
        expectedLines: [
          { walletRef: 'w-from', externalRef: 'REF-FROM' },
          { walletRef: 'w-to', externalRef: 'REF-TO' },
        ],
      }],
    };
    const demoRun = { demoManifest: JSON.stringify(manifest) };

    // 发出端：我有外无
    const internalFlows = [{ id: 'int-from', direction: 'IN', amount: new Prisma.Decimal(500), externalRef: 'REF-FROM', eventCode: 'DEPOSIT_IN', sourceType: 'DEPOSIT', sourceNo: 'PAY-FROM', createdAt: new Date() }];
    const prismaFrom = prismaFor({ kaseOverrides: { walletRef: 'w-from' }, internalFlows, demoRun });
    const fromRes: any = await mkSvc(prismaFrom, { flowMatcher: flowMatcherFor({ orphanInternal: [{ internalFlowId: 'int-from' }] }) }).getCase('REC-RECO');
    const fromRow = fromRes.flowComparison.find((r: any) => r.internalFlow?.id === 'int-from');
    expect(fromRow.demoRecommended).toEqual({
      scenarioId: 8, causeCode: 'MISATTRIBUTED_FROM', causeLabel: CAUSE_REGISTRY.MISATTRIBUTED_FROM.label,
      disposition: 'REATTRIBUTE', dispositionLabel: DISPOSITION_LABEL.REATTRIBUTE,
    });

    // 接收端：外有我无——种子字面量仍是 MISATTRIBUTED_FROM，但这一格（ORPHAN_EXTERNAL×
    // CLIENT）只认 MISATTRIBUTED_TO；直取失败后回落 sibling。
    const externalLines = [{ id: 'ext-to', direction: 'IN', amount: new Prisma.Decimal(500), externalRef: 'REF-TO', datetime: new Date(), description: null }];
    const prismaTo = prismaFor({ kaseOverrides: { walletRef: 'w-to' }, externalLines, demoRun });
    const toRes: any = await mkSvc(prismaTo, { flowMatcher: flowMatcherFor({ orphanExternal: [{ externalLineId: 'ext-to' }] }) }).getCase('REC-RECO');
    const toRow = toRes.flowComparison.find((r: any) => r.externalLine?.id === 'ext-to');
    expect(toRow.demoRecommended).toEqual({
      scenarioId: 8, causeCode: 'MISATTRIBUTED_TO', causeLabel: CAUSE_REGISTRY.MISATTRIBUTED_TO.label,
      disposition: 'REATTRIBUTE', dispositionLabel: DISPOSITION_LABEL.REATTRIBUTE,
    });
  });

  it('④ 无 demoManifest（真实/pass 轮）→ demoRecommended 恒不下发，即便行的 externalRef 字面量与别处场景撞了也不误报', async () => {
    const internalFlows = [{ id: 'int-dup-real', direction: 'OUT', amount: new Prisma.Decimal(100), externalRef: 'REF-DUP', eventCode: 'WITHDRAW_OUT', sourceType: 'WITHDRAW', sourceNo: 'WD-DUP', createdAt: new Date() }];
    const prisma = prismaFor({ internalFlows, demoRun: null }); // findFirst 落空——本轮没有带 demoManifest 的跑批
    const flowMatcher = flowMatcherFor({ orphanInternal: [{ internalFlowId: 'int-dup-real' }] });
    const res: any = await mkSvc(prisma, { flowMatcher }).getCase('REC-RECO');
    const row = res.flowComparison.find((r: any) => r.internalFlow?.id === 'int-dup-real');
    expect(row.demoRecommended).toBeUndefined();
    expect((prisma.reconciliationRun.findFirst as jest.Mock).mock.calls[0][0]).toEqual(
      expect.objectContaining({ where: { demoManifest: { not: null } } }),
    );
  });
});
