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
    [TB_ACCOUNT_CODES.CLIENT_CREDIT]: 10n,
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
