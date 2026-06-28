/**
 * swap-workflow.service.spec.ts
 *
 * Task 5: executeSwap creates a PROCESSING swap and delegates physical leg
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
    findOne: jest.fn(() => Promise.resolve({ id: 'swap-1', swapNo: 'SWP0001', status: 'PROCESSING' })),
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
  // Stub the two Swap-5 deps; Swap-4 tests exercise executeSwap which doesn't touch them.
  const stubLegAccounting: any = {
    ctxFromSwap: jest.fn(),
    initiateLegPending: jest.fn(),
    postLeg: jest.fn(),
    voidLeg: jest.fn(),
  };
  const stubFundsFlow: any = {
    createSwapLeg: jest.fn(),
    transitionSwapLeg: jest.fn(),
  };
  return new SwapWorkflowService(
    mocks.prisma,
    mocks.onboardingService as any,
    mocks.swapQuoteService as any,
    mocks.swapTransactionsService as any,
    mocks.accountingService as any,
    mocks.auditLogsService as any,
    mocks.eventEmitter as any,
    mocks.swapSettlement as any,
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

    // SwapSettlementService.start called once with the swap ctx
    expect(mocks.swapSettlement.start).toHaveBeenCalledTimes(1);

    // No SWAP_SUCCEEDED domain event at executeSwap return (swap is still PROCESSING)
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
  const swapSettlement = { start: jest.fn() };

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
    swapSettlement,
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
    mocks.swapSettlement as any,
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

  it('TERMINAL_FAIL voids leg + marks swap FAILED + audits + recomputes (no throw)', async () => {
    // leg1 is BROADCASTED; transition will return FAILED → terminal-fail branch.
    const mocks = buildAdvanceLegMocks({
      legs: [{ legSeq: 1, status: InternalFundStatus.BROADCASTED }],
    });
    // Override transitionSwapLeg to land in a terminal-fail status
    (mocks.fundsFlow.transitionSwapLeg as jest.Mock).mockResolvedValueOnce({
      leg: {},
      prevStatus: InternalFundStatus.BROADCASTED,
      nextStatus: InternalFundStatus.FAILED,
    });
    const svc = makeAdvanceLegService(mocks);

    // Must resolve normally (no throw) — Prisma + TB commit together.
    const result = await svc.advanceLeg('SWP0001', 1, InternalFundAction.FAIL, 'ADMIN-1');
    expect(result.nextStatus).toBe(InternalFundStatus.FAILED);

    // voidLeg called for leg1 spec
    expect(mocks.legAccounting.voidLeg).toHaveBeenCalledTimes(1);
    expect((mocks.legAccounting.voidLeg as jest.Mock).mock.calls[0][1].legSeq).toBe(1);

    // markStatus(FAILED) called
    expect(mocks.swapTransactionsService.markStatus).toHaveBeenCalledTimes(1);
    expect((mocks.swapTransactionsService.markStatus as jest.Mock).mock.calls[0][1]).toBe('FAILED');

    // Audit SWAP_FAILED recorded
    const failed = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((a) => a.action === AuditActions.SWAP_FAILED);
    expect(failed).toBeDefined();
    expect(failed.metadata.legSeq).toBe(1);
    expect(failed.metadata.nextStatus).toBe(InternalFundStatus.FAILED);

    // recomputeProjections called
    expect(mocks.swapTransactionsService.recomputeProjections).toHaveBeenCalledTimes(1);

    // postLeg NOT called (this is the fail branch)
    expect(mocks.legAccounting.postLeg).not.toHaveBeenCalled();

    // No chained createSwapLeg, no SUCCESS event
    expect(mocks.fundsFlow.createSwapLeg).not.toHaveBeenCalled();
    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();
  });
});
