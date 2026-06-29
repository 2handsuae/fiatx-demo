/**
 * swap-workflow.service.spec.ts
 *
 * SwapWorkflowService owns the entire swap journey: executeSwap (leg1 build),
 * advanceLeg (post + chain + SUCCESS / self-heal), resumeLeg (recovery), with
 * sell-first sequence guard. The legacy SwapSettlementService is gone.
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

  return { accountingService, swapQuoteService, swapTransactionsService, auditLogsService, eventEmitter, onboardingService, prisma };
}

function makeService(mocks: ReturnType<typeof buildMocks>) {
  // Swap-9 cut-over: executeSwap now drives leg1-only via these two deps.
  const stubLegAccounting: any = {
    ctxFromSwap: jest.fn(),
    initiateLegPending: jest.fn(() => Promise.resolve()),
    postLeg: jest.fn(() => Promise.resolve()),
    voidLeg: jest.fn(() => Promise.resolve()),
    // R1: workflow now resolves the leg's from/to wallets before createSwapLeg.
    // Default stub returns both filled — tests asserting invariant violations
    // override per-call via mockResolvedValueOnce.
    resolveLegWallets: jest.fn(() =>
      Promise.resolve({ fromWalletId: 'w-from', toWalletId: 'w-to' }),
    ),
  };
  const stubFundsFlow: any = {
    createSwapLeg: jest.fn(() => Promise.resolve({ id: 'leg-1' })),
    transitionSwapLeg: jest.fn(() => Promise.resolve({ nextStatus: 'SUBMITTING' })),
  };
  // expose so tests can assert on them
  (mocks as any).legAccounting = stubLegAccounting;
  (mocks as any).fundsFlow = stubFundsFlow;
  return new SwapWorkflowService(
    mocks.prisma,
    mocks.onboardingService as any,
    mocks.swapQuoteService as any,
    mocks.swapTransactionsService as any,
    mocks.accountingService as any,
    mocks.auditLogsService as any,
    mocks.eventEmitter as any,
    stubLegAccounting,
    stubFundsFlow,
  );
}

// ── Core behavior ────────────────────────────────────────────────────────────

describe('SwapWorkflowService — Task 5: PROCESSING + delegation', () => {
  it('creates swap with status PROCESSING (no atomic TB legs, no SUCCESS)', async () => {
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

    // Swap-9 cut-over: leg1-only progressive create (no more settlement service).
    expect((mocks as any).fundsFlow.createSwapLeg).toHaveBeenCalledTimes(1);
    const createLegArg = ((mocks as any).fundsFlow.createSwapLeg as jest.Mock).mock.calls[0][0];
    expect(createLegArg.legSeq).toBe(1);
    expect(createLegArg.legAttempt).toBe(1);
    expect((mocks as any).legAccounting.initiateLegPending).toHaveBeenCalledTimes(1);
    expect((mocks as any).fundsFlow.transitionSwapLeg).toHaveBeenCalledTimes(1);

    // No SWAP_SUCCEEDED domain event at executeSwap return (swap is still PROCESSING)
    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('passes correct SwapSettleCtx (leg1 amount + asset) — CASE A (USDT→AED, fromIsFiat=false)', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);

    await service.executeSwap('cust-1', 'q-1');

    // CASE A: USDT (CRYPTO) → AED (FIAT); fromIsFiat=false, so leg1 is "to" side (FIAT receive)
    // per the sell-first plan locked in Swap-8. Verify createSwapLeg's assetId/amount.
    const createLegArg = ((mocks as any).fundsFlow.createSwapLeg as jest.Mock).mock.calls[0][0];
    expect(createLegArg.swapTransactionId).toBe('swap-1');
    expect(createLegArg.legSeq).toBe(1);
    expect(createLegArg.legAttempt).toBe(1);
    // initiateLegPending called with leg1 ctx (attempt=1) — verify ctx fields propagate
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

  it('passes correct SwapSettleCtx (leg1 amount + asset) — CASE B (AED→USDT, fromIsFiat=true)', async () => {
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

// ── advanceLeg tests (Swap-5) ────────────────────────────────────────────────

import { InternalFundAction, InternalFundStatus } from '../../funds-layer/dto/internal-fund.dto';
import { AuditActions } from '../../audit-logging/constants/audit-actions.constant';
import { DomainEventNames } from '../../../common/events/domain-events.constants';

// Build mocks specifically for advanceLeg path (extends the executeSwap mocks).
function buildAdvanceLegMocks(opts: {
  swapNo?: string;
  fromIsFiat?: boolean;
  legs: Array<{ legSeq: number; status: string; id?: string; attempt?: number }>;
}) {
  const swapNo = opts.swapNo ?? 'SWP0001';
  const fromIsFiat = opts.fromIsFiat ?? false;

  // Snapshot of active legs we'll mutate as the workflow chains the next leg.
  const legState = opts.legs.map((l) => ({
    id: l.id ?? `leg-${l.legSeq}-id`,
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
    activeLegsBySeq: jest.fn(() => Promise.resolve(legState.slice())),
    markStatus: jest.fn(() => Promise.resolve()),
    recomputeProjections: jest.fn(() => Promise.resolve()),
    create: jest.fn(),
    findOne: jest.fn(),
  };

  const fundsFlow = {
    createSwapLeg: jest.fn((input: any) => {
      // Mirror the side-effect: a new leg row gets created and is then findable.
      const newLeg = {
        id: `leg-${input.legSeq}-id`,
        legSeq: input.legSeq,
        attempt: input.legAttempt ?? 1,
        status: 'CREATED',
        swapTransactionId: 'swap-1',
      };
      legState.push(newLeg);
      return Promise.resolve(newLeg);
    }),
    transitionSwapLeg: jest.fn(() =>
      Promise.resolve({ leg: {}, prevStatus: 'CREATED', nextStatus: InternalFundStatus.CLEAR }),
    ),
    // Swap-6: canonical entrypoint for the STUCK branch — workflow no longer
    // writes InternalFund directly (CLAUDE.md rule 5).
    markLegNeedsReview: jest.fn(() => Promise.resolve({})),
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
    // R1: workflow now resolves the leg's from/to wallets before createSwapLeg.
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
  const swapQuoteService = { getActiveQuoteOrThrow: jest.fn(), consumeQuote: jest.fn() };
  const accountingService = {
    resolveTbAccountId: jest.fn(),
    executePendingTransfer: jest.fn(),
    postPendingTransfer: jest.fn(),
    executeTransfer: jest.fn(),
  };
  const txClient: any = {
    internalFund: {
      findFirst: jest.fn(({ where }: any) => {
        // Match against the in-memory legState (covers newly chained legs)
        const found = legState.find(
          (l) =>
            l.swapTransactionId === where.swapTransactionId &&
            l.legSeq === where.legSeq &&
            (where.attempt === undefined || l.attempt === where.attempt),
        );
        return Promise.resolve(found ?? null);
      }),
    },
  };

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
    swapQuoteService,
    swapTransactionsService,
    accountingService,
    auditLogsService,
    eventEmitter,
    fundsFlow,
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
    mocks.fundsFlow as any,
  );
}

describe('SwapWorkflowService.advanceLeg (Swap-5)', () => {
  it('mid-leg CLEAR posts leg + chains next leg (no SUCCESS)', async () => {
    // leg1 is currently CONFIRMED (mid-life, ready to CLEAR). legs 2/3/4 don't exist yet.
    const mocks = buildAdvanceLegMocks({
      legs: [{ legSeq: 1, status: InternalFundStatus.CONFIRMED }],
    });
    const svc = makeAdvanceLegService(mocks);

    await svc.advanceLeg('SWP0001', 1, InternalFundAction.CLEAR, 'ADMIN-1');

    // leg1 already non-CREATED → no initiate for leg1; only the chained leg2 gets initiated.
    expect(mocks.legAccounting.initiateLegPending).toHaveBeenCalledTimes(1);
    const initiatedLegSeqs = (mocks.legAccounting.initiateLegPending as jest.Mock).mock.calls.map(
      (c) => c[1].legSeq,
    );
    expect(initiatedLegSeqs).toContain(2);

    // postLeg called for leg1 spec
    expect(mocks.legAccounting.postLeg).toHaveBeenCalledTimes(1);
    expect((mocks.legAccounting.postLeg as jest.Mock).mock.calls[0][1].legSeq).toBe(1);

    // createSwapLeg called for leg2 with attempt=1
    expect(mocks.fundsFlow.createSwapLeg).toHaveBeenCalledTimes(1);
    const createArg = (mocks.fundsFlow.createSwapLeg as jest.Mock).mock.calls[0][0];
    expect(createArg.legSeq).toBe(2);
    expect(createArg.legAttempt).toBe(1);
    expect(createArg.swapTransactionId).toBe('swap-1');

    // transitionSwapLeg called twice (leg1 → CLEAR, then leg2 start)
    expect(mocks.fundsFlow.transitionSwapLeg).toHaveBeenCalledTimes(2);

    // Audit SWAP_LEG_POSTED recorded
    const posted = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((a) => a.action === AuditActions.SWAP_LEG_POSTED);
    expect(posted).toBeDefined();
    expect(posted.metadata.legSeq).toBe(1);

    // markStatus(SUCCESS) NOT called
    expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();

    // recomputeProjections called
    expect(mocks.swapTransactionsService.recomputeProjections).toHaveBeenCalledTimes(1);

    // No SUCCESS event
    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('last-leg CLEAR posts leg, marks SUCCESS, emits SWAP_SUCCEEDED', async () => {
    // All 4 legs exist; leg1-3 are CLEAR, leg4 is CONFIRMED ready to CLEAR.
    const mocks = buildAdvanceLegMocks({
      legs: [
        { legSeq: 1, status: InternalFundStatus.CLEAR },
        { legSeq: 2, status: InternalFundStatus.CLEAR },
        { legSeq: 3, status: InternalFundStatus.CLEAR },
        { legSeq: 4, status: InternalFundStatus.CONFIRMED },
      ],
    });
    const svc = makeAdvanceLegService(mocks);

    await svc.advanceLeg('SWP0001', 4, InternalFundAction.CLEAR, 'ADMIN-1');

    // postLeg called for leg4 spec
    expect(mocks.legAccounting.postLeg).toHaveBeenCalledTimes(1);
    expect((mocks.legAccounting.postLeg as jest.Mock).mock.calls[0][1].legSeq).toBe(4);

    // markStatus(SUCCESS) called
    expect(mocks.swapTransactionsService.markStatus).toHaveBeenCalledTimes(1);
    expect((mocks.swapTransactionsService.markStatus as jest.Mock).mock.calls[0][1]).toBe('SUCCESS');

    // Both SWAP_LEG_POSTED + SWAP_SUCCEEDED audits recorded
    const recorded = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls.map(
      (c) => c[0].action,
    );
    expect(recorded).toContain(AuditActions.SWAP_LEG_POSTED);
    expect(recorded).toContain(AuditActions.SWAP_SUCCEEDED);

    // createSwapLeg NOT called (no next leg after 4)
    expect(mocks.fundsFlow.createSwapLeg).not.toHaveBeenCalled();

    // Post-commit SWAP_SUCCEEDED event emitted
    expect(mocks.eventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(mocks.eventEmitter.emit).toHaveBeenCalledWith(
      DomainEventNames.SWAP_SUCCEEDED,
      { swapId: 'swap-1', swapNo: 'SWP0001', ownerId: 'cust-1' },
    );
  });

  it('sequence guard rejects when prior leg is not CLEAR', async () => {
    // leg1 is still SIGNING (not CLEAR); attempt to advance leg2 must fail.
    const mocks = buildAdvanceLegMocks({
      legs: [
        { legSeq: 1, status: InternalFundStatus.SIGNING },
        { legSeq: 2, status: InternalFundStatus.CREATED },
      ],
    });
    const svc = makeAdvanceLegService(mocks);

    await expect(
      svc.advanceLeg('SWP0001', 2, InternalFundAction.CLEAR, 'ADMIN-1'),
    ).rejects.toThrow(/SWAP_SEQUENCE_VIOLATION/);

    // Sanity: no accounting side-effects when the guard trips
    expect(mocks.legAccounting.postLeg).not.toHaveBeenCalled();
    expect(mocks.legAccounting.initiateLegPending).not.toHaveBeenCalled();
    expect(mocks.fundsFlow.transitionSwapLeg).not.toHaveBeenCalled();
    expect(mocks.fundsFlow.createSwapLeg).not.toHaveBeenCalled();
  });

});

// ── advanceLeg self-heal tests (Swap-6) ──────────────────────────────────────

describe('SwapWorkflowService.advanceLeg self-heal (Swap-6)', () => {
  it('attempt 1 fails → voids attempt 1, creates attempt 2, initiates+starts, audits RETRIED, swap stays PROCESSING', async () => {
    // leg1 is BROADCASTED on attempt 1; transition will return FAILED.
    const mocks = buildAdvanceLegMocks({
      legs: [{ legSeq: 1, status: InternalFundStatus.BROADCASTED, attempt: 1 }],
    });
    (mocks.fundsFlow.transitionSwapLeg as jest.Mock).mockResolvedValueOnce({
      leg: {},
      prevStatus: InternalFundStatus.BROADCASTED,
      nextStatus: InternalFundStatus.FAILED,
    });
    // Pin the new attempt-2 leg row that createSwapLeg returns.
    (mocks.fundsFlow.createSwapLeg as jest.Mock).mockResolvedValueOnce({
      id: 'leg-1-attempt-2-id',
      legSeq: 1,
      attempt: 2,
      status: 'CREATED',
      swapTransactionId: 'swap-1',
    });
    const svc = makeAdvanceLegService(mocks);

    // Resolves normally — self-heal commits Prisma + TB together.
    const result = await svc.advanceLeg('SWP0001', 1, InternalFundAction.FAIL, 'ADMIN-1');
    expect(result.nextStatus).toBe(InternalFundStatus.FAILED);

    // voidLeg called with ctx carrying attempt=1 (the failed attempt).
    expect(mocks.legAccounting.voidLeg).toHaveBeenCalledTimes(1);
    const voidCall = (mocks.legAccounting.voidLeg as jest.Mock).mock.calls[0];
    expect(voidCall[0].attempt).toBe(1);
    expect(voidCall[1].legSeq).toBe(1);

    // createSwapLeg called with legSeq=1 + legAttempt=2 for the retry.
    expect(mocks.fundsFlow.createSwapLeg).toHaveBeenCalledTimes(1);
    const createArg = (mocks.fundsFlow.createSwapLeg as jest.Mock).mock.calls[0][0];
    expect(createArg.swapTransactionId).toBe('swap-1');
    expect(createArg.legSeq).toBe(1);
    expect(createArg.legAttempt).toBe(2);

    // initiateLegPending called with ctx carrying attempt=2 (the retry).
    expect(mocks.legAccounting.initiateLegPending).toHaveBeenCalledTimes(1);
    const initCall = (mocks.legAccounting.initiateLegPending as jest.Mock).mock.calls[0];
    expect(initCall[0].attempt).toBe(2);
    expect(initCall[1].legSeq).toBe(1);

    // transitionSwapLeg called twice: original FAIL (mocked) + retry start on the new leg row.
    expect(mocks.fundsFlow.transitionSwapLeg).toHaveBeenCalledTimes(2);
    const startCall = (mocks.fundsFlow.transitionSwapLeg as jest.Mock).mock.calls[1];
    expect(startCall[0]).toBe('leg-1-attempt-2-id');
    // legStartAction: CRYPTO 'from' side (USDT) + side='from' on leg1 → SIGN.
    expect(startCall[1]).toBe(InternalFundAction.SIGN);

    // Audit SWAP_LEG_RETRIED with correct metadata.
    const retried = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((a) => a.action === AuditActions.SWAP_LEG_RETRIED);
    expect(retried).toBeDefined();
    expect(retried.metadata).toEqual({
      legSeq: 1,
      failedAttempt: 1,
      nextAttempt: 2,
      failedStatus: InternalFundStatus.FAILED,
    });

    // No SWAP_FAILED audit, no markStatus('FAILED'), no STUCK call.
    const failedAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((a) => a.action === AuditActions.SWAP_FAILED);
    expect(failedAudit).toBeUndefined();
    const markStatusFailedCalls = (mocks.swapTransactionsService.markStatus as jest.Mock).mock.calls
      .filter((c) => c[1] === 'FAILED');
    expect(markStatusFailedCalls).toHaveLength(0);
    expect(mocks.fundsFlow.markLegNeedsReview).not.toHaveBeenCalled();

    // recomputeProjections + no SUCCESS event.
    expect(mocks.swapTransactionsService.recomputeProjections).toHaveBeenCalledTimes(1);
    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();

    // postLeg NOT called (fail branch).
    expect(mocks.legAccounting.postLeg).not.toHaveBeenCalled();
  });

  it('attempt 3 fails → voids attempt 3, delegates to fundsFlow.markLegNeedsReview, audits STUCK, swap stays PROCESSING', async () => {
    // leg1 is BROADCASTED on attempt 3; transition will return TIMEOUT.
    const mocks = buildAdvanceLegMocks({
      legs: [{ legSeq: 1, status: InternalFundStatus.BROADCASTED, attempt: 3 }],
    });
    (mocks.fundsFlow.transitionSwapLeg as jest.Mock).mockResolvedValueOnce({
      leg: {},
      prevStatus: InternalFundStatus.BROADCASTED,
      nextStatus: InternalFundStatus.TIMEOUT,
    });
    const svc = makeAdvanceLegService(mocks);

    const result = await svc.advanceLeg('SWP0001', 1, InternalFundAction.FAIL, 'ADMIN-1');
    expect(result.nextStatus).toBe(InternalFundStatus.TIMEOUT);

    // voidLeg called with ctx carrying attempt=3.
    expect(mocks.legAccounting.voidLeg).toHaveBeenCalledTimes(1);
    expect((mocks.legAccounting.voidLeg as jest.Mock).mock.calls[0][0].attempt).toBe(3);

    // STUCK branch delegates to FundsFlowService.markLegNeedsReview(target.id, 3, 'SYSTEM', client).
    expect(mocks.fundsFlow.markLegNeedsReview).toHaveBeenCalledTimes(1);
    const stuckCall = (mocks.fundsFlow.markLegNeedsReview as jest.Mock).mock.calls[0];
    expect(stuckCall[0]).toBe('leg-1-id');
    expect(stuckCall[1]).toBe(3);
    expect(stuckCall[2]).toBe('SYSTEM');
    expect(stuckCall[3]).toBe(mocks.txClient);

    // Audit SWAP_LEG_STUCK with correct metadata.
    const stuck = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((a) => a.action === AuditActions.SWAP_LEG_STUCK);
    expect(stuck).toBeDefined();
    expect(stuck.metadata).toEqual({
      legSeq: 1,
      attempts: 3,
      lastFailedStatus: InternalFundStatus.TIMEOUT,
    });

    // createSwapLeg NOT called — no retry on attempt 3.
    expect(mocks.fundsFlow.createSwapLeg).not.toHaveBeenCalled();

    // No SWAP_FAILED audit, no markStatus('FAILED'), no SWAP_LEG_RETRIED.
    const failedAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((a) => a.action === AuditActions.SWAP_FAILED);
    expect(failedAudit).toBeUndefined();
    const retriedAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((a) => a.action === AuditActions.SWAP_LEG_RETRIED);
    expect(retriedAudit).toBeUndefined();
    const markStatusFailedCalls = (mocks.swapTransactionsService.markStatus as jest.Mock).mock.calls
      .filter((c) => c[1] === 'FAILED');
    expect(markStatusFailedCalls).toHaveLength(0);

    // recomputeProjections + no SUCCESS event.
    expect(mocks.swapTransactionsService.recomputeProjections).toHaveBeenCalledTimes(1);
    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();

    // postLeg NOT called.
    expect(mocks.legAccounting.postLeg).not.toHaveBeenCalled();

    // transitionSwapLeg called exactly once (the original FAIL, no retry start).
    expect(mocks.fundsFlow.transitionSwapLeg).toHaveBeenCalledTimes(1);
  });
});

// ── resumeLeg tests (Swap-7) ─────────────────────────────────────────────────

describe('SwapWorkflowService.resumeLeg (Swap-7)', () => {
  it('resumes a stuck leg by creating a fresh attempt', async () => {
    // leg1 CLEAR, leg2 NEEDS_REVIEW on attempt 3 → resume should create attempt 4.
    const mocks = buildAdvanceLegMocks({
      legs: [
        { legSeq: 1, status: InternalFundStatus.CLEAR, attempt: 1 },
        { legSeq: 2, status: InternalFundStatus.NEEDS_REVIEW, attempt: 3 },
      ],
    });
    (mocks.fundsFlow.createSwapLeg as jest.Mock).mockResolvedValueOnce({
      id: 'leg-2-attempt-4-id',
      legSeq: 2,
      attempt: 4,
      status: 'CREATED',
      swapTransactionId: 'swap-1',
    });
    const svc = makeAdvanceLegService(mocks);

    const result = await svc.resumeLeg('SWP0001', 2, 'ADMIN-OP');
    expect(result).toEqual({ swapId: 'swap-1', legSeq: 2, resumedAttempt: 4 });

    // createSwapLeg called once with leg2 / legAttempt=4.
    expect(mocks.fundsFlow.createSwapLeg).toHaveBeenCalledTimes(1);
    const createArg = (mocks.fundsFlow.createSwapLeg as jest.Mock).mock.calls[0][0];
    expect(createArg.swapTransactionId).toBe('swap-1');
    expect(createArg.legSeq).toBe(2);
    expect(createArg.legAttempt).toBe(4);
    // R1: workflow now populates fromWalletId/toWalletId from resolveLegWallets
    // (stub returns 'w-from' / 'w-to') instead of the old null/null defaults.
    expect(createArg.fromWalletId).toBe('w-from');
    expect(createArg.toWalletId).toBe('w-to');
    expect((mocks.fundsFlow.createSwapLeg as jest.Mock).mock.calls[0][1]).toBe('ADMIN-OP');

    // initiateLegPending called with ctx carrying attempt=4 and leg2 spec.
    expect(mocks.legAccounting.initiateLegPending).toHaveBeenCalledTimes(1);
    const initCall = (mocks.legAccounting.initiateLegPending as jest.Mock).mock.calls[0];
    expect(initCall[0].attempt).toBe(4);
    expect(initCall[1].legSeq).toBe(2);

    // transitionSwapLeg called on the new leg id, with leg2 start action, operator ADMIN-OP, tx client.
    expect(mocks.fundsFlow.transitionSwapLeg).toHaveBeenCalledTimes(1);
    const transCall = (mocks.fundsFlow.transitionSwapLeg as jest.Mock).mock.calls[0];
    expect(transCall[0]).toBe('leg-2-attempt-4-id');
    expect(transCall[2]).toBe('ADMIN-OP');
    expect(transCall[3]).toBe(mocks.txClient);

    // Audit SWAP_LEG_RESUMED with correct metadata.
    const resumed = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((a) => a.action === AuditActions.SWAP_LEG_RESUMED);
    expect(resumed).toBeDefined();
    expect(resumed.metadata).toEqual({ legSeq: 2, resumedAttempt: 4, fromAttempt: 3 });

    // recomputeProjections called.
    expect(mocks.swapTransactionsService.recomputeProjections).toHaveBeenCalledTimes(1);

    // Swap stays PROCESSING — markStatus NOT called.
    expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
  });

  it('rejects when target leg is NOT NEEDS_REVIEW', async () => {
    // leg2 is CLEAR — not stuck — should reject.
    const mocks = buildAdvanceLegMocks({
      legs: [
        { legSeq: 1, status: InternalFundStatus.CLEAR, attempt: 1 },
        { legSeq: 2, status: InternalFundStatus.CLEAR, attempt: 1 },
      ],
    });
    const svc = makeAdvanceLegService(mocks);

    await expect(svc.resumeLeg('SWP0001', 2, 'ADMIN-OP')).rejects.toThrow(/SWAP_LEG_NOT_STUCK/);

    // No side effects.
    expect(mocks.fundsFlow.createSwapLeg).not.toHaveBeenCalled();
    expect(mocks.legAccounting.initiateLegPending).not.toHaveBeenCalled();
    expect(mocks.fundsFlow.transitionSwapLeg).not.toHaveBeenCalled();
    const resumed = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((a) => a.action === AuditActions.SWAP_LEG_RESUMED);
    expect(resumed).toBeUndefined();
    expect(mocks.swapTransactionsService.recomputeProjections).not.toHaveBeenCalled();
  });

  it('rejects when no leg exists for the requested legSeq', async () => {
    // Only legSeq=1 is active — request for legSeq=2 must 404.
    const mocks = buildAdvanceLegMocks({
      legs: [{ legSeq: 1, status: InternalFundStatus.CLEAR, attempt: 1 }],
    });
    const svc = makeAdvanceLegService(mocks);

    await expect(svc.resumeLeg('SWP0001', 2, 'ADMIN-OP')).rejects.toThrow(/Leg 2 not found/);

    // No side effects.
    expect(mocks.fundsFlow.createSwapLeg).not.toHaveBeenCalled();
    expect(mocks.legAccounting.initiateLegPending).not.toHaveBeenCalled();
    expect(mocks.fundsFlow.transitionSwapLeg).not.toHaveBeenCalled();
    const resumed = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((a) => a.action === AuditActions.SWAP_LEG_RESUMED);
    expect(resumed).toBeUndefined();
    expect(mocks.swapTransactionsService.recomputeProjections).not.toHaveBeenCalled();
  });
});

// ── sell-first invariant tests (Swap-8) ──────────────────────────────────────
//
// Documents the BUSINESS RULE (not just the generic sequence guard from Swap-5):
// the customer SELL leg (leg1) must clear before any other leg may proceed —
// so the company has the customer's funds before paying out. This is the
// structural guarantee behind self-heal: a buy leg failure can never leave the
// customer's money missing because the sell leg already CLEARed.

describe('SwapWorkflowService.advanceLeg — sell-first invariant (Swap-8)', () => {
  it('buy leg (leg3) cannot advance while sell leg (leg1) is still CREATED', async () => {
    const mocks = buildAdvanceLegMocks({
      legs: [
        { legSeq: 1, attempt: 1, status: InternalFundStatus.CREATED },
        { legSeq: 3, attempt: 1, status: InternalFundStatus.CREATED },
      ],
    });
    const svc = makeAdvanceLegService(mocks);

    await expect(
      svc.advanceLeg('SWP0001', 3, InternalFundAction.CLEAR, 'ADMIN-OP'),
    ).rejects.toThrow(/SWAP_SEQUENCE_VIOLATION/);

    // No side effects when sell-first guard trips.
    expect(mocks.legAccounting.voidLeg).not.toHaveBeenCalled();
    expect(mocks.legAccounting.postLeg).not.toHaveBeenCalled();
    expect(mocks.legAccounting.initiateLegPending).not.toHaveBeenCalled();
    expect(mocks.fundsFlow.createSwapLeg).not.toHaveBeenCalled();
    expect(mocks.fundsFlow.transitionSwapLeg).not.toHaveBeenCalled();
    expect(mocks.auditLogsService.recordSystem).not.toHaveBeenCalled();
    expect(mocks.auditLogsService.recordByActor).not.toHaveBeenCalled();
    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('buy leg (leg3) cannot advance while sell leg (leg1) is NEEDS_REVIEW (stuck)', async () => {
    // Critical safety case: even when sell leg is STUCK on attempt 3, the buy leg
    // is BLOCKED — so the company never pays out before receiving customer funds.
    const mocks = buildAdvanceLegMocks({
      legs: [
        { legSeq: 1, attempt: 3, status: InternalFundStatus.NEEDS_REVIEW },
        { legSeq: 3, attempt: 1, status: InternalFundStatus.CREATED },
      ],
    });
    const svc = makeAdvanceLegService(mocks);

    await expect(
      svc.advanceLeg('SWP0001', 3, InternalFundAction.CLEAR, 'ADMIN-OP'),
    ).rejects.toThrow(/SWAP_SEQUENCE_VIOLATION/);

    // No side effects.
    expect(mocks.legAccounting.voidLeg).not.toHaveBeenCalled();
    expect(mocks.legAccounting.postLeg).not.toHaveBeenCalled();
    expect(mocks.legAccounting.initiateLegPending).not.toHaveBeenCalled();
    expect(mocks.fundsFlow.createSwapLeg).not.toHaveBeenCalled();
    expect(mocks.fundsFlow.transitionSwapLeg).not.toHaveBeenCalled();
    expect(mocks.auditLogsService.recordSystem).not.toHaveBeenCalled();
    expect(mocks.auditLogsService.recordByActor).not.toHaveBeenCalled();
    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('buy leg (leg3) may advance once sell leg (leg1) is CLEAR', async () => {
    // Both prior legs CLEAR → guard PASSES, leg3 posts normally.
    const mocks = buildAdvanceLegMocks({
      legs: [
        { legSeq: 1, attempt: 1, status: InternalFundStatus.CLEAR },
        { legSeq: 2, attempt: 1, status: InternalFundStatus.CLEAR },
        { legSeq: 3, attempt: 1, status: InternalFundStatus.CREATED },
      ],
    });
    const svc = makeAdvanceLegService(mocks);

    await expect(
      svc.advanceLeg('SWP0001', 3, InternalFundAction.CLEAR, 'ADMIN-OP'),
    ).resolves.toBeDefined();

    // postLeg called for leg3 spec.
    expect(mocks.legAccounting.postLeg).toHaveBeenCalledTimes(1);
    expect((mocks.legAccounting.postLeg as jest.Mock).mock.calls[0][1].legSeq).toBe(3);

    // SWAP_LEG_POSTED audit recorded.
    const posted = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((a) => a.action === AuditActions.SWAP_LEG_POSTED);
    expect(posted).toBeDefined();
    expect(posted.metadata.legSeq).toBe(3);
  });
});

// ── R1: InternalFund.from/toWalletId per leg type (Task 4) ───────────────────
//
// SwapWorkflow must populate InternalFund.fromWalletId / toWalletId per leg
// based on the leg spec's fromRole / toRole (resolved by SwapLegAccounting
// against the leg's asset). Customer-side leg requires the customer wallet to
// resolve; firm-only leg requires both firm wallets. Missing wallets throw
// InvalidInternalFundError instead of persisting {from:NULL, to:NULL} rows.

import {
  assertInternalFundLegRules,
  InvalidInternalFundError,
} from './swap-workflow.service';

describe('assertInternalFundLegRules (R1 invariant)', () => {
  it('customer-side leg passes when customer + firm wallets both resolve', () => {
    // Leg1 of CRYPTO→FIAT: C_DEP → F_OPS (customer-side, side='from').
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
    // SWAP_BUY_CLIENT (leg3 of CRYPTO→FIAT): F_SET → C_VIBAN, to-side customer.
    // If customer C_VIBAN doesn't resolve, the leg is unsafe to persist.
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
    // SWAP_FEE_CLIENT (leg4): C_VIBAN → F_FEE. If F_FEE missing, throw.
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
    // This is the bug being fixed: SWAP IFs were persisted with both NULL.
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
    // Leg2 of CRYPTO→FIAT: F_OPS → F_SET (firm-only, side='to').
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

describe('SwapWorkflowService — R1: createSwapLeg receives resolved wallets', () => {
  it('executeSwap leg1: passes resolved fromWalletId/toWalletId to createSwapLeg', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);

    await service.executeSwap('cust-1', 'q-1');

    expect((mocks as any).legAccounting.resolveLegWallets).toHaveBeenCalledTimes(1);
    const createLegArg = ((mocks as any).fundsFlow.createSwapLeg as jest.Mock).mock.calls[0][0];
    expect(createLegArg.fromWalletId).toBe('w-from');
    expect(createLegArg.toWalletId).toBe('w-to');
  });

  it('executeSwap throws InvalidInternalFundError when customer-side wallet does not resolve', async () => {
    const mocks = buildMocks(makeQuote());
    // CRYPTO→FIAT leg1 spec = C_DEP→F_OPS, side='from'. Customer-side is fromRole=C_DEP.
    (mocks as any).legAccounting = (mocks as any).legAccounting;
    // We need to override the stub before makeService captures it.
    const service = makeService(mocks);
    ((mocks as any).legAccounting.resolveLegWallets as jest.Mock).mockResolvedValueOnce({
      fromWalletId: null,
      toWalletId: 'firm-ops-wallet',
    });

    await expect(service.executeSwap('cust-1', 'q-1')).rejects.toBeInstanceOf(
      InvalidInternalFundError,
    );

    // createSwapLeg must NOT be called when R1 assert fails.
    expect((mocks as any).fundsFlow.createSwapLeg).not.toHaveBeenCalled();
  });

  it('advanceLeg chained leg (createAndStartLeg): also resolves wallets + asserts R1', async () => {
    // leg1 currently CONFIRMED → on CLEAR it posts + creates leg2.
    const mocks = buildAdvanceLegMocks({
      legs: [{ legSeq: 1, status: InternalFundStatus.CONFIRMED }],
    });
    const svc = makeAdvanceLegService(mocks);

    await svc.advanceLeg('SWP0001', 1, InternalFundAction.CLEAR, 'ADMIN-1');

    // resolveLegWallets called for the chained leg2 (createAndStartLeg path).
    expect(mocks.legAccounting.resolveLegWallets).toHaveBeenCalledTimes(1);
    expect((mocks.legAccounting.resolveLegWallets as jest.Mock).mock.calls[0][0].legSeq).toBe(2);

    const createLegArg = (mocks.fundsFlow.createSwapLeg as jest.Mock).mock.calls[0][0];
    expect(createLegArg.fromWalletId).toBe('w-from');
    expect(createLegArg.toWalletId).toBe('w-to');
  });
});
