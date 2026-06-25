/**
 * swap-workflow.service.spec.ts
 *
 * Real-time 1:1 swap accounting (Task 10). Asserts executeSwap books the new
 * parametric multi-leg physical transfers — no TRADE_CLEARING bridge, no
 * Outstanding, no spread leg — for BOTH directions:
 *   CASE A (USDT→AED, sell crypto / buy fiat, fee in AED)
 *   CASE B (AED→USDT, sell fiat / buy crypto, fee in USDT)
 */
import { SwapWorkflowService } from './swap-workflow.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { Prisma } from '@prisma/client';

// ── helpers ─────────────────────────────────────────────────────────────────

const makeQuote = (overrides: Partial<ReturnType<typeof baseQuote>> = {}) =>
  Object.assign(baseQuote(), overrides);

// CASE A: USDT (from) → AED (to). fee in AED.
function baseQuote() {
  return {
    id: 'q-1',
    quoteNo: 'QT0001',
    ownerId: 'cust-1',
    ownerNo: 'C0001',
    ownerType: 'CUSTOMER',
    fromAssetId: 'asset-usdt',
    fromAssetCode: 'USDT',
    toAssetId: 'asset-aed',
    toAssetCode: 'AED',
    amountIn: new Prisma.Decimal('100'),
    amountOut: new Prisma.Decimal('0.05'),
    rateAllIn: new Prisma.Decimal('0.0005'),
    marketRate: new Prisma.Decimal('0.0006'),
    feeTotal: new Prisma.Decimal('0.01'),
    feeCurrency: 'AED',
    feeBreakdown: null,
    totalsJson: JSON.stringify({ amountOutNet: '0.04' }),
    status: 'ACTIVE',
  };
}

// CASE B: AED (from) → USDT (to). fee in USDT.
function reverseQuote() {
  return makeQuote({
    fromAssetId: 'asset-aed',
    fromAssetCode: 'AED',
    toAssetId: 'asset-usdt',
    toAssetCode: 'USDT',
    amountIn: new Prisma.Decimal('100'),
    amountOut: new Prisma.Decimal('50'),
    rateAllIn: new Prisma.Decimal('0.5'),
    marketRate: new Prisma.Decimal('0.51'),
    feeTotal: new Prisma.Decimal('1'),
    feeCurrency: 'USDT',
    totalsJson: JSON.stringify({ amountOutNet: '49' }),
  } as any);
}

// ── mocks ────────────────────────────────────────────────────────────────────

const assetMap: Record<string, { currency: string; decimals: number; type: string }> = {
  'asset-usdt': { currency: 'USDT', decimals: 6, type: 'CRYPTO' },
  'asset-aed': { currency: 'AED', decimals: 2, type: 'FIAT' },
};

// Encode (code, ledger) into a unique bigint so a test can assert which physical
// account a leg touched: id = code*10 + ledger.
function acctId(code: number, ledger: number): bigint {
  return BigInt(code * 10 + ledger);
}

function buildMocks(quote: ReturnType<typeof baseQuote>) {
  const accountingService = {
    resolveTbAccountId: jest.fn(({ code, ledger }: { code: number; ledger: number }) =>
      Promise.resolve(acctId(code, ledger)),
    ),
    executePendingTransfer: jest.fn(() => Promise.resolve({ tbTransferId: 0n })),
    postPendingTransfer: jest.fn(() => Promise.resolve({ tbTransferId: 0n })),
    executeTransfer: jest.fn((p: any) => {
      // Deterministic-ish unique id per call so the row gets distinct hex values.
      return Promise.resolve({ tbTransferId: BigInt(p.code) * 1000n + acctId(0, 0) + 1n });
    }),
    voidPendingTransferBestEffort: jest.fn(() => Promise.resolve()),
  };

  const swapQuoteService = {
    getActiveQuoteOrThrow: jest.fn(() => Promise.resolve(quote)),
    consumeQuote: jest.fn(() => Promise.resolve()),
  };

  const swapTransactionsService = {
    create: jest.fn(() => Promise.resolve({
      id: 'swap-1', swapNo: 'SWP0001', ownerType: 'CUSTOMER', ownerId: 'cust-1', ownerNo: 'C0001',
      fromAssetId: quote.fromAssetId, fromAssetCode: quote.fromAssetCode,
      toAssetId: quote.toAssetId, toAssetCode: quote.toAssetCode,
    })),
    findOne: jest.fn(() => Promise.resolve({ id: 'swap-1', swapNo: 'SWP0001' })),
  };

  const outstandingsService = {
    createForSwapSuccess: jest.fn(() => Promise.resolve()),
  };

  const auditLogsService = {
    recordByActor: jest.fn(() => Promise.resolve()),
    recordSystem: jest.fn(() => Promise.resolve()),
  };

  const eventEmitter = { emit: jest.fn() };

  const onboardingService = {
    assertTradingEligibility: jest.fn(() => Promise.resolve()),
  };

  const prisma: any = {
    customerMain: {
      findUnique: jest.fn(() => Promise.resolve({ id: 'cust-1', complianceStatus: 'ACTIVE', adminStatus: 'ACTIVE', onboardingStatus: 'APPROVED' })),
    },
    $transaction: jest.fn((cb: (tx: any) => Promise<any>) => {
      const tx: any = {
        asset: {
          findUnique: jest.fn(({ where }: any) => Promise.resolve(assetMap[where.id] ?? null)),
        },
        swapTransaction: {
          update: jest.fn(() => Promise.resolve({})),
        },
      };
      return cb(tx);
    }),
  };

  return { accountingService, swapQuoteService, swapTransactionsService, outstandingsService, auditLogsService, eventEmitter, onboardingService, prisma };
}

function makeService(mocks: ReturnType<typeof buildMocks>) {
  // OutstandingsService was removed as a constructor dependency in Task 10. The
  // outstandingsService mock is no longer wired into the service; the
  // `createForSwapSuccess` not-called assertions guard against the workflow ever
  // re-introducing an Outstanding write.
  return new SwapWorkflowService(
    mocks.prisma,
    mocks.onboardingService as any,
    mocks.swapQuoteService as any,
    mocks.swapTransactionsService as any,
    mocks.accountingService as any,
    mocks.auditLogsService as any,
    mocks.eventEmitter as any,
  );
}

// Extract the ordered list of transfer `code`s passed to executeTransfer.
function transferCodes(accountingService: any): number[] {
  return (accountingService.executeTransfer.mock.calls as any[][]).map((c) => c[0].code);
}

// Find the single executeTransfer call matching a transfer code.
function legByCode(accountingService: any, code: number): any {
  const call = (accountingService.executeTransfer.mock.calls as any[][]).find((c) => c[0].code === code);
  return call ? call[0] : undefined;
}

const AED = TB_LEDGERS.AED;
const USDT = TB_LEDGERS.USDT;
const T = TB_TRANSFER_CODES;
const C = TB_ACCOUNT_CODES;

// ── CASE A: USDT → AED ────────────────────────────────────────────────────────

describe('SwapWorkflowService — real-time multi-leg, CASE A (USDT→AED)', () => {
  it('posts 7 direct legs in SELL→BUY→FEE order with correct accounts; no clearing/spread/pending; no Outstanding', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);

    await service.executeSwap('cust-1', 'q-1');

    // 7 direct transfers, exact code order.
    expect(transferCodes(mocks.accountingService)).toEqual([
      T.SWAP_SELL_CLIENT,      // 1
      T.SWAP_SELL_FIRM,        // 2 crypto sell direct to FIRM_OPS
      T.SWAP_BUY_OPS_TO_SET,   // 3 fiat buy hop
      T.SWAP_BUY_SET_TO_ASSET, // 4
      T.SWAP_BUY_CLIENT,       // 5
      T.SWAP_FEE_CLIENT,       // 6
      T.SWAP_FEE_FIRM,         // 7
    ]);

    // No pending transfers in the real-time model.
    expect(mocks.accountingService.executePendingTransfer).not.toHaveBeenCalled();
    expect(mocks.accountingService.postPendingTransfer).not.toHaveBeenCalled();

    // No Outstanding creation.
    expect(mocks.outstandingsService.createForSwapSuccess).not.toHaveBeenCalled();

    // ── leg-by-leg DR/CR account checks ──
    // 1: client sell USDT — DR CLIENT_PAYABLE·USDT / CR CLIENT_ASSET·USDT
    const l1 = legByCode(mocks.accountingService, T.SWAP_SELL_CLIENT);
    expect(l1.debitAccountId).toBe(acctId(C.CLIENT_PAYABLE, USDT));
    expect(l1.creditAccountId).toBe(acctId(C.CLIENT_ASSET, USDT));
    expect(l1.ledger).toBe(USDT);

    // 2: firm receive crypto — DR FIRM_ASSET·USDT / CR FIRM_OPS·USDT
    const l2 = legByCode(mocks.accountingService, T.SWAP_SELL_FIRM);
    expect(l2.debitAccountId).toBe(acctId(C.FIRM_ASSET, USDT));
    expect(l2.creditAccountId).toBe(acctId(C.FIRM_OPS, USDT));

    // 3: fiat ops→set — DR FIRM_OPS·AED / CR FIRM_SET·AED
    const l3 = legByCode(mocks.accountingService, T.SWAP_BUY_OPS_TO_SET);
    expect(l3.debitAccountId).toBe(acctId(C.FIRM_OPS, AED));
    expect(l3.creditAccountId).toBe(acctId(C.FIRM_SET, AED));

    // 4: fiat set→asset — DR FIRM_SET·AED / CR FIRM_ASSET·AED
    const l4 = legByCode(mocks.accountingService, T.SWAP_BUY_SET_TO_ASSET);
    expect(l4.debitAccountId).toBe(acctId(C.FIRM_SET, AED));
    expect(l4.creditAccountId).toBe(acctId(C.FIRM_ASSET, AED));

    // 5: client buy AED (gross) — DR CLIENT_ASSET·AED / CR CLIENT_PAYABLE·AED
    const l5 = legByCode(mocks.accountingService, T.SWAP_BUY_CLIENT);
    expect(l5.debitAccountId).toBe(acctId(C.CLIENT_ASSET, AED));
    expect(l5.creditAccountId).toBe(acctId(C.CLIENT_PAYABLE, AED));

    // 6: client fee AED — DR CLIENT_PAYABLE·AED / CR CLIENT_ASSET·AED
    const l6 = legByCode(mocks.accountingService, T.SWAP_FEE_CLIENT);
    expect(l6.debitAccountId).toBe(acctId(C.CLIENT_PAYABLE, AED));
    expect(l6.creditAccountId).toBe(acctId(C.CLIENT_ASSET, AED));

    // 7: firm fee AED — DR FIRM_ASSET·AED / CR FIRM_FEE·AED
    const l7 = legByCode(mocks.accountingService, T.SWAP_FEE_FIRM);
    expect(l7.debitAccountId).toBe(acctId(C.FIRM_ASSET, AED));
    expect(l7.creditAccountId).toBe(acctId(C.FIRM_FEE, AED));
  });

  it('books amounts: fromAmount on sell legs, grossTo on buy legs, fee on fee legs', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);

    await service.executeSwap('cust-1', 'q-1');

    // fromAmount = 100 USDT @ 6 decimals = 100_000000n
    expect(legByCode(mocks.accountingService, T.SWAP_SELL_CLIENT).amount).toBe(100_000000n);
    expect(legByCode(mocks.accountingService, T.SWAP_SELL_FIRM).amount).toBe(100_000000n);
    // grossTo = 0.05 AED @ 2 decimals = 5n
    expect(legByCode(mocks.accountingService, T.SWAP_BUY_OPS_TO_SET).amount).toBe(5n);
    expect(legByCode(mocks.accountingService, T.SWAP_BUY_SET_TO_ASSET).amount).toBe(5n);
    expect(legByCode(mocks.accountingService, T.SWAP_BUY_CLIENT).amount).toBe(5n);
    // fee = 0.01 AED @ 2 decimals = 1n
    expect(legByCode(mocks.accountingService, T.SWAP_FEE_CLIENT).amount).toBe(1n);
    expect(legByCode(mocks.accountingService, T.SWAP_FEE_FIRM).amount).toBe(1n);
  });
});

// ── CASE B: AED → USDT ────────────────────────────────────────────────────────

describe('SwapWorkflowService — real-time multi-leg, CASE B (AED→USDT)', () => {
  it('posts 7 direct legs: fiat-sell adds SET→OPS hop, crypto-buy skips OPS→SET hop', async () => {
    const mocks = buildMocks(reverseQuote());
    const service = makeService(mocks);

    await service.executeSwap('cust-1', 'q-1');

    expect(transferCodes(mocks.accountingService)).toEqual([
      T.SWAP_SELL_CLIENT,       // 1
      T.SWAP_SELL_FIRM,         // 2 fiat sell → FIRM_SET
      T.SWAP_SELL_SET_TO_OPS,   // 3 fiat sell SET→OPS hop
      T.SWAP_BUY_OPS_TO_ASSET,  // 4 crypto buy direct OPS→FIRM_ASSET (no OPS_TO_SET)
      T.SWAP_BUY_CLIENT,        // 5
      T.SWAP_FEE_CLIENT,        // 6
      T.SWAP_FEE_FIRM,          // 7
    ]);

    // Crypto-buy must NOT include the fiat OPS→SET hop.
    expect(transferCodes(mocks.accountingService)).not.toContain(T.SWAP_BUY_OPS_TO_SET);

    expect(mocks.outstandingsService.createForSwapSuccess).not.toHaveBeenCalled();

    // 1: client sell AED — DR CLIENT_PAYABLE·AED / CR CLIENT_ASSET·AED
    const l1 = legByCode(mocks.accountingService, T.SWAP_SELL_CLIENT);
    expect(l1.debitAccountId).toBe(acctId(C.CLIENT_PAYABLE, AED));
    expect(l1.creditAccountId).toBe(acctId(C.CLIENT_ASSET, AED));

    // 2: firm receive fiat — DR FIRM_ASSET·AED / CR FIRM_SET·AED
    const l2 = legByCode(mocks.accountingService, T.SWAP_SELL_FIRM);
    expect(l2.debitAccountId).toBe(acctId(C.FIRM_ASSET, AED));
    expect(l2.creditAccountId).toBe(acctId(C.FIRM_SET, AED));

    // 3: fiat set→ops — DR FIRM_SET·AED / CR FIRM_OPS·AED
    const l3 = legByCode(mocks.accountingService, T.SWAP_SELL_SET_TO_OPS);
    expect(l3.debitAccountId).toBe(acctId(C.FIRM_SET, AED));
    expect(l3.creditAccountId).toBe(acctId(C.FIRM_OPS, AED));

    // 4: crypto buy firm — DR FIRM_OPS·USDT / CR FIRM_ASSET·USDT
    const l4 = legByCode(mocks.accountingService, T.SWAP_BUY_OPS_TO_ASSET);
    expect(l4.debitAccountId).toBe(acctId(C.FIRM_OPS, USDT));
    expect(l4.creditAccountId).toBe(acctId(C.FIRM_ASSET, USDT));

    // 5: client buy USDT (gross) — DR CLIENT_ASSET·USDT / CR CLIENT_PAYABLE·USDT
    const l5 = legByCode(mocks.accountingService, T.SWAP_BUY_CLIENT);
    expect(l5.debitAccountId).toBe(acctId(C.CLIENT_ASSET, USDT));
    expect(l5.creditAccountId).toBe(acctId(C.CLIENT_PAYABLE, USDT));

    // 6: client fee USDT — DR CLIENT_PAYABLE·USDT / CR CLIENT_ASSET·USDT
    const l6 = legByCode(mocks.accountingService, T.SWAP_FEE_CLIENT);
    expect(l6.debitAccountId).toBe(acctId(C.CLIENT_PAYABLE, USDT));
    expect(l6.creditAccountId).toBe(acctId(C.CLIENT_ASSET, USDT));

    // 7: firm fee USDT — DR FIRM_ASSET·USDT / CR FIRM_FEE·USDT
    const l7 = legByCode(mocks.accountingService, T.SWAP_FEE_FIRM);
    expect(l7.debitAccountId).toBe(acctId(C.FIRM_ASSET, USDT));
    expect(l7.creditAccountId).toBe(acctId(C.FIRM_FEE, USDT));
  });
});

// ── fee-free path ─────────────────────────────────────────────────────────────

describe('SwapWorkflowService — zero fee', () => {
  it('omits both fee legs when feeTotal = 0', async () => {
    const mocks = buildMocks(makeQuote({ feeTotal: new Prisma.Decimal('0') } as any));
    const service = makeService(mocks);

    await service.executeSwap('cust-1', 'q-1');

    const codes = transferCodes(mocks.accountingService);
    expect(codes).not.toContain(T.SWAP_FEE_CLIENT);
    expect(codes).not.toContain(T.SWAP_FEE_FIRM);
    // SELL(2) + BUY fiat(3) = 5 legs, no fee.
    expect(codes).toHaveLength(5);
  });
});

// ── terminal audit events (carried over) ──────────────────────────────────────

describe('SwapWorkflowService — terminal audit events', () => {
  it('emits SWAP_SUCCEEDED audit + SWAP_SUCCEEDED domain event with inherited traceId', async () => {
    const TRACE = 'QUOTE-TRACE-FOR-SUCCEEDED';
    const mocks = buildMocks(makeQuote({ traceId: TRACE } as any));

    const captured: any[] = [];
    (mocks.auditLogsService as any).recordSystem = jest.fn((args: any) => { captured.push(args); return Promise.resolve(); });
    (mocks.auditLogsService.recordByActor as jest.Mock).mockImplementation((args: any) => { captured.push(args); return Promise.resolve(); });

    const service = makeService(mocks);
    await service.executeSwap('cust-1', 'q-1');

    const succeeded = captured.filter((a: any) => a.action === 'SWAP_SUCCEEDED');
    expect(succeeded).toHaveLength(1);
    expect(succeeded[0].traceId).toBe(TRACE);

    // Post-commit domain event still emitted.
    expect(mocks.eventEmitter.emit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ swapId: 'swap-1', ownerId: 'cust-1' }),
    );
  });

  it('emits SWAP_FAILED audit when execution throws', async () => {
    const TRACE = 'QUOTE-TRACE-FOR-FAILED';
    const mocks = buildMocks(makeQuote({ traceId: TRACE } as any));
    (mocks.swapTransactionsService.create as jest.Mock).mockImplementation(() => Promise.reject(new Error('boom')));

    const captured: any[] = [];
    (mocks.auditLogsService as any).recordSystem = jest.fn((args: any) => { captured.push(args); return Promise.resolve(); });
    (mocks.auditLogsService.recordByActor as jest.Mock).mockImplementation((args: any) => { captured.push(args); return Promise.resolve(); });

    const service = makeService(mocks);
    await expect(service.executeSwap('cust-1', 'q-1')).rejects.toThrow();

    const failed = captured.filter((a: any) => a.action === 'SWAP_FAILED');
    expect(failed).toHaveLength(1);
    expect(failed[0].traceId).toBe(TRACE);
  });
});

// ── traceId inheritance (carried over) ────────────────────────────────────────

describe('SwapWorkflowService — traceId inheritance', () => {
  it('inherits quote.traceId into swap.create, SWAP_CREATED audit, and TB evidence', async () => {
    const TRACE = 'QUOTE-TRACE-UUID-FROM-TABLE';
    const mocks = buildMocks(makeQuote({ traceId: TRACE } as any));

    const service = makeService(mocks);
    await service.executeSwap('cust-1', 'q-1');

    // 1. swap.create received traceId === quote.traceId
    const createCalls = (mocks.swapTransactionsService.create as jest.Mock).mock.calls;
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0][0].traceId).toBe(TRACE);

    // 2. SWAP_CREATED audit fired with the same traceId.
    const auditCalls = (mocks.auditLogsService.recordByActor as jest.Mock).mock.calls;
    const swapEvents = auditCalls.map((c: any[]) => c[0]).filter((args: any) => args.action === 'SWAP_CREATED');
    expect(swapEvents.length).toBeGreaterThanOrEqual(1);
    swapEvents.forEach((e: any) => expect(e.traceId).toBe(TRACE));

    // 3. Every TB direct-transfer evidence carries the inherited UUID.
    const tbEvidences = (mocks.accountingService.executeTransfer as jest.Mock).mock.calls
      .map((c: any[]) => c[0].evidence)
      .filter((e: any) => e && e.traceId);
    expect(tbEvidences.length).toBeGreaterThanOrEqual(1);
    tbEvidences.forEach((e: any) => expect(e.traceId).toBe(TRACE));
  });
});
