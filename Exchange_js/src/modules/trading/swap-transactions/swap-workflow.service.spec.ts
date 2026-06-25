/**
 * swap-workflow.service.spec.ts
 *
 * Task 5: executeSwap creates a SETTLING swap and delegates physical leg
 * creation to SwapSettlementService.start — no atomic 7-leg accounting,
 * no SWAP_SUCCEEDED emit at executeSwap return.
 */
import { SwapWorkflowService } from './swap-workflow.service';
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
    traceId: null as string | null,
  };
}

// CASE B: AED (from) → USDT (to).
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

function buildMocks(quote: ReturnType<typeof baseQuote>) {
  const accountingService = {
    resolveTbAccountId: jest.fn(() => Promise.resolve(1n)),
    executePendingTransfer: jest.fn(() => Promise.resolve({ tbTransferId: 0n })),
    postPendingTransfer: jest.fn(() => Promise.resolve({ tbTransferId: 0n })),
    executeTransfer: jest.fn(() => Promise.resolve({ tbTransferId: 1n })),
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
    findOne: jest.fn(() => Promise.resolve({ id: 'swap-1', swapNo: 'SWP0001', status: 'SETTLING' })),
  };

  const swapSettlement = {
    start: jest.fn(() => Promise.resolve()),
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

  return { accountingService, swapQuoteService, swapTransactionsService, swapSettlement, auditLogsService, eventEmitter, onboardingService, prisma };
}

function makeService(mocks: ReturnType<typeof buildMocks>) {
  return new SwapWorkflowService(
    mocks.prisma,
    mocks.onboardingService as any,
    mocks.swapQuoteService as any,
    mocks.swapTransactionsService as any,
    mocks.accountingService as any,
    mocks.auditLogsService as any,
    mocks.eventEmitter as any,
    mocks.swapSettlement as any,
  );
}

// ── Core behavior ────────────────────────────────────────────────────────────

describe('SwapWorkflowService — Task 5: SETTLING + delegation', () => {
  it('creates swap with status SETTLING (no atomic TB legs, no SUCCESS)', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);

    await service.executeSwap('cust-1', 'q-1');

    // Swap row created via service
    expect(mocks.swapTransactionsService.create).toHaveBeenCalledTimes(1);

    // tb*TransferId columns are null at create time (legs post later)
    const createArg = (mocks.swapTransactionsService.create as jest.Mock).mock.calls[0][0];
    expect(createArg.tbFromTransferId).toBeNull();
    expect(createArg.tbToTransferId).toBeNull();
    expect(createArg.tbFeeTransferId).toBeNull();
    expect(createArg.tbSpreadTransferId).toBeNull();

    // No atomic direct transfers — delegation only
    expect(mocks.accountingService.executeTransfer).not.toHaveBeenCalled();

    // SwapSettlementService.start called once with the swap ctx
    expect(mocks.swapSettlement.start).toHaveBeenCalledTimes(1);

    // No SWAP_SUCCEEDED domain event at executeSwap return (swap is still SETTLING)
    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('passes correct SwapSettleCtx to start() — CASE A (USDT→AED, fromIsFiat=false)', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);

    await service.executeSwap('cust-1', 'q-1');

    const [ctx] = (mocks.swapSettlement.start as jest.Mock).mock.calls[0];
    expect(ctx.swapId).toBe('swap-1');
    expect(ctx.swapNo).toMatch(/^SWP/);
    expect(ctx.ownerId).toBe('cust-1');
    expect(ctx.fromIsFiat).toBe(false);   // USDT is CRYPTO
    expect(ctx.fromCurrency).toBe('USDT');
    expect(ctx.toCurrency).toBe('AED');
    expect(ctx.fromDecimals).toBe(6);
    expect(ctx.toDecimals).toBe(2);
    // grossToAmount = amountOut from quote
    expect(ctx.grossToAmount.equals(new Prisma.Decimal('0.05'))).toBe(true);
    expect(ctx.feeAmount.equals(new Prisma.Decimal('0.01'))).toBe(true);
  });

  it('passes correct SwapSettleCtx to start() — CASE B (AED→USDT, fromIsFiat=true)', async () => {
    const mocks = buildMocks(reverseQuote());
    const service = makeService(mocks);

    await service.executeSwap('cust-1', 'q-1');

    const [ctx] = (mocks.swapSettlement.start as jest.Mock).mock.calls[0];
    expect(ctx.fromIsFiat).toBe(true);    // AED is FIAT
    expect(ctx.fromCurrency).toBe('AED');
    expect(ctx.toCurrency).toBe('USDT');
    expect(ctx.fromDecimals).toBe(2);
    expect(ctx.toDecimals).toBe(6);
    expect(ctx.grossToAmount.equals(new Prisma.Decimal('50'))).toBe(true);
    expect(ctx.feeAmount.equals(new Prisma.Decimal('1'))).toBe(true);
  });

  it('still passes L1 guard, quote consume, SWAP_CREATED audit', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);

    await service.executeSwap('cust-1', 'q-1');

    // L1 eligibility checked
    expect(mocks.onboardingService.assertTradingEligibility).toHaveBeenCalledWith('cust-1', 'SWAP');

    // Quote consumed
    expect(mocks.swapQuoteService.consumeQuote).toHaveBeenCalledTimes(1);

    // SWAP_CREATED audit fired
    const createdAudit = (mocks.auditLogsService.recordByActor as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .find((a: any) => a.action === 'SWAP_CREATED');
    expect(createdAudit).toBeDefined();
  });

  it('inherits quote.traceId into create() call and SWAP_CREATED audit', async () => {
    const TRACE = 'QUOTE-TRACE-UUID';
    const mocks = buildMocks(makeQuote({ traceId: TRACE } as any));
    const service = makeService(mocks);

    await service.executeSwap('cust-1', 'q-1');

    const createArg = (mocks.swapTransactionsService.create as jest.Mock).mock.calls[0][0];
    expect(createArg.traceId).toBe(TRACE);

    const auditArg = (mocks.auditLogsService.recordByActor as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .find((a: any) => a.action === 'SWAP_CREATED');
    expect(auditArg?.traceId).toBe(TRACE);
  });

  it('emits SWAP_FAILED audit when create throws, re-throws error', async () => {
    const TRACE = 'QUOTE-TRACE-FAIL';
    const mocks = buildMocks(makeQuote({ traceId: TRACE } as any));
    (mocks.swapTransactionsService.create as jest.Mock).mockImplementation(() => Promise.reject(new Error('db error')));

    const service = makeService(mocks);
    await expect(service.executeSwap('cust-1', 'q-1')).rejects.toThrow('db error');

    const failAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .find((a: any) => a.action === 'SWAP_FAILED');
    expect(failAudit).toBeDefined();
    expect(failAudit.traceId).toBe(TRACE);

    // No SWAP_SUCCEEDED event
    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('does NOT emit SWAP_SUCCEEDED — settlement service owns that', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);

    await service.executeSwap('cust-1', 'q-1');

    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();
  });
});
