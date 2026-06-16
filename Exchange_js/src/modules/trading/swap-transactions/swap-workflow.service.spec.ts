/**
 * swap-workflow.service.spec.ts
 *
 * Asserts that executeSwap books spread into SPREAD_INCOME and fee into
 * FEE_INCOME — NOT FEE_RECEIVABLE. This is the TwoBook T4 revenue-at-trade
 * verification.
 */
import { SwapWorkflowService } from './swap-workflow.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { Prisma } from '@prisma/client';

// ── helpers ─────────────────────────────────────────────────────────────────

const makeQuote = (overrides: Partial<ReturnType<typeof baseQuote>> = {}) =>
  Object.assign(baseQuote(), overrides);

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
    marketRate: new Prisma.Decimal('0.0006'), // marketValueOut = 100 * 0.0006 = 0.06, spread = 0.01 AED (1n in 2-decimal bigint)
    feeTotal: new Prisma.Decimal('0.01'),
    feeCurrency: 'ETH',
    feeBreakdown: null,
    totalsJson: JSON.stringify({ amountOutNet: '0.0495' }),
    status: 'ACTIVE',
  };
}

// ── mocks ────────────────────────────────────────────────────────────────────

function buildMocks() {
  // resolveTbAccountId returns a unique bigint per code so we can track calls
  const resolveMap: Record<number, bigint> = {
    [TB_ACCOUNT_CODES.CLIENT_PAYABLE]: 10n,
    [TB_ACCOUNT_CODES.TRADE_CLEARING]: 20n,
    [120]: 30n, // FEE_RECEIVABLE (removed in Task 9) — should NOT be touched
    [TB_ACCOUNT_CODES.FEE_INCOME]: 40n,
    [TB_ACCOUNT_CODES.SPREAD_INCOME]: 50n,
  };

  let transferCounter = 1n;
  const makeTx = () => ({ tbTransferId: transferCounter++ });

  const accountingService = {
    resolveTbAccountId: jest.fn(({ code }: { code: number }) => Promise.resolve(resolveMap[code] ?? 99n)),
    executePendingTransfer: jest.fn(() => Promise.resolve(makeTx())),
    postPendingTransfer: jest.fn(() => Promise.resolve(makeTx())),
    executeTransfer: jest.fn(() => Promise.resolve(makeTx())),
    voidPendingTransferBestEffort: jest.fn(() => Promise.resolve()),
  };

  const quote = makeQuote();

  const swapQuoteService = {
    getActiveQuoteOrThrow: jest.fn(() => Promise.resolve(quote)),
    consumeQuote: jest.fn(() => Promise.resolve()),
  };

  const swapTransactionsService = {
    create: jest.fn(() => Promise.resolve({ id: 'swap-1', swapNo: 'SWP0001', ownerType: 'CUSTOMER', ownerId: 'cust-1', ownerNo: 'C0001', fromAssetId: 'asset-usdt', fromAssetCode: 'USDT', toAssetId: 'asset-aed', toAssetCode: 'AED' })),
    findOne: jest.fn(() => Promise.resolve({ id: 'swap-1', swapNo: 'SWP0001' })),
  };

  const outstandingsService = {
    createForSwapSuccess: jest.fn(() => Promise.resolve()),
  };

  const auditLogsService = {
    recordByActor: jest.fn(() => Promise.resolve()),
  };

  const eventEmitter = {
    emit: jest.fn(),
  };

  const onboardingService = {
    assertTradingEligibility: jest.fn(() => Promise.resolve()),
  };

  // prisma mock: $transaction executes the callback directly (synchronous-ish)
  // assets lookup
  const assetMap: Record<string, { currency: string; decimals: number }> = {
    'asset-usdt': { currency: 'USDT', decimals: 6 },
    'asset-aed': { currency: 'AED', decimals: 2 },
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

// ── test ─────────────────────────────────────────────────────────────────────

describe('SwapWorkflowService — T4 revenue accounts', () => {
  it('books spread to SPREAD_INCOME and fee to FEE_INCOME, not FEE_RECEIVABLE', async () => {
    const mocks = buildMocks();
    const service = new SwapWorkflowService(
      mocks.prisma,
      mocks.onboardingService as any,
      mocks.swapQuoteService as any,
      mocks.swapTransactionsService as any,
      mocks.outstandingsService as any,
      mocks.accountingService as any,
      mocks.auditLogsService as any,
      mocks.eventEmitter as any,
    );

    await service.executeSwap('cust-1', 'q-1');

    const resolveCalls = (mocks.accountingService.resolveTbAccountId.mock.calls as any[][]).map((c) => c[0].code);

    // Must see FEE_INCOME and SPREAD_INCOME
    expect(resolveCalls).toContain(TB_ACCOUNT_CODES.SPREAD_INCOME);
    expect(resolveCalls).toContain(TB_ACCOUNT_CODES.FEE_INCOME);

    // Must NOT see FEE_RECEIVABLE (code 120, removed in Task 9)
    expect(resolveCalls).not.toContain(120);
  });
});

describe('SwapWorkflowService — SW-T3 traceId inheritance', () => {
  it('inherits quote.traceId into swap.traceId and SWAP_CREATED audit shares that UUID', async () => {
    const TRACE = 'QUOTE-TRACE-UUID-FROM-TABLE';
    const mocks = buildMocks();
    // Override the quote returned by getActiveQuoteOrThrow to bake the trace in.
    const quoteWithTrace = makeQuote({ traceId: TRACE } as any);
    (mocks.swapQuoteService.getActiveQuoteOrThrow as jest.Mock).mockResolvedValue(quoteWithTrace);

    const service = new SwapWorkflowService(
      mocks.prisma,
      mocks.onboardingService as any,
      mocks.swapQuoteService as any,
      mocks.swapTransactionsService as any,
      mocks.outstandingsService as any,
      mocks.accountingService as any,
      mocks.auditLogsService as any,
      mocks.eventEmitter as any,
    );

    await service.executeSwap('cust-1', 'q-1');

    // 1. swap.create received traceId === quote.traceId
    const createCalls = (mocks.swapTransactionsService.create as jest.Mock).mock.calls;
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0][0].traceId).toBe(TRACE);

    // 2. SWAP_CREATED audit fired with the same traceId (no legacy SWAP:<swapNo>).
    const auditCalls = (mocks.auditLogsService.recordByActor as jest.Mock).mock.calls;
    const swapEvents = auditCalls
      .map((c: any[]) => c[0])
      .filter((args: any) => args.action === 'SWAP_CREATED' || args.action === 'SWAP_QUOTE_USED');
    expect(swapEvents.length).toBeGreaterThanOrEqual(1);
    swapEvents.forEach((e: any) => expect(e.traceId).toBe(TRACE));

    // 3. TB pending-transfer evidence carries the inherited UUID, not the legacy SWAP:<swapNo>.
    const tbEvidences = (mocks.accountingService.executePendingTransfer as jest.Mock).mock.calls
      .map((c: any[]) => c[0].evidence)
      .filter((e: any) => e && e.traceId);
    expect(tbEvidences.length).toBeGreaterThanOrEqual(1);
    tbEvidences.forEach((e: any) => expect(e.traceId).toBe(TRACE));
  });
});
