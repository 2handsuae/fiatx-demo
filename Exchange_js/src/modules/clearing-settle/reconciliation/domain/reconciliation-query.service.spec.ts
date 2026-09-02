import { Prisma } from '@prisma/client';
import { pairManifest, ReconciliationQueryService } from './reconciliation-query.service';
import { CAUSE_REGISTRY, menuFor, staticOutletLabel } from '../disposition/cause-registry';

// Helper: build the query service with a mock for the flow-matcher dependency
// the constructor requires (T3). Tests can override it by passing their own.
// T6: walletBalanceChecker was dropped from the constructor — getRun no
// longer recomputes via the balance checker (it reads the run-wallet
// snapshot table instead), and no other method in this service used it.
function mkSvc(
  prisma: any,
  opts: { flowMatcher?: any; explainedDifferences?: any } = {},
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
  return new ReconciliationQueryService(prisma, flowMatcher, explainedDifferences);
}

// Helpers to build test fixtures concisely.
function mkBreak(
  currency: string,
  book: string,
  bucket: string,
  internalAmount: string | null,
  externalAmount: string | null,
  targetRef = 'REF-DISPLAY-ONLY',
) {
  return { currency, book, bucket, targetRef, internalAmount, externalAmount, targetType: '', signedDelta: '0', note: '' };
}

function mkItem(
  currency: string,
  book: string,
  bucket: string,
  internalAmount: unknown,
  externalAmount: unknown,
) {
  return {
    id: `item-${currency}-${bucket}`,
    matchStatus: bucket,
    internalSourceNo: null,
    internalTxHash: null,
    externalTxId: null,
    externalTxHash: null,
    internalAmount,
    externalAmount,
    _currency: currency,
    _book: book,
  };
}

describe('pairManifest — amount-keyed pairing', () => {
  it('pairs injected breaks vs detected line-items by (currency,book,bucket,primaryAmount)', () => {
    // AED ORPHAN_INTERNAL: both sides carry internalAmount = 500
    // USDT ORPHAN_EXTERNAL: both sides carry externalAmount = 200
    // extra: AED AMOUNT_MISMATCH not injected as a break
    const breaks = [
      mkBreak('AED', 'CLIENT', 'ORPHAN_INTERNAL', '500', null, 'REF-DEMO-1-AED'),
      mkBreak('USDT', 'FIRM',  'ORPHAN_EXTERNAL', null, '200', '0xDEMO2USDT'),
    ];
    const items = [
      mkItem('AED',  'CLIENT', 'ORPHAN_INTERNAL', '500', null),
      // extra — not in breaks
      mkItem('AED',  'CLIENT', 'AMOUNT_MISMATCH', '300', '310'),
    ];
    const r = pairManifest(breaks as any, items as any);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].break.currency).toBe('AED');
    expect(r.missed).toHaveLength(1);   // USDT FIRM orphan-external — no item
    expect(r.missed[0].currency).toBe('USDT');
    expect(r.extra).toHaveLength(1);    // AED amount-mismatch not claimed
    expect(r.extra[0].matchStatus).toBe('AMOUNT_MISMATCH');
  });

  it('pairs when item externalAmount drives primaryAmount (ORPHAN_EXTERNAL, no internalAmount)', () => {
    const breaks = [mkBreak('USDT', 'CLIENT', 'ORPHAN_EXTERNAL', null, '999.5', '0xEXT123')];
    const items  = [mkItem('USDT', 'CLIENT', 'ORPHAN_EXTERNAL', null, '999.5')];
    const r = pairManifest(breaks as any, items as any);
    expect(r.matched).toHaveLength(1);
    expect(r.missed).toHaveLength(0);
    expect(r.extra).toHaveLength(0);
  });

  it('pairs AMOUNT_MISMATCH break using internalAmount (takes precedence over externalAmount)', () => {
    // For AMOUNT_MISMATCH both internal and external are present; primaryAmount = internalAmount.
    const breaks = [mkBreak('USDT', 'CLIENT', 'AMOUNT_MISMATCH', '1000', '900', '0xTXHASH1')];
    const items  = [mkItem('USDT', 'CLIENT', 'AMOUNT_MISMATCH', '1000', '900')];
    const r = pairManifest(breaks as any, items as any);
    expect(r.matched).toHaveLength(1);
    expect(r.missed).toHaveLength(0);
    expect(r.extra).toHaveLength(0);
  });

  it('returns all missed when no items exist', () => {
    const breaks = [mkBreak('AED', 'CLIENT', 'ORPHAN_INTERNAL', '500', null)];
    const r = pairManifest(breaks as any, []);
    expect(r.matched).toHaveLength(0);
    expect(r.missed).toHaveLength(1);
    expect(r.extra).toHaveLength(0);
  });

  it('returns all extra when no breaks exist', () => {
    const items = [mkItem('AED', 'CLIENT', 'AMOUNT_MISMATCH', '300', '310')];
    const r = pairManifest([], items as any);
    expect(r.matched).toHaveLength(0);
    expect(r.missed).toHaveLength(0);
    expect(r.extra).toHaveLength(1);
  });

  it('amount disambiguates two breaks with same (currency,book,bucket) but different amounts', () => {
    // Two AED ORPHAN_INTERNAL breaks at different amounts — must pair each to its own item.
    const breaks = [
      mkBreak('AED', 'CLIENT', 'ORPHAN_INTERNAL', '100', null, 'REF-A'),
      mkBreak('AED', 'CLIENT', 'ORPHAN_INTERNAL', '250', null, 'REF-B'),
    ];
    const items = [
      mkItem('AED', 'CLIENT', 'ORPHAN_INTERNAL', '250', null), // listed first — should pair to REF-B
      mkItem('AED', 'CLIENT', 'ORPHAN_INTERNAL', '100', null), // should pair to REF-A
    ];
    const r = pairManifest(breaks as any, items as any);
    expect(r.matched).toHaveLength(2);
    expect(r.missed).toHaveLength(0);
    expect(r.extra).toHaveLength(0);
    // REF-A (100) should match the item with internalAmount=100
    const matchA = r.matched.find((m) => m.break.targetRef === 'REF-A');
    expect(matchA?.item.internalAmount).toBe('100');
    // REF-B (250) should match the item with internalAmount=250
    const matchB = r.matched.find((m) => m.break.targetRef === 'REF-B');
    expect(matchB?.item.internalAmount).toBe('250');
  });
});

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
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue({ id: 'run-fc', runNo: 'REC-FC' }) },
      // T4/T1: getCase (unconditional) + buildFlowComparison both look up
      // asset.decimals by assetCode via findUnique. decimals=2 here.
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: 2 }) },
      // Task 7: getCase's案件级 adjustments 查询也是 unconditional（不依赖
      // lineItems，见 reconciliation-query.service.ts getCase 里的新增块）。
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      // 平账一期半（T7 案件读面）：getCase 的行注解块同样 unconditional 发一次。
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([]) },
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
    reconciliationRun: { findMany: jest.fn().mockResolvedValue([]) },
    // 平账一期半（T7 案件读面）：listCases 新增 dispositionCount/anomalyLineCount/
    // decimals 三个 groupBy/findMany 查询，非空行 fixture 都会触发。
    reconciliationDisposition: { groupBy: jest.fn().mockResolvedValue([]) },
    reconciliationLineItem: { groupBy: jest.fn().mockResolvedValue([]) },
    asset: { findMany: jest.fn().mockResolvedValue([]) },
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
      },
      // 平账一期半（T7 案件读面）：同上，非空行会触发新增的 groupBy/findMany。
      reconciliationDisposition: { groupBy: jest.fn().mockResolvedValue([]) },
      reconciliationLineItem: { groupBy: jest.fn().mockResolvedValue([]) },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
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
      },
      // 平账一期半（T7 案件读面）：过滤后仍有 2 行，会触发新增的 groupBy/findMany
      // （另一条 runNo 不存在的用例在到达这里之前就已经 return [] 短路）。
      reconciliationDisposition: { groupBy: jest.fn().mockResolvedValue([]) },
      reconciliationLineItem: { groupBy: jest.fn().mockResolvedValue([]) },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
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
        ownerNo: 'CU-2', bucket: 'SOFT_FLAG',
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
    expect(b.bucket).toBe('SOFT_FLAG');
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
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue(run) },
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue([]) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([]) },
      fundsOrder: { findMany: jest.fn().mockResolvedValue([]) },
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: 2 }) },
      // 平账一期半（T7 案件读面）：getCase 的行注解块同样 unconditional 发一次。
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
  }

  it('返回体含案件级 adjustments 数组，形状 { adjustmentNo, status, reasonCode, direction, amount }；查询按 caseNo 过滤（Fix 6 之后 getCase 只发这一条 reconciliationAdjustment 查询——Task 6 的 lineItemId IN 查询已随 decoratedLineItems 一并删除）', async () => {
    const prisma = mkPrismaBase();
    const rows = [
      { adjustmentNo: 'ADJ20260828001', status: 'POSTED', reasonCode: 'BANK_INTEREST', direction: 'INCREASE', amount: '500' },
      { adjustmentNo: 'ADJ20260828002', status: 'PENDING_APPROVAL', reasonCode: 'DEPOSIT_AMOUNT_CORRECTION', direction: 'REDUCE', amount: '1200' },
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
      adjustmentNo: 'ADJ20260828004', status: 'DRAFT', reasonCode: 'WITHDRAW_AMOUNT_CORRECTION',
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
      { adjustmentNo: 'ADJ20260828003', status: 'DRAFT', reasonCode: 'BANK_CHARGE', direction: 'REDUCE', amount: '300' },
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
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue({ id: 'run-anno', runNo: 'REC-ANNO-RUN' }) },
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: 2 }) },
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([]) },
      fundsOrder: { findMany: jest.fn().mockResolvedValue([]) },
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

  it('三类差异行带 menu（该格成因清单）；MATCHED/IN_TRANSIT 不带', async () => {
    const externalLines = [
      { id: 'ext-m',  direction: 'IN', amount: new Prisma.Decimal(400), externalRef: 'REF-M',  datetime: new Date('2026-06-27T09:00:00Z'), description: null },
      { id: 'ext-oe', direction: 'IN', amount: new Prisma.Decimal(150), externalRef: 'REF-OE', datetime: new Date('2026-06-27T09:30:00Z'), description: null },
      { id: 'ext-mm', direction: 'IN', amount: new Prisma.Decimal(300), externalRef: 'REF-MM', datetime: new Date('2026-06-27T10:00:00Z'), description: null },
    ];
    const internalFlows = [
      { id: 'int-m',  direction: 'IN',  amount: new Prisma.Decimal(400), externalRef: 'REF-M',  eventCode: 'DEPOSIT_IN',   sourceType: 'PAYIN',    sourceNo: 'PAY-M',  createdAt: new Date('2026-06-27T09:00:05Z') },
      { id: 'int-oi', direction: 'OUT', amount: new Prisma.Decimal(77),  externalRef: 'REF-OI', eventCode: 'WITHDRAW_OUT', sourceType: 'WITHDRAW', sourceNo: 'WD-OI',  createdAt: new Date('2026-06-27T09:45:00Z') },
      { id: 'int-mm', direction: 'IN',  amount: new Prisma.Decimal(310), externalRef: 'REF-MM', eventCode: 'DEPOSIT_IN',   sourceType: 'PAYIN',    sourceNo: 'PAY-MM', createdAt: new Date('2026-06-27T10:00:05Z') },
    ];
    const prisma = mkBasePrisma({
      externalBalance: { findMany: jest.fn().mockResolvedValue([{ accountRef: 'ACC-ANNO' }]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue(externalLines) },
      accountFlow: { findMany: jest.fn().mockResolvedValue(internalFlows) },
      // 案件带一条 IN_TRANSIT line item——追加段生成的行必须也验一遍不带 menu。
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

    // book='CLIENT'（baseKase 显式设置）——三格菜单跟 Task 1 注册表按格现算的结果逐字相等。
    const orphanInt = result.flowComparison.find((r: any) => r.matchType === 'ORPHAN_INTERNAL');
    expect(orphanInt.menu).toEqual(menuFor('ORPHAN_INTERNAL', 'CLIENT'));
    expect(orphanInt.menu[0].code).toBe('DUP_BOOKING'); // 手册顺序第一位

    const orphanExt = result.flowComparison.find((r: any) => r.matchType === 'ORPHAN_EXTERNAL');
    expect(orphanExt.menu).toEqual(menuFor('ORPHAN_EXTERNAL', 'CLIENT'));

    const mismatch = result.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH');
    expect(mismatch.menu).toEqual(menuFor('AMOUNT_MISMATCH', 'CLIENT'));

    const matchedRow = result.flowComparison.find((r: any) => r.matchType === 'MATCHED');
    expect(matchedRow.menu).toBeUndefined();

    const inTransitRow = result.flowComparison.find((r: any) => r.matchType === 'IN_TRANSIT');
    expect(inTransitRow).toBeDefined();
    expect(inTransitRow.menu).toBeUndefined();
  });

  it('行有定性记录 → disposition 注解（含 causeLabel/outletLabel/createdBy + 出口的族/reason/方向）', async () => {
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
      outlet: 'ADJUST_REVERSE',
      deferredTarget: null,
      findingNote: '银行/链上查无此笔，客户确认未收到通知',
      adjustmentNo: null,               // 刚定性、还没联到调账单（Task 5 linkAdjustment 之后才会有值）
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
      outletLabel: staticOutletLabel('PHANTOM_BOOKING'),
      // 出口的可执行三件（读面现算，金库据此开单，不必先重发一次定性）：
      // 冲销族；假信号入账的 reason 是充值撤销；方向 = 内部流水方向取反（OUT→加）。
      family: 'REVERSE',
      reasonCode: 'DEPOSIT_SIGNAL_VOID',
      direction: 'INCREASE',
      findingNote: '银行/链上查无此笔，客户确认未收到通知',
      adjustmentNo: null,
      createdBy: 'user-ops-1',
      createdAt: dispositionRow.updatedAt.toISOString(), // 优先 updatedAt，不是 createdAt
    });

    // 反证：reconciliationDisposition.findMany 确实按 caseNo 过滤查询（① 的锚点）。
    expect((prisma.reconciliationDisposition.findMany as jest.Mock).mock.calls[0][0]).toEqual({
      where: { caseNo: baseKase.caseNo },
    });
  });
});

describe('listCases 进度与 decimals', () => {
  it('每行带 dispositionCount / anomalyLineCount / decimals', async () => {
    const caseRow = { id: 'case-prog-1', caseNo: 'REC-PROG-001', status: 'OPEN', assetCode: 'AED', createdAt: new Date() };
    const prisma = {
      reconciliationCase: { findMany: jest.fn().mockResolvedValue([caseRow]) },
      reconciliationRun: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationDisposition: {
        groupBy: jest.fn().mockResolvedValue([{ caseNo: 'REC-PROG-001', _count: { _all: 3 } }]),
      },
      reconciliationLineItem: {
        groupBy: jest.fn().mockResolvedValue([{ caseId: 'case-prog-1', _count: { _all: 5 } }]),
      },
      asset: { findMany: jest.fn().mockResolvedValue([{ code: 'AED', decimals: 2 }]) },
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
      reconciliationRun: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationDisposition: { groupBy: jest.fn().mockResolvedValue([]) },
      reconciliationLineItem: { groupBy: jest.fn().mockResolvedValue([]) },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
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
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue({ runNo: 'RUN20260902-1', businessDate: '2026-09-02', cutoffAt, startedAt: new Date(), completedAt: new Date() }) },
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue([]) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([]) },
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: 6, currency: 'USDT' }) },
      wallet: { findUnique: jest.fn().mockResolvedValue({ walletNo: 'WA1' }) },
      fundsOrder: { findMany: jest.fn().mockResolvedValue([]) },
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
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue({ runNo: 'RUN-1', businessDate: '2026-09-02', cutoffAt: new Date('2026-09-02T10:00:00Z'), startedAt: new Date(), completedAt: new Date() }) },
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue(opts.disposition ? [opts.disposition] : []) },
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue([{ id: extId, direction: 'IN', amount: new Prisma.Decimal(4993), externalRef: 'R1', datetime: new Date('2026-09-02T09:00:00Z'), description: null }]) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([{ id: flowId, direction: 'IN', amount: new Prisma.Decimal(5000), externalRef: 'R1', eventCode: 'E2E', sourceType: 'DEPOSIT', sourceNo: 'S1', createdAt: new Date('2026-09-02T09:00:00Z') }]) },
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: opts.decimals ?? 2, currency: opts.currency ?? 'AED' }) },
      wallet: { findUnique: jest.fn().mockResolvedValue({ walletNo: 'WA1' }) },
      fundsOrder: { findMany: jest.fn().mockResolvedValue([]) },
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
    expect(res.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toEqual({ kind: 'INCIDENT_DEFERRED' });
  });
  it('客户池 + 超期 + 调查中 → TRANSFER_DEFERRED', async () => {
    const res = await mkSvc(prismaFor({ book: 'CLIENT', slaBreached: true, disposition: { ...held, book: 'CLIENT' } }), { flowMatcher: mismatchMatcher }).getCase('REC-A');
    expect(res.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toEqual({ kind: 'TRANSFER_DEFERRED' });
  });
  it('未超期 / 未定性 / 结论不是调查中 / 已挂单 → 没有 nextStep', async () => {
    const notBreached = await mkSvc(prismaFor({ book: 'FIRM', slaBreached: false, disposition: held }), { flowMatcher: mismatchMatcher }).getCase('REC-A');
    expect(notBreached.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toBeUndefined();
    const noDisp = await mkSvc(prismaFor({ book: 'FIRM', slaBreached: true, disposition: null }), { flowMatcher: mismatchMatcher }).getCase('REC-A');
    expect(noDisp.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toBeUndefined();
    const linked = await mkSvc(prismaFor({ book: 'FIRM', slaBreached: true, disposition: { ...held, adjustmentNo: 'ADJ1' } }), { flowMatcher: mismatchMatcher }).getCase('REC-A');
    expect(linked.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toBeUndefined();
  });
});
