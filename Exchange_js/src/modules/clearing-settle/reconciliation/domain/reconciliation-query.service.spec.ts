import { Prisma } from '@prisma/client';
import { pairManifest, ReconciliationQueryService } from './reconciliation-query.service';

// Helper: build the query service with a mock for the flow-matcher dependency
// the constructor requires (T3). Tests can override it by passing their own.
// T6: walletBalanceChecker was dropped from the constructor — getRun no
// longer recomputes via the balance checker (it reads the run-wallet
// snapshot table instead), and no other method in this service used it.
function mkSvc(
  prisma: any,
  opts: { flowMatcher?: any } = {},
) {
  const flowMatcher = opts.flowMatcher ?? {
    matchFlows: jest.fn().mockResolvedValue({
      matched: [], orphanInternal: [], orphanExternal: [], mismatch: [],
    }),
  };
  return new ReconciliationQueryService(prisma, flowMatcher);
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
  const noRunLookup = { reconciliationRun: { findMany: jest.fn().mockResolvedValue([]) } };

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
