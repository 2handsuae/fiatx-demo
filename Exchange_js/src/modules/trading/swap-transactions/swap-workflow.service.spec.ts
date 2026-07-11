/**
 * swap-workflow.service.spec.ts
 *
 * SwapWorkflowService owns the swap journey, now event-driven on funds_order:
 *   executeSwap        → creates the swap (PROCESSING) + leg1 funds_order (CREATED)
 *                        + books leg1 pending TB.
 *   advanceLeg         → thin sync wrapper: resolve active leg → funds_order.advance
 *                        (sell-first guard preserved).
 *   handleFundsOrderChanged → on CLEARED: post + chain next / finalize SUCCESS;
 *                        on FAILED/TIMEOUT: Swap-6 self-heal (retry ≤3 else STUCK).
 *   resumeLeg          → manual recovery (fresh attempt, clears needsReview).
 */
import { SwapWorkflowService } from './swap-workflow.service';
import { Prisma } from '@prisma/client';
import { FundsOrderStatus } from '../../funds-orders/dto/funds-order.dto';

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
    findOne: jest.fn(() => Promise.resolve({ id: 'swap-1', swapNo: 'SWP0001', status: 'PROCESSING' })),
    recomputeProjections: jest.fn(() => Promise.resolve()),
  };

  const auditLogsService = {
    recordByActor: jest.fn(() => Promise.resolve()),
    recordSystem: jest.fn(() => Promise.resolve()),
  };

  const eventEmitter = { emit: jest.fn() };

  const onboardingService = {
    assertTradingEligibility: jest.fn(() => Promise.resolve()),
  };

  const walletQuery = {
    hasReceivingAccount: jest.fn(() => Promise.resolve(true)),
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

  return { accountingService, swapQuoteService, swapTransactionsService, auditLogsService, eventEmitter, onboardingService, walletQuery, prisma };
}

function makeService(mocks: ReturnType<typeof buildMocks>) {
  // C2c cut-over: executeSwap drives leg1-only via SwapLegAccounting + FundsOrderService.
  const stubLegAccounting: any = {
    ctxFromSwap: jest.fn(),
    initiateLegPending: jest.fn(() => Promise.resolve()),
    postLeg: jest.fn(() => Promise.resolve()),
    voidLeg: jest.fn(() => Promise.resolve()),
    // R1: workflow resolves the leg's from/to wallets before funds_order.create.
    // Default stub returns both filled — tests asserting invariant violations
    // override per-call via mockResolvedValueOnce.
    resolveLegWallets: jest.fn(() =>
      Promise.resolve({ fromWalletId: 'w-from', toWalletId: 'w-to' }),
    ),
  };
  const stubFundsOrders: any = {
    create: jest.fn(() => Promise.resolve({ id: 'fo-1', legSeq: 1, attempt: 1, status: 'CREATED' })),
    advance: jest.fn(() => Promise.resolve({ id: 'fo-1', status: FundsOrderStatus.SUBMITTED })),
    findByParent: jest.fn(() => Promise.resolve([])),
  };
  // expose so tests can assert on them
  (mocks as any).legAccounting = stubLegAccounting;
  (mocks as any).fundsOrders = stubFundsOrders;
  return new SwapWorkflowService(
    mocks.prisma,
    mocks.onboardingService as any,
    mocks.swapQuoteService as any,
    mocks.swapTransactionsService as any,
    mocks.accountingService as any,
    mocks.auditLogsService as any,
    mocks.eventEmitter as any,
    stubLegAccounting,
    stubFundsOrders,
    (mocks as any).walletQuery,
  );
}

// ── executeSwap ──────────────────────────────────────────────────────────────

describe('SwapWorkflowService.executeSwap — PROCESSING + leg1 funds_order', () => {
  it('creates swap PROCESSING (no atomic TB legs, no SUCCESS) + leg1 funds_order CREATED', async () => {
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

    // leg1-only progressive create via FundsOrderService (funds_order CREATED).
    expect((mocks as any).fundsOrders.create).toHaveBeenCalledTimes(1);
    const createLegArg = ((mocks as any).fundsOrders.create as jest.Mock).mock.calls[0][0];
    expect(createLegArg.swapTransactionId).toBe('swap-1');
    expect(createLegArg.legSeq).toBe(1);
    expect(createLegArg.attempt).toBe(1);
    expect(createLegArg.initialStatus).toBe(FundsOrderStatus.CREATED);
    // leg1 pending booked; leg is NOT auto-advanced (driver submits it).
    expect((mocks as any).legAccounting.initiateLegPending).toHaveBeenCalledTimes(1);
    expect((mocks as any).fundsOrders.advance).not.toHaveBeenCalled();

    // No SWAP_SUCCEEDED domain event at executeSwap return (swap is still PROCESSING)
    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('passes correct SwapSettleCtx (leg1 pending) — CASE A (USDT→AED, fromIsFiat=false)', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);

    await service.executeSwap('cust-1', 'q-1');

    const initiateArg = ((mocks as any).legAccounting.initiateLegPending as jest.Mock).mock.calls[0];
    const ctx = initiateArg[0];
    expect(ctx.swapId).toBe('swap-1');
    expect(ctx.swapNo).toMatch(/^SWP/);
    expect(ctx.ownerId).toBe('cust-1');
    expect(ctx.fromIsFiat).toBe(false);   // USDT is CRYPTO
    expect(ctx.fromCurrency).toBe('USDT');
    expect(ctx.toCurrency).toBe('AED');
    expect(ctx.fromDecimals).toBe(6);
    expect(ctx.toDecimals).toBe(2);
    expect(ctx.grossToAmount.equals(new Prisma.Decimal('0.05'))).toBe(true);
    expect(ctx.feeAmount.equals(new Prisma.Decimal('0.01'))).toBe(true);
    expect(ctx.attempt).toBe(1);
  });

  it('passes correct SwapSettleCtx (leg1 pending) — CASE B (AED→USDT, fromIsFiat=true)', async () => {
    const mocks = buildMocks(reverseQuote());
    const service = makeService(mocks);

    await service.executeSwap('cust-1', 'q-1');

    const initiateArg = ((mocks as any).legAccounting.initiateLegPending as jest.Mock).mock.calls[0];
    const ctx = initiateArg[0];
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

    expect(mocks.onboardingService.assertTradingEligibility).toHaveBeenCalledWith('cust-1', 'SWAP');
    expect(mocks.swapQuoteService.consumeQuote).toHaveBeenCalledTimes(1);

    const createdAudit = (mocks.auditLogsService.recordByActor as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .find((a: any) => a.action === 'SWAP_CREATED');
    expect(createdAudit).toBeDefined();
  });

  it('R4: rejects RECEIVING_ACCOUNT_REQUIRED when buy-side (toAsset) has no receiving account', async () => {
    const mocks = buildMocks(makeQuote()); // USDT(from) → AED(to)
    const service = makeService(mocks);
    (mocks as any).walletQuery.hasReceivingAccount.mockImplementation(
      (_customerId: string, assetId: string) => Promise.resolve(assetId !== 'asset-aed'),
    );

    await expect(service.executeSwap('cust-1', 'q-1')).rejects.toMatchObject({
      response: { code: 'RECEIVING_ACCOUNT_REQUIRED', assetCode: 'AED' },
    });

    // Swap must NOT proceed — no swap row, no leg1 funds_order.
    expect(mocks.swapTransactionsService.create).not.toHaveBeenCalled();
    expect((mocks as any).fundsOrders.create).not.toHaveBeenCalled();
  });

  it('R4: rejects RECEIVING_ACCOUNT_REQUIRED when sell-side (fromAsset) has no receiving account', async () => {
    const mocks = buildMocks(makeQuote()); // USDT(from) → AED(to)
    const service = makeService(mocks);
    (mocks as any).walletQuery.hasReceivingAccount.mockImplementation(
      (_customerId: string, assetId: string) => Promise.resolve(assetId !== 'asset-usdt'),
    );

    await expect(service.executeSwap('cust-1', 'q-1')).rejects.toMatchObject({
      response: { code: 'RECEIVING_ACCOUNT_REQUIRED', assetCode: 'USDT' },
    });

    expect(mocks.swapTransactionsService.create).not.toHaveBeenCalled();
    expect((mocks as any).fundsOrders.create).not.toHaveBeenCalled();
  });

  it('R4: proceeds past the gate when both sides have an active receiving account', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);
    // default stub already resolves true for both sides

    await service.executeSwap('cust-1', 'q-1');

    expect((mocks as any).walletQuery.hasReceivingAccount).toHaveBeenCalledWith('cust-1', 'asset-usdt');
    expect((mocks as any).walletQuery.hasReceivingAccount).toHaveBeenCalledWith('cust-1', 'asset-aed');
    expect(mocks.swapTransactionsService.create).toHaveBeenCalledTimes(1);
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

    // traceId propagates onto the leg1 funds_order too.
    const createLegArg = ((mocks as any).fundsOrders.create as jest.Mock).mock.calls[0][0];
    expect(createLegArg.traceId).toBe(TRACE);
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

    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();
  });
});

// ── advanceLeg (thin wrapper) ────────────────────────────────────────────────

import { InternalFundAction } from '../../funds-layer/dto/internal-fund.dto';
import { FundsOrderAction } from '../../funds-orders/dto/funds-order.dto';
import { AuditActions } from '../../audit-logging/constants/audit-actions.constant';
import { mapLegAction } from './swap-workflow.service';

// Build mocks for advanceLeg + handleFundsOrderChanged (extends executeSwap mocks).
function buildAdvanceLegMocks(opts: {
  swapNo?: string;
  fromIsFiat?: boolean;
  legs: Array<{ legSeq: number; status: string; id?: string; attempt?: number }>;
}) {
  const swapNo = opts.swapNo ?? 'SWP0001';
  const fromIsFiat = opts.fromIsFiat ?? false;

  // Snapshot of active legs (one row per legSeq = max attempt).
  const legState = opts.legs.map((l) => ({
    id: l.id ?? `fo-${l.legSeq}-id`,
    legSeq: l.legSeq,
    attempt: l.attempt ?? 1,
    status: l.status,
    swapTransactionId: 'swap-1',
  }));

  const swapRow = {
    id: 'swap-1',
    swapNo,
    status: 'PROCESSING',
    ownerType: 'CUSTOMER',
    ownerId: 'cust-1',
    ownerNo: 'C0001',
    traceId: null,
    fromAssetId: fromIsFiat ? 'asset-aed' : 'asset-usdt',
    toAssetId: fromIsFiat ? 'asset-usdt' : 'asset-aed',
    fromAmount: new Prisma.Decimal('100'),
    toAmount: new Prisma.Decimal('368'),
    feeAmount: new Prisma.Decimal('1'),
    fromAsset: fromIsFiat
      ? { decimals: 2, currency: 'AED', type: 'FIAT' }
      : { decimals: 6, currency: 'USDT', type: 'CRYPTO' },
    toAsset: fromIsFiat
      ? { decimals: 6, currency: 'USDT', type: 'CRYPTO' }
      : { decimals: 2, currency: 'AED', type: 'FIAT' },
  };

  const swapTransactionsService = {
    findByNoInternal: jest.fn(() => Promise.resolve(swapRow)),
    findByIdInternal: jest.fn(() => Promise.resolve(swapRow)),
    activeLegsBySeq: jest.fn(() => Promise.resolve(legState.slice())),
    markStatus: jest.fn(() => Promise.resolve()),
    setNeedsReview: jest.fn(() => Promise.resolve()),
    recomputeProjections: jest.fn(() => Promise.resolve()),
    create: jest.fn(),
    findOne: jest.fn(),
  };

  const fundsOrders = {
    // create: mirror the side-effect — a new leg row gets appended to legState.
    create: jest.fn((input: any) => {
      const newLeg = {
        id: `fo-${input.legSeq}-a${input.attempt}-id`,
        legSeq: input.legSeq,
        attempt: input.attempt ?? 1,
        status: 'CREATED',
        swapTransactionId: 'swap-1',
      };
      legState.push(newLeg);
      return Promise.resolve(newLeg);
    }),
    // advance: flip the target row's status (default CLEARED for happy-path).
    advance: jest.fn((id: string) => {
      const row = legState.find((l) => l.id === id);
      if (row) row.status = FundsOrderStatus.CLEARED;
      return Promise.resolve(row ?? { id, status: FundsOrderStatus.CLEARED });
    }),
    findByParent: jest.fn(() => Promise.resolve(legState.slice())),
  };

  const legAccounting = {
    ctxFromSwap: jest.fn((swap: any) => ({
      swapId: swap.id,
      swapNo: swap.swapNo,
      ownerId: swap.ownerId,
      fromIsFiat,
      fromAssetId: swap.fromAssetId,
      toAssetId: swap.toAssetId,
      fromLedger: fromIsFiat ? 1 : 2,
      toLedger: fromIsFiat ? 2 : 1,
      fromCurrency: fromIsFiat ? 'AED' : 'USDT',
      toCurrency: fromIsFiat ? 'USDT' : 'AED',
      fromAmount: new Prisma.Decimal('100'),
      grossToAmount: new Prisma.Decimal('368'),
      feeAmount: new Prisma.Decimal('1'),
      fromDecimals: fromIsFiat ? 2 : 6,
      toDecimals: fromIsFiat ? 6 : 2,
    })),
    initiateLegPending: jest.fn(() => Promise.resolve()),
    postLeg: jest.fn(() => Promise.resolve()),
    voidLeg: jest.fn(() => Promise.resolve()),
    resolveLegWallets: jest.fn(() =>
      Promise.resolve({ fromWalletId: 'w-from', toWalletId: 'w-to' }),
    ),
  };

  const auditLogsService = {
    recordByActor: jest.fn(() => Promise.resolve()),
    recordSystem: jest.fn(() => Promise.resolve()),
  };

  const eventEmitter = { emit: jest.fn() };
  const onboardingService = { assertTradingEligibility: jest.fn(() => Promise.resolve()) };
  const walletQuery = { hasReceivingAccount: jest.fn(() => Promise.resolve(true)) };
  const swapQuoteService = { getActiveQuoteOrThrow: jest.fn(), consumeQuote: jest.fn() };
  const accountingService = {
    resolveTbAccountId: jest.fn(),
    executePendingTransfer: jest.fn(),
    postPendingTransfer: jest.fn(),
    executeTransfer: jest.fn(),
  };
  const txClient: any = { __tx: true };

  const prisma: any = {
    customerMain: { findUnique: jest.fn() },
    $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(txClient)),
  };

  return {
    swapNo,
    swapRow,
    legState,
    txClient,
    prisma,
    onboardingService,
    walletQuery,
    swapQuoteService,
    swapTransactionsService,
    accountingService,
    auditLogsService,
    eventEmitter,
    fundsOrders,
    legAccounting,
  };
}

function makeAdvanceLegService(mocks: ReturnType<typeof buildAdvanceLegMocks>) {
  return new SwapWorkflowService(
    mocks.prisma,
    mocks.onboardingService as any,
    mocks.swapQuoteService as any,
    mocks.swapTransactionsService as any,
    mocks.accountingService as any,
    mocks.auditLogsService as any,
    mocks.eventEmitter as any,
    mocks.legAccounting as any,
    mocks.fundsOrders as any,
    mocks.walletQuery as any,
  );
}

describe('SwapWorkflowService.advanceLeg (thin wrapper)', () => {
  it('resolves the active leg and delegates to funds_order.advance with the mapped action', async () => {
    const mocks = buildAdvanceLegMocks({
      legs: [{ legSeq: 1, status: FundsOrderStatus.CONFIRMED }],
    });
    const svc = makeAdvanceLegService(mocks);

    const res = await svc.advanceLeg('SWP0001', 1, InternalFundAction.CLEAR, 'ADMIN-1');

    expect(mocks.fundsOrders.advance).toHaveBeenCalledTimes(1);
    const [foId, action, operator] = (mocks.fundsOrders.advance as jest.Mock).mock.calls[0];
    expect(foId).toBe('fo-1-id');
    expect(action).toBe(FundsOrderAction.CLEAR);
    expect(operator).toBe('ADMIN-1');
    expect(res.nextStatus).toBe(FundsOrderStatus.CLEARED);
  });

  it('sequence guard rejects when a prior leg is not CLEARED', async () => {
    const mocks = buildAdvanceLegMocks({
      legs: [
        { legSeq: 1, status: FundsOrderStatus.SUBMITTED },
        { legSeq: 2, status: FundsOrderStatus.CREATED },
      ],
    });
    const svc = makeAdvanceLegService(mocks);

    await expect(
      svc.advanceLeg('SWP0001', 2, InternalFundAction.CLEAR, 'ADMIN-1'),
    ).rejects.toThrow(/SWAP_SEQUENCE_VIOLATION/);

    expect(mocks.fundsOrders.advance).not.toHaveBeenCalled();
  });

  it('rejects when the swap is not PROCESSING', async () => {
    const mocks = buildAdvanceLegMocks({ legs: [{ legSeq: 1, status: FundsOrderStatus.CONFIRMED }] });
    (mocks.swapTransactionsService.findByNoInternal as jest.Mock).mockResolvedValueOnce({
      ...mocks.swapRow,
      status: 'SUCCESS',
    });
    const svc = makeAdvanceLegService(mocks);

    await expect(
      svc.advanceLeg('SWP0001', 1, InternalFundAction.CLEAR, 'ADMIN-1'),
    ).rejects.toThrow(/not in PROCESSING/);
    expect(mocks.fundsOrders.advance).not.toHaveBeenCalled();
  });
});

// ── handleFundsOrderChanged: chaining + SUCCESS ──────────────────────────────

describe('SwapWorkflowService.handleFundsOrderChanged — CONFIRMED chaining', () => {
  const evt = (over: Partial<any>) => ({
    fundsOrderId: 'fo-x',
    fundsOrderNo: 'FO0001',
    parent: { swapTransactionId: 'swap-1' },
    legSeq: 1,
    attempt: 1,
    oldStatus: 'CONFIRMING',
    newStatus: FundsOrderStatus.CONFIRMED,
    ...over,
  });

  it('ignores events not parented to a swap', async () => {
    const mocks = buildAdvanceLegMocks({ legs: [{ legSeq: 1, status: FundsOrderStatus.CLEARED }] });
    const svc = makeAdvanceLegService(mocks);

    await svc.handleFundsOrderChanged(evt({ parent: { withdrawTransactionId: 'wd-1' } }) as any);

    expect(mocks.legAccounting.postLeg).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ignores intermediate hops (SUBMITTED/CONFIRMING) and the CLEARED re-emit', async () => {
    const mocks = buildAdvanceLegMocks({ legs: [{ legSeq: 1, status: FundsOrderStatus.SUBMITTED }] });
    const svc = makeAdvanceLegService(mocks);

    await svc.handleFundsOrderChanged(evt({ newStatus: FundsOrderStatus.SUBMITTED }) as any);
    await svc.handleFundsOrderChanged(evt({ newStatus: FundsOrderStatus.CONFIRMING }) as any);
    // CLEARED re-fires from the workflow's own auto-CLEAR — must be a no-op.
    await svc.handleFundsOrderChanged(evt({ newStatus: FundsOrderStatus.CLEARED }) as any);

    expect(mocks.legAccounting.postLeg).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('mid-leg CONFIRMED posts leg + auto-CLEARs + chains the next leg (no SUCCESS)', async () => {
    const mocks = buildAdvanceLegMocks({ legs: [{ legSeq: 1, status: FundsOrderStatus.CONFIRMED }] });
    const svc = makeAdvanceLegService(mocks);

    await svc.handleFundsOrderChanged(evt({ legSeq: 1, attempt: 1 }) as any);

    // postLeg called for leg1 with attempt=1.
    expect(mocks.legAccounting.postLeg).toHaveBeenCalledTimes(1);
    expect((mocks.legAccounting.postLeg as jest.Mock).mock.calls[0][0].attempt).toBe(1);
    expect((mocks.legAccounting.postLeg as jest.Mock).mock.calls[0][1].legSeq).toBe(1);

    // leg auto-advanced to CLEARED (CONFIRMED → CLEAR).
    expect(mocks.fundsOrders.advance).toHaveBeenCalledTimes(1);
    expect((mocks.fundsOrders.advance as jest.Mock).mock.calls[0][1]).toBe(FundsOrderAction.CLEAR);

    // next leg (leg2) created in CREATED with attempt=1.
    expect(mocks.fundsOrders.create).toHaveBeenCalledTimes(1);
    const createArg = (mocks.fundsOrders.create as jest.Mock).mock.calls[0][0];
    expect(createArg.legSeq).toBe(2);
    expect(createArg.attempt).toBe(1);
    expect(createArg.initialStatus).toBe(FundsOrderStatus.CREATED);

    // SWAP_LEG_POSTED audit; markStatus NOT called; no SUCCESS event.
    const posted = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0]).find((a) => a.action === AuditActions.SWAP_LEG_POSTED);
    expect(posted).toBeDefined();
    expect(posted.metadata.legSeq).toBe(1);
    expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('last-leg (legSeq 4) CONFIRMED posts leg, marks SUCCESS', async () => {
    const mocks = buildAdvanceLegMocks({
      legs: [
        { legSeq: 1, status: FundsOrderStatus.CLEARED },
        { legSeq: 2, status: FundsOrderStatus.CLEARED },
        { legSeq: 3, status: FundsOrderStatus.CLEARED },
        { legSeq: 4, status: FundsOrderStatus.CONFIRMED },
      ],
    });
    const svc = makeAdvanceLegService(mocks);

    await svc.handleFundsOrderChanged(evt({ legSeq: 4, attempt: 1 }) as any);

    // postLeg for leg4.
    expect((mocks.legAccounting.postLeg as jest.Mock).mock.calls[0][1].legSeq).toBe(4);

    // markStatus(SUCCESS).
    expect(mocks.swapTransactionsService.markStatus).toHaveBeenCalledTimes(1);
    expect((mocks.swapTransactionsService.markStatus as jest.Mock).mock.calls[0][1]).toBe('SUCCESS');

    // SWAP_LEG_POSTED + SWAP_SUCCEEDED audits.
    const recorded = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls.map((c) => c[0].action);
    expect(recorded).toContain(AuditActions.SWAP_LEG_POSTED);
    expect(recorded).toContain(AuditActions.SWAP_SUCCEEDED);

    // No next leg created.
    expect(mocks.fundsOrders.create).not.toHaveBeenCalled();

    // C5b: the cross-workflow SWAP_SUCCEEDED event was removed (its only
    // subscriber, FiatSettlementWorkflow, is deleted). Swap still marks
    // SUCCESS + audits SWAP_SUCCEEDED, but emits nothing.
    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('no-op when the swap is already SUCCESS (idempotent replay)', async () => {
    const mocks = buildAdvanceLegMocks({ legs: [{ legSeq: 4, status: FundsOrderStatus.CLEARED }] });
    (mocks.swapTransactionsService.findByIdInternal as jest.Mock).mockResolvedValueOnce({
      ...mocks.swapRow,
      status: 'SUCCESS',
    });
    const svc = makeAdvanceLegService(mocks);

    await svc.handleFundsOrderChanged(evt({ legSeq: 4 }) as any);

    expect(mocks.legAccounting.postLeg).not.toHaveBeenCalled();
    expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();
  });
});

// ── handleFundsOrderChanged: self-heal (Swap-6) ──────────────────────────────

describe('SwapWorkflowService.handleFundsOrderChanged — self-heal', () => {
  const failEvt = (over: Partial<any>) => ({
    fundsOrderId: 'fo-x',
    fundsOrderNo: 'FO0001',
    parent: { swapTransactionId: 'swap-1' },
    legSeq: 1,
    attempt: 1,
    oldStatus: 'SUBMITTED',
    newStatus: FundsOrderStatus.FAILED,
    ...over,
  });

  it('attempt 1 FAILED → voids attempt 1, rebuilds attempt 2, audits RETRIED, swap stays PROCESSING', async () => {
    const mocks = buildAdvanceLegMocks({ legs: [{ legSeq: 1, status: FundsOrderStatus.FAILED, attempt: 1 }] });
    const svc = makeAdvanceLegService(mocks);

    await svc.handleFundsOrderChanged(failEvt({ legSeq: 1, attempt: 1, newStatus: FundsOrderStatus.FAILED }) as any);

    // voidLeg called with ctx carrying attempt=1 (the failed attempt).
    expect(mocks.legAccounting.voidLeg).toHaveBeenCalledTimes(1);
    expect((mocks.legAccounting.voidLeg as jest.Mock).mock.calls[0][0].attempt).toBe(1);
    expect((mocks.legAccounting.voidLeg as jest.Mock).mock.calls[0][1].legSeq).toBe(1);

    // create called with legSeq=1 + attempt=2 for the retry.
    expect(mocks.fundsOrders.create).toHaveBeenCalledTimes(1);
    const createArg = (mocks.fundsOrders.create as jest.Mock).mock.calls[0][0];
    expect(createArg.legSeq).toBe(1);
    expect(createArg.attempt).toBe(2);
    expect(createArg.initialStatus).toBe(FundsOrderStatus.CREATED);

    // initiateLegPending with ctx carrying attempt=2 (the retry).
    expect((mocks.legAccounting.initiateLegPending as jest.Mock).mock.calls[0][0].attempt).toBe(2);

    // SWAP_LEG_RETRIED audit with correct metadata.
    const retried = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0]).find((a) => a.action === AuditActions.SWAP_LEG_RETRIED);
    expect(retried).toBeDefined();
    expect(retried.metadata).toEqual({
      legSeq: 1, failedAttempt: 1, nextAttempt: 2, failedStatus: FundsOrderStatus.FAILED,
    });

    // No STUCK, no markStatus(FAILED), no SUCCESS event.
    expect(mocks.swapTransactionsService.setNeedsReview).not.toHaveBeenCalled();
    const markFailed = (mocks.swapTransactionsService.markStatus as jest.Mock).mock.calls.filter((c) => c[1] === 'FAILED');
    expect(markFailed).toHaveLength(0);
    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();
    // postLeg NOT called on the fail branch.
    expect(mocks.legAccounting.postLeg).not.toHaveBeenCalled();
  });

  it('attempt 3 TIMEOUT → voids attempt 3, sets swap.needsReview, audits STUCK, no retry', async () => {
    const mocks = buildAdvanceLegMocks({ legs: [{ legSeq: 1, status: FundsOrderStatus.TIMEOUT, attempt: 3 }] });
    const svc = makeAdvanceLegService(mocks);

    await svc.handleFundsOrderChanged(failEvt({ legSeq: 1, attempt: 3, newStatus: FundsOrderStatus.TIMEOUT }) as any);

    // voidLeg with attempt=3.
    expect((mocks.legAccounting.voidLeg as jest.Mock).mock.calls[0][0].attempt).toBe(3);

    // STUCK → setNeedsReview(swapId, true).
    expect(mocks.swapTransactionsService.setNeedsReview).toHaveBeenCalledTimes(1);
    expect((mocks.swapTransactionsService.setNeedsReview as jest.Mock).mock.calls[0][0]).toBe('swap-1');
    expect((mocks.swapTransactionsService.setNeedsReview as jest.Mock).mock.calls[0][1]).toBe(true);

    // SWAP_LEG_STUCK audit with correct metadata.
    const stuck = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0]).find((a) => a.action === AuditActions.SWAP_LEG_STUCK);
    expect(stuck).toBeDefined();
    expect(stuck.metadata).toEqual({ legSeq: 1, attempts: 3, lastFailedStatus: FundsOrderStatus.TIMEOUT });

    // No retry, no RETRIED audit, no markStatus(FAILED), no SUCCESS event.
    expect(mocks.fundsOrders.create).not.toHaveBeenCalled();
    const retried = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0]).find((a) => a.action === AuditActions.SWAP_LEG_RETRIED);
    expect(retried).toBeUndefined();
    const markFailed = (mocks.swapTransactionsService.markStatus as jest.Mock).mock.calls.filter((c) => c[1] === 'FAILED');
    expect(markFailed).toHaveLength(0);
    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();
  });
});

// ── resumeLeg (Swap-7) ───────────────────────────────────────────────────────

describe('SwapWorkflowService.resumeLeg', () => {
  it('resumes a failed leg by creating a fresh attempt + clears needsReview', async () => {
    const mocks = buildAdvanceLegMocks({
      legs: [
        { legSeq: 1, status: FundsOrderStatus.CLEARED, attempt: 1 },
        { legSeq: 2, status: FundsOrderStatus.TIMEOUT, attempt: 3 },
      ],
    });
    const svc = makeAdvanceLegService(mocks);

    const result = await svc.resumeLeg('SWP0001', 2, 'ADMIN-OP');
    expect(result).toEqual({ swapId: 'swap-1', legSeq: 2, resumedAttempt: 4 });

    // create called once with leg2 / attempt=4 + resolved wallets.
    expect(mocks.fundsOrders.create).toHaveBeenCalledTimes(1);
    const createArg = (mocks.fundsOrders.create as jest.Mock).mock.calls[0][0];
    expect(createArg.legSeq).toBe(2);
    expect(createArg.attempt).toBe(4);
    expect(createArg.fromWalletId).toBe('w-from');
    expect(createArg.toWalletId).toBe('w-to');

    // initiateLegPending with ctx attempt=4.
    expect((mocks.legAccounting.initiateLegPending as jest.Mock).mock.calls[0][0].attempt).toBe(4);

    // needsReview cleared.
    expect(mocks.swapTransactionsService.setNeedsReview).toHaveBeenCalledWith('swap-1', false, expect.anything());

    // SWAP_LEG_RESUMED audit.
    const resumed = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0]).find((a) => a.action === AuditActions.SWAP_LEG_RESUMED);
    expect(resumed).toBeDefined();
    expect(resumed.metadata).toEqual({ legSeq: 2, resumedAttempt: 4, fromAttempt: 3 });

    // Swap stays PROCESSING — markStatus NOT called.
    expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
  });

  it('rejects when the target leg is NOT a failed leg', async () => {
    const mocks = buildAdvanceLegMocks({
      legs: [
        { legSeq: 1, status: FundsOrderStatus.CLEARED, attempt: 1 },
        { legSeq: 2, status: FundsOrderStatus.CLEARED, attempt: 1 },
      ],
    });
    const svc = makeAdvanceLegService(mocks);

    await expect(svc.resumeLeg('SWP0001', 2, 'ADMIN-OP')).rejects.toThrow(/SWAP_LEG_NOT_STUCK/);
    expect(mocks.fundsOrders.create).not.toHaveBeenCalled();
  });

  it('rejects when no leg exists for the requested legSeq', async () => {
    const mocks = buildAdvanceLegMocks({ legs: [{ legSeq: 1, status: FundsOrderStatus.CLEARED, attempt: 1 }] });
    const svc = makeAdvanceLegService(mocks);

    await expect(svc.resumeLeg('SWP0001', 2, 'ADMIN-OP')).rejects.toThrow(/Leg 2 not found/);
    expect(mocks.fundsOrders.create).not.toHaveBeenCalled();
  });
});

// ── mapLegAction (legacy InternalFundAction → FundsOrderAction) ───────────────

describe('mapLegAction', () => {
  it('collapses SIGN + BROADCAST to SUBMIT (spec §3)', () => {
    expect(mapLegAction(InternalFundAction.SIGN)).toBe(FundsOrderAction.SUBMIT);
    expect(mapLegAction(InternalFundAction.BROADCAST)).toBe(FundsOrderAction.SUBMIT);
    expect(mapLegAction(InternalFundAction.SUBMIT)).toBe(FundsOrderAction.SUBMIT);
  });

  it('maps SEEN_IN_MEMPOOL → OBSERVE_CONFIRMING, CONFIRM → CONFIRM, CLEAR → CLEAR', () => {
    expect(mapLegAction(InternalFundAction.SEEN_IN_MEMPOOL)).toBe(FundsOrderAction.OBSERVE_CONFIRMING);
    expect(mapLegAction(InternalFundAction.CONFIRM)).toBe(FundsOrderAction.CONFIRM);
    expect(mapLegAction(InternalFundAction.CLEAR)).toBe(FundsOrderAction.CLEAR);
  });

  it('maps FAIL → FAIL, TIMEOUT → TIMEOUT', () => {
    expect(mapLegAction(InternalFundAction.FAIL)).toBe(FundsOrderAction.FAIL);
    expect(mapLegAction(InternalFundAction.TIMEOUT)).toBe(FundsOrderAction.TIMEOUT);
  });
});

// ── R1: funds_order.from/toWalletId per leg type ─────────────────────────────

import {
  assertInternalFundLegRules,
  InvalidInternalFundError,
} from './swap-workflow.service';

describe('assertInternalFundLegRules (R1 invariant)', () => {
  it('customer-side leg passes when customer + firm wallets both resolve', () => {
    expect(() =>
      assertInternalFundLegRules(
        { legSeq: 1, fromRole: 'C_DEP', toRole: 'F_OPS' },
        'cust-dep-wallet',
        'firm-ops-wallet',
        'SWP0001',
      ),
    ).not.toThrow();
  });

  it('customer-side leg throws when customer-side wallet is NULL', () => {
    expect(() =>
      assertInternalFundLegRules(
        { legSeq: 3, fromRole: 'F_SET', toRole: 'C_VIBAN' },
        'firm-set-wallet',
        null,
        'SWP0001',
      ),
    ).toThrow(InvalidInternalFundError);
  });

  it('customer-side leg throws when firm-side wallet is NULL', () => {
    expect(() =>
      assertInternalFundLegRules(
        { legSeq: 4, fromRole: 'C_VIBAN', toRole: 'F_FEE' },
        'cust-viban-wallet',
        null,
        'SWP0001',
      ),
    ).toThrow(InvalidInternalFundError);
  });

  it('customer-side leg throws when BOTH wallets are NULL (the R1 baseline bug)', () => {
    expect(() =>
      assertInternalFundLegRules(
        { legSeq: 1, fromRole: 'C_DEP', toRole: 'F_OPS' },
        null,
        null,
        'SWP0001',
      ),
    ).toThrow(InvalidInternalFundError);
  });

  it('firm-only leg passes when both firm wallets resolve', () => {
    expect(() =>
      assertInternalFundLegRules(
        { legSeq: 2, fromRole: 'F_OPS', toRole: 'F_SET' },
        'firm-ops-wallet',
        'firm-set-wallet',
        'SWP0001',
      ),
    ).not.toThrow();
  });

  it('firm-only leg throws when either firm wallet is NULL', () => {
    expect(() =>
      assertInternalFundLegRules(
        { legSeq: 2, fromRole: 'F_OPS', toRole: 'F_SET' },
        'firm-ops-wallet',
        null,
        'SWP0001',
      ),
    ).toThrow(InvalidInternalFundError);

    expect(() =>
      assertInternalFundLegRules(
        { legSeq: 2, fromRole: 'F_OPS', toRole: 'F_SET' },
        null,
        'firm-set-wallet',
        'SWP0001',
      ),
    ).toThrow(InvalidInternalFundError);
  });
});

describe('SwapWorkflowService — R1: create receives resolved wallets', () => {
  it('executeSwap leg1: passes resolved fromWalletId/toWalletId to funds_order.create', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);

    await service.executeSwap('cust-1', 'q-1');

    expect((mocks as any).legAccounting.resolveLegWallets).toHaveBeenCalledTimes(1);
    const createLegArg = ((mocks as any).fundsOrders.create as jest.Mock).mock.calls[0][0];
    expect(createLegArg.fromWalletId).toBe('w-from');
    expect(createLegArg.toWalletId).toBe('w-to');
  });

  it('executeSwap throws InvalidInternalFundError when customer-side wallet does not resolve', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);
    ((mocks as any).legAccounting.resolveLegWallets as jest.Mock).mockResolvedValueOnce({
      fromWalletId: null,
      toWalletId: 'firm-ops-wallet',
    });

    await expect(service.executeSwap('cust-1', 'q-1')).rejects.toBeInstanceOf(
      InvalidInternalFundError,
    );

    // create must NOT be called when R1 assert fails.
    expect((mocks as any).fundsOrders.create).not.toHaveBeenCalled();
  });
});
