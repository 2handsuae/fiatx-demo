import { Prisma } from '@prisma/client';
import { pairManifest, ReconciliationQueryService } from './reconciliation-query.service';

// Helper: build the query service with mocks for the engine dependencies the
// constructor now requires (T3). Tests can override either by passing their own.
function mkSvc(
  prisma: any,
  opts: { balanceChecker?: any; flowMatcher?: any } = {},
) {
  const balanceChecker = opts.balanceChecker ?? {
    checkBalance: jest.fn().mockResolvedValue({
      pass: true, walletRef: '', walletKind: 'CUSTOMER', coaCode: '',
      ownerNo: null, internal: { total: 0n }, external: 0n, delta: 0n,
    }),
  };
  const flowMatcher = opts.flowMatcher ?? {
    matchFlows: jest.fn().mockResolvedValue({
      matched: [], orphanInternal: [], orphanExternal: [], mismatch: [],
    }),
  };
  return new ReconciliationQueryService(prisma, balanceChecker, flowMatcher);
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

describe('listRuns — engineVersion filter (Phase B)', () => {
  // Per T5: every existing ReconciliationRun row gets engineVersion='V8_FORMULA' via column default.
  // Phase B (T7) will stamp new runs with 'WALLET_V1'. Filter must respect undefined = all engines.
  function mkPrisma(rows: any[]) {
    return {
      reconciliationRun: {
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.engineVersion === undefined) return Promise.resolve(rows);
          return Promise.resolve(rows.filter((r) => r.engineVersion === where.engineVersion));
        }),
      },
    } as any;
  }
  const legacyRow = { id: 'r1', runNo: 'RUN-1', engineVersion: 'V8_FORMULA', businessDate: '2026-06-25', layer: 'REDESIGN' };

  it('returns all rows when engineVersion is undefined', async () => {
    const svc = mkSvc(mkPrisma([legacyRow]));
    const rows = await svc.listRuns({});
    expect(rows).toHaveLength(1);
  });
  it('returns existing V8_FORMULA runs when filtered explicitly', async () => {
    const svc = mkSvc(mkPrisma([legacyRow]));
    const rows = await svc.listRuns({ engineVersion: 'V8_FORMULA' });
    expect(rows).toHaveLength(1);
    expect(rows[0].engineVersion).toBe('V8_FORMULA');
  });
  it('returns empty when filtering for WALLET_V1 (no Phase B runs exist yet)', async () => {
    const svc = mkSvc(mkPrisma([legacyRow]));
    const rows = await svc.listRuns({ engineVersion: 'WALLET_V1' });
    expect(rows).toHaveLength(0);
  });
});

describe('getExternalBalance — statement lines scoped to the balance business day', () => {
  it('filters lines by the balance cutoffDate day window (no multi-day bleed)', async () => {
    const balance = {
      id: 'b1', statementId: 'STMT-20260622-ZAND-C-CMA-AED-0001',
      source: 'ZAND', accountRef: 'C_CMA-AED-0001', currency: 'AED', cutoffDate: '2026-06-22',
    };
    const prisma = {
      externalBalance: { findFirst: jest.fn().mockResolvedValue(balance) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = mkSvc(prisma);
    await svc.getExternalBalance(balance.statementId);
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

describe('getRun — accountStatusTable (T3)', () => {
  // Two-wallet fixture: walletA (CUSTOMER) balances cleanly and has no Case;
  // walletB (CUSTOMER) is on this run's Case with one ORPHAN_EXTERNAL line item
  // and a delta=0 (the orphan didn't move the balance). Expected statuses are
  // MATCH and ORPHAN respectively.
  const run = {
    id: 'run-w1',
    runNo: 'RUN-20260627-WALLET-1',
    businessDate: '2026-06-27',
    layer: 'WALLET',
    engineVersion: 'WALLET_V1',
    demoManifest: null,
    invariantChecks: [],
  };
  const cases = [
    { id: 'case-1', caseNo: 'REC-20260627-AED-W-001', assetCode: 'AED', book: 'CUSTOMER', status: 'OPEN', deltaAmount: new Prisma.Decimal(0), walletRef: 'walletB' },
  ];

  function mkPrisma() {
    return {
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue(run) },
      reconciliationCase: { findMany: jest.fn().mockResolvedValue(cases) },
      externalBalance: {
        findMany: jest.fn().mockResolvedValue([
          { walletRef: 'walletA', closingBalance: new Prisma.Decimal(1000), currency: 'AED', coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE', ownerNo: 'CU-1' },
          { walletRef: 'walletB', closingBalance: new Prisma.Decimal(500),  currency: 'AED', coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE', ownerNo: 'CU-2' },
        ]),
      },
      reconciliationLineItem: {
        findMany: jest.fn().mockResolvedValue([
          { caseId: 'case-1', matchStatus: 'ORPHAN_EXTERNAL' },
        ]),
      },
      wallet: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'walletA', walletRole: 'C_DEP', ownerNo: 'CU-1', ownerType: 'CUSTOMER' },
          { id: 'walletB', walletRole: 'C_DEP', ownerNo: 'CU-2', ownerType: 'CUSTOMER' },
        ]),
      },
      customerMain: {
        findMany: jest.fn().mockResolvedValue([
          { customerNo: 'CU-1', firstName: 'Alice', lastName: 'Anders', companyName: null },
          { customerNo: 'CU-2', firstName: null,    lastName: null,    companyName: 'Acme Co' },
        ]),
      },
    };
  }

  it('returns N rows with required fields; MATCH rows have caseId=null; BREAK rows have caseId', async () => {
    const prisma = mkPrisma();
    // Balance checker returns clean delta=0 for walletA, delta=0 for walletB
    // (orphan didn't move the balance — pure flow break).
    const balanceChecker = {
      checkBalance: jest.fn().mockImplementation(({ walletRef, externalClosing }: any) => Promise.resolve({
        pass: true, walletRef, walletKind: 'CUSTOMER', coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
        ownerNo: walletRef === 'walletA' ? 'CU-1' : 'CU-2',
        internal: { total: externalClosing }, external: externalClosing, delta: 0n,
      })),
    };
    const svc = mkSvc(prisma, { balanceChecker });
    const result: any = await svc.getRun(run.runNo);
    expect(result.accountStatusTable).toHaveLength(2);

    const a = result.accountStatusTable.find((r: any) => r.walletRef === 'walletA');
    expect(a.status).toBe('MATCH');
    expect(a.caseId).toBeNull();
    expect(a.caseNo).toBeNull();
    expect(a.ownerName).toBe('Alice Anders');
    expect(a.walletRole).toBe('C_DEP');
    expect(a.asset).toBe('AED');
    expect(a.delta).toBe('0');

    const b = result.accountStatusTable.find((r: any) => r.walletRef === 'walletB');
    // delta=0 + only an external orphan → FLOW_REVIEW (fake-match probe: net balances
    // but underlying line-items broken). Old engine called this 'ORPHAN'.
    expect(b.status).toBe('FLOW_REVIEW');
    expect(b.caseId).toBe('case-1');
    expect(b.caseNo).toBe('REC-20260627-AED-W-001');
    expect(b.flowOrphanExternal).toBe(1);
    expect(b.flowOrphanInternal).toBe(0);
    expect(b.flowMismatch).toBe(0);
    expect(b.ownerName).toBe('Acme Co');

    expect(result.summary.accountsChecked).toBe(2);
    expect(result.summary.matchCount).toBe(1);
    expect(result.summary.flowReviewCount).toBe(1);
    expect(result.summary.breakCount).toBe(0);
    expect(result.summary.orphanCount).toBe(1); // per-anomaly axis (any orphan line item)
  });

  it('returns empty accountStatusTable for legacy V8_FORMULA runs', async () => {
    const prisma = mkPrisma();
    prisma.reconciliationRun.findUnique = jest.fn().mockResolvedValue({ ...run, engineVersion: 'V8_FORMULA' });
    const svc = mkSvc(prisma);
    const result: any = await svc.getRun(run.runNo);
    expect(result.accountStatusTable).toEqual([]);
    expect(result.summary.accountsChecked).toBe(0);
  });

  it('marks BREAK when delta != 0 (industry "balance first": flow state irrelevant for headline)', async () => {
    const prisma = mkPrisma();
    prisma.reconciliationCase.findMany = jest.fn().mockResolvedValue([]); // no cases → no line items
    prisma.reconciliationLineItem.findMany = jest.fn().mockResolvedValue([]);
    const balanceChecker = {
      checkBalance: jest.fn().mockImplementation(({ walletRef, externalClosing }: any) => Promise.resolve({
        pass: walletRef !== 'walletA', walletRef, walletKind: 'CUSTOMER', coaCode: '',
        ownerNo: null, internal: { total: externalClosing }, external: externalClosing,
        delta: walletRef === 'walletA' ? 50n : 0n,
      })),
    };
    const svc = mkSvc(prisma, { balanceChecker });
    const result: any = await svc.getRun(run.runNo);
    const a = result.accountStatusTable.find((r: any) => r.walletRef === 'walletA');
    expect(a.status).toBe('BREAK');
    expect(result.summary.breakCount).toBe(1);
    expect(result.summary.balanceBreakCount).toBe(1); // alias axis
  });
});

describe('getCase — flowComparison (T3)', () => {
  const kase = {
    id: 'case-x', caseNo: 'REC-20260627-AED-W-002',
    walletRef: 'walletX', businessDate: '2026-06-27', lineItems: [],
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
    };
    const flowMatcher = { matchFlows: jest.fn() };
    const svc = mkSvc(prisma, { flowMatcher });
    const result: any = await svc.getCase('REC-XREF');
    expect(result.flowComparison).toEqual([]);
    expect(flowMatcher.matchFlows).not.toHaveBeenCalled();
  });
});

describe('listCases — T3 default OPEN + aging desc', () => {
  // T3 cockpit default: omitting status filters to OPEN; aging derived from
  // createdAt; sort by aging desc so the oldest break floats to the top.
  const old = { id: 'c-old', caseNo: 'OLD', status: 'OPEN', firstSeenRunId: 'r1', lastUpdatedRunId: 'r3', createdAt: new Date(Date.now() - 5 * 86_400_000) };
  const mid = { id: 'c-mid', caseNo: 'MID', status: 'OPEN', firstSeenRunId: 'r2', lastUpdatedRunId: 'r4', createdAt: new Date(Date.now() - 2 * 86_400_000) };
  const nu  = { id: 'c-new', caseNo: 'NEW', status: 'OPEN', firstSeenRunId: 'r5', lastUpdatedRunId: 'r5', createdAt: new Date(Date.now() - 0 * 86_400_000) };

  it('defaults to status=OPEN when status omitted', async () => {
    const findMany = jest.fn().mockResolvedValue([old, mid, nu]);
    const prisma = { reconciliationCase: { findMany } };
    const svc = mkSvc(prisma);
    await svc.listCases({});
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'OPEN' }),
    }));
  });

  it("treats status='ALL' as no filter", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { reconciliationCase: { findMany } };
    const svc = mkSvc(prisma);
    await svc.listCases({ status: 'ALL' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: undefined }),
    }));
  });

  it('respects explicit status override', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { reconciliationCase: { findMany } };
    const svc = mkSvc(prisma);
    await svc.listCases({ status: 'RESOLVED' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'RESOLVED' }),
    }));
  });

  it('sorts by aging desc and decorates rows with aging / firstSeenRunId / lastUpdatedRunId', async () => {
    // Return out of order; service should reorder by aging desc.
    const findMany = jest.fn().mockResolvedValue([mid, nu, old]);
    const prisma = { reconciliationCase: { findMany } };
    const svc = mkSvc(prisma);
    const rows = await svc.listCases({});
    expect(rows.map((r: any) => r.caseNo)).toEqual(['OLD', 'MID', 'NEW']);
    expect(rows[0].aging).toBeGreaterThanOrEqual(4);
    expect(rows[2].aging).toBeLessThanOrEqual(0);
    expect(rows[0].firstSeenRunId).toBe('r1');
    expect(rows[0].lastUpdatedRunId).toBe('r3');
  });
});
