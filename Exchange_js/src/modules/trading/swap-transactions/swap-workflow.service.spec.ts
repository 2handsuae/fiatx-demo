/**
 * swap-workflow.service.spec.ts
 *
 * SwapWorkflowService owns the swap journey, now event-driven on funds_order:
 *   initiateSwap       → L1 gates + consumeQuote + creates the swap
 *                        (COMPLIANCE_PENDING, no legs) + submits the sell leg
 *                        to Sumsub KYT (Task 4). Leg-building is deferred to
 *                        applyKytVerdict/onKytApproved (Task 6) once the
 *                        webhook verdict lands.
 *   submitSumsubTxnOut → idempotent: submits the sell leg, no-ops if the swap
 *                        already has a sumsubTxnIdOut (watchdog-retry safe).
 *   advanceLeg         → thin sync wrapper: resolve active leg → funds_order.advance
 *                        (sell-first guard preserved).
 *   handleFundsOrderChanged → on CLEARED: post + chain next / finalize SUCCESS;
 *                        on FAILED/TIMEOUT: Swap-6 self-heal (retry ≤3 else STUCK).
 *   resumeLeg          → manual recovery (fresh attempt, clears needsReview).
 */
import { SwapWorkflowService } from './swap-workflow.service';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FundsOrderStatus } from '../../funds-orders/dto/funds-order.dto';
import { SwapTransactionAction, SwapTransactionStatus } from './dto/swap-transaction.dto';
import { buildSwapLegPlan } from '../../funds-layer/constants/swap-leg-plan.constant';

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
      status: 'COMPLIANCE_PENDING',
    })),
    findOne: jest.fn(() => Promise.resolve({ id: 'swap-1', swapNo: 'SWP0001', status: 'COMPLIANCE_PENDING' })),
    recomputeProjections: jest.fn(() => Promise.resolve()),
    // Task 11 hardening: initiateSwap now routes its return value through
    // this allow-list. Pass-through mock — the allow-list's own field
    // selection is covered by swap-transactions.service.spec.ts, not here.
    toCustomerSwapView: jest.fn((item: any) => item),
  };

  const auditLogsService = {
    recordByActor: jest.fn(() => Promise.resolve()),
    recordSystem: jest.fn(() => Promise.resolve()),
  };

  // submitSumsubTxnOut (Task 4) — submits the swap's sell leg to Sumsub KYT.
  const sumsubTxnClient = {
    submitTxn: jest.fn(() => Promise.resolve({ txnId: 'txn-mock-out' })),
  };

  const eventEmitter = { emit: jest.fn() };

  const onboardingService = {
    assertTradingEligibility: jest.fn(() => Promise.resolve()),
  };

  const walletQuery = {
    hasReceivingAccount: jest.fn(() => Promise.resolve(true)),
  };

  const limitGateService = {
    evaluate: jest.fn(() => Promise.resolve({
      grossAedValue: new Prisma.Decimal(0), aedRate: null, rateFetchedAt: null, rateFetchFailed: false,
    })),
  };

  const prisma: any = {
    customerMain: {
      findUnique: jest.fn(() => Promise.resolve({ id: 'cust-1', complianceStatus: 'ACTIVE', adminStatus: 'ACTIVE', onboardingStatus: 'APPROVED' })),
    },
    // L1 Transaction Limit gate: initiateSwap peeks the quote (outside the tx)
    // for the from-asset + amount before evaluating the gate.
    swapQuote: {
      findUnique: jest.fn(() => Promise.resolve({ fromAssetId: quote.fromAssetId, amountIn: quote.amountIn })),
    },
    // submitSumsubTxnOut reads/writes the swap row directly (outside the
    // create transaction) — used by initiateSwap's post-commit submit call
    // and by the dedicated submitSumsubTxnOut tests.
    swapTransaction: {
      findUnique: jest.fn(() => Promise.resolve({
        id: 'swap-1', swapNo: 'SWP0001', sumsubTxnIdOut: null,
        fromAmount: quote.amountIn,
        fromAsset: { currency: quote.fromAssetCode, type: assetMap[quote.fromAssetId]?.type },
        customer: { sumsubApplicantId: 'applicant-1' },
      })),
      update: jest.fn(() => Promise.resolve({})),
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

  return { accountingService, swapQuoteService, swapTransactionsService, auditLogsService, eventEmitter, onboardingService, walletQuery, limitGateService, prisma, sumsubTxnClient };
}

function makeService(mocks: ReturnType<typeof buildMocks>) {
  // SwapLegAccounting + FundsOrderService stubs — used by the direct
  // buildLegContext/createLeg tests below (leg-building itself now happens in
  // applyKytVerdict/Task 6, not initiateSwap).
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
    mocks.limitGateService as any,
    mocks.sumsubTxnClient as any,
    {} as any, // customerRestrictionsService — not on this path (initiateSwap never rejects)
    {} as any, // pendingActionService — not on this path
  );
}

// ── initiateSwap ─────────────────────────────────────────────────────────────

describe('SwapWorkflowService.initiateSwap — COMPLIANCE_PENDING, no legs', () => {
  it('initiateSwap 消费 quote、建单为 COMPLIANCE_PENDING、不建任何腿', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);
    const createLegSpy = jest.spyOn(service as any, 'createLeg');

    const swap = await service.initiateSwap('cust-1', 'quote-1');

    expect(swap.status).toBe('COMPLIANCE_PENDING');
    expect(mocks.swapQuoteService.consumeQuote).toHaveBeenCalledTimes(1);
    expect(createLegSpy).not.toHaveBeenCalled();
    expect(mocks.accountingService.executePendingTransfer).not.toHaveBeenCalled();

    // Stronger form of the same property (task guarantee #2): nothing is
    // booked at all — no funds_order, no TB pending, no direct transfer.
    expect((mocks as any).fundsOrders.create).not.toHaveBeenCalled();
    expect((mocks as any).legAccounting.initiateLegPending).not.toHaveBeenCalled();
    expect(mocks.accountingService.executeTransfer).not.toHaveBeenCalled();

    // tb*TransferId columns are null at create time (legs post later, Task 6)
    const createArg = (mocks.swapTransactionsService.create as jest.Mock).mock.calls[0][0];
    expect(createArg.tbFromTransferId).toBeNull();
    expect(createArg.tbToTransferId).toBeNull();
    expect(createArg.tbFeeTransferId).toBeNull();
    expect(createArg.tbSpreadTransferId).toBeNull();
    expect(createArg.status).toBe('COMPLIANCE_PENDING');

    // No SWAP_SUCCEEDED domain event at initiateSwap return (swap awaits KYT)
    expect(mocks.eventEmitter.emit).not.toHaveBeenCalled();

    // The sell leg was submitted to Sumsub as part of initiateSwap.
    expect(mocks.sumsubTxnClient.submitTxn).toHaveBeenCalledTimes(1);
  });

  it('submitSumsubTxnOut 提交卖出腿并回写 sumsubTxnIdOut', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);

    await service.submitSumsubTxnOut('swap-1');

    const arg = (mocks.sumsubTxnClient.submitTxn as jest.Mock).mock.calls[0][0];
    expect(arg).toMatchObject({
      type: 'finance', direction: 'out', currencyCode: 'USDT',
      orderId: 'SWP0001', props: { txType: 'exchange' }, infoType: 'exchange',
    });
    expect(mocks.prisma.swapTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sumsubTxnIdOut: expect.any(String) }) }),
    );
    // 同步响应只作证据快照，绝不写 status —— 状态唯一写入口是 webhook handler.
    // This is the safety-critical invariant a later task's second writer relies on.
    const updateData = (mocks.prisma.swapTransaction.update as jest.Mock).mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('status');
  });

  it('submitSumsubTxnOut 携带 scoringResult 时把 complianceAction/complianceRuleNames 原样落回该行（且仍不写 status）', async () => {
    const mocks = buildMocks(makeQuote());
    (mocks.sumsubTxnClient.submitTxn as jest.Mock).mockResolvedValueOnce({
      txnId: 'txn-mock-out',
      scoringResult: { action: 'onHold', matchedRuleNames: ['RULE_A', 'RULE_B'] },
    });
    const service = makeService(mocks);

    await service.submitSumsubTxnOut('swap-1');

    const updateData = (mocks.prisma.swapTransaction.update as jest.Mock).mock.calls[0][0].data;
    expect(updateData.complianceAction).toBe('onHold');
    expect(updateData.complianceRuleNames).toBe('RULE_A,RULE_B');
    expect(updateData).not.toHaveProperty('status');
  });

  it('submitSumsubTxnOut 幂等：已有 sumsubTxnIdOut 时不重复提交', async () => {
    const mocks = buildMocks(makeQuote());
    (mocks.prisma.swapTransaction.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'swap-1', swapNo: 'SWP0001', sumsubTxnIdOut: 'already-submitted',
      fromAmount: makeQuote().amountIn,
      fromAsset: { currency: 'USDT', type: 'CRYPTO' },
      customer: { sumsubApplicantId: 'applicant-1' },
    });
    const service = makeService(mocks);

    await service.submitSumsubTxnOut('swap-1');

    expect(mocks.sumsubTxnClient.submitTxn).not.toHaveBeenCalled();
    expect(mocks.prisma.swapTransaction.update).not.toHaveBeenCalled();
  });

  it('buildLegContext rebuilds SwapSettleCtx from the persisted swap row — CASE A (USDT→AED, fromIsFiat=false)', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);
    const swapRow = {
      id: 'swap-1', swapNo: 'SWP0001', ownerId: 'cust-1',
      fromAssetId: 'asset-usdt', toAssetId: 'asset-aed',
      fromAmount: new Prisma.Decimal('100'), toAmount: new Prisma.Decimal('0.05'),
      feeAmount: new Prisma.Decimal('0.01'),
    };
    const tx: any = { asset: { findUnique: jest.fn(({ where }: any) => Promise.resolve(assetMap[where.id] ?? null)) } };

    const ctx = await (service as any).buildLegContext(swapRow, tx);

    expect(ctx.swapId).toBe('swap-1');
    expect(ctx.swapNo).toBe('SWP0001');
    expect(ctx.ownerId).toBe('cust-1');
    expect(ctx.fromIsFiat).toBe(false);   // USDT is CRYPTO
    expect(ctx.fromCurrency).toBe('USDT');
    expect(ctx.toCurrency).toBe('AED');
    expect(ctx.fromDecimals).toBe(6);
    expect(ctx.toDecimals).toBe(2);
    expect(ctx.grossToAmount.equals(new Prisma.Decimal('0.05'))).toBe(true);
    expect(ctx.feeAmount.equals(new Prisma.Decimal('0.01'))).toBe(true);
  });

  it('buildLegContext rebuilds SwapSettleCtx from the persisted swap row — CASE B (AED→USDT, fromIsFiat=true)', async () => {
    const mocks = buildMocks(reverseQuote());
    const service = makeService(mocks);
    const swapRow = {
      id: 'swap-1', swapNo: 'SWP0001', ownerId: 'cust-1',
      fromAssetId: 'asset-aed', toAssetId: 'asset-usdt',
      fromAmount: new Prisma.Decimal('100'), toAmount: new Prisma.Decimal('50'),
      feeAmount: new Prisma.Decimal('1'),
    };
    const tx: any = { asset: { findUnique: jest.fn(({ where }: any) => Promise.resolve(assetMap[where.id] ?? null)) } };

    const ctx = await (service as any).buildLegContext(swapRow, tx);

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

    await service.initiateSwap('cust-1', 'q-1');

    expect(mocks.onboardingService.assertTradingEligibility).toHaveBeenCalledWith('cust-1', 'SWAP');
    expect(mocks.swapQuoteService.consumeQuote).toHaveBeenCalledTimes(1);

    const createdAudit = (mocks.auditLogsService.recordByActor as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .find((a: any) => a.action === 'SWAP_CREATED');
    expect(createdAudit).toBeDefined();
  });

  // ── L1 Transaction Limit gate (Task 6) wiring contract ──────────────────────
  it('L1 limit: calls limitGateService.evaluate with the FROM-side asset/amount for the customer', async () => {
    const mocks = buildMocks(makeQuote()); // fromAssetId=asset-usdt, amountIn=100
    const service = makeService(mocks);

    await service.initiateSwap('cust-1', 'q-1');

    expect(mocks.limitGateService.evaluate).toHaveBeenCalledTimes(1);
    const gateArg = (mocks.limitGateService.evaluate as jest.Mock).mock.calls[0][0];
    expect(gateArg.operationType).toBe('SWAP');
    expect(gateArg.customerId).toBe('cust-1');
    expect(gateArg.assetId).toBe('asset-usdt'); // FROM-side, not toAssetId
    expect(gateArg.amount.equals(new Prisma.Decimal('100'))).toBe(true);
  });

  it('L1 limit: an A/B breach (evaluate rejects) blocks creation — no swap row, no quote consume', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);
    (mocks.limitGateService.evaluate as jest.Mock).mockRejectedValueOnce(
      new BadRequestException({ code: 'TRANSACTION_LIMIT_ABOVE_MAX' }),
    );

    await expect(service.initiateSwap('cust-1', 'q-1')).rejects.toBeInstanceOf(BadRequestException);

    // Gate runs BEFORE the $transaction: nothing is created or consumed.
    expect(mocks.swapTransactionsService.create).not.toHaveBeenCalled();
    expect(mocks.swapQuoteService.consumeQuote).not.toHaveBeenCalled();
    expect((mocks as any).fundsOrders.create).not.toHaveBeenCalled();
  });

  it('L1 limit: the AED valuation flows onto swapTransactionsService.create (grossAedValue not dropped)', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);
    (mocks.limitGateService.evaluate as jest.Mock).mockResolvedValueOnce({
      grossAedValue: new Prisma.Decimal('1234'), aedRate: new Prisma.Decimal('3.67'), rateFetchedAt: new Date(), rateFetchFailed: false,
    });

    await service.initiateSwap('cust-1', 'q-1');

    const createArg = (mocks.swapTransactionsService.create as jest.Mock).mock.calls[0][0];
    expect(createArg.grossAedValue.equals(new Prisma.Decimal('1234'))).toBe(true);
  });

  it('R4: rejects RECEIVING_ACCOUNT_REQUIRED when buy-side (toAsset) has no receiving account', async () => {
    const mocks = buildMocks(makeQuote()); // USDT(from) → AED(to)
    const service = makeService(mocks);
    (mocks as any).walletQuery.hasReceivingAccount.mockImplementation(
      (_customerId: string, assetId: string) => Promise.resolve(assetId !== 'asset-aed'),
    );

    await expect(service.initiateSwap('cust-1', 'q-1')).rejects.toMatchObject({
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

    await expect(service.initiateSwap('cust-1', 'q-1')).rejects.toMatchObject({
      response: { code: 'RECEIVING_ACCOUNT_REQUIRED', assetCode: 'USDT' },
    });

    expect(mocks.swapTransactionsService.create).not.toHaveBeenCalled();
    expect((mocks as any).fundsOrders.create).not.toHaveBeenCalled();
  });

  it('R4: proceeds past the gate when both sides have an active receiving account', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);
    // default stub already resolves true for both sides

    await service.initiateSwap('cust-1', 'q-1');

    expect((mocks as any).walletQuery.hasReceivingAccount).toHaveBeenCalledWith('cust-1', 'asset-usdt');
    expect((mocks as any).walletQuery.hasReceivingAccount).toHaveBeenCalledWith('cust-1', 'asset-aed');
    expect(mocks.swapTransactionsService.create).toHaveBeenCalledTimes(1);
  });

  it('inherits quote.traceId into create() call and SWAP_CREATED audit', async () => {
    const TRACE = 'QUOTE-TRACE-UUID';
    const mocks = buildMocks(makeQuote({ traceId: TRACE } as any));
    const service = makeService(mocks);

    await service.initiateSwap('cust-1', 'q-1');

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
    await expect(service.initiateSwap('cust-1', 'q-1')).rejects.toThrow('db error');

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

// Build mocks for advanceLeg + handleFundsOrderChanged (extends initiateSwap mocks).
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
    // onLegConfirmed reads the leg funds_order back to enrich POST evidence with
    // the minted externalRef; return a truthy row + a stable ref for assertions.
    findById: jest.fn(async () => ({ asset: { type: 'CRYPTO' }, txHash: '0xFAKESWAPREF', referenceNo: null })),
    resolveExternalRef: jest.fn(() => '0xFAKESWAPREF'),
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
  // advanceLeg never calls initiateSwap, so the limit gate + sumsubTxnClient
  // are never invoked here.
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
    {} as any,
    {} as any,
    {} as any, // customerRestrictionsService — not on this path (advanceLeg never rejects)
    {} as any, // pendingActionService — not on this path
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
    // 4th arg = the funds_order-minted externalRef resolved in onLegConfirmed.
    expect((mocks.legAccounting.postLeg as jest.Mock).mock.calls[0][3]).toBe('0xFAKESWAPREF');

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
    // 4th arg = the funds_order-minted externalRef resolved in onLegConfirmed.
    expect((mocks.legAccounting.postLeg as jest.Mock).mock.calls[0][3]).toBe('0xFAKESWAPREF');

    // markStatus(SUCCESS).
    expect(mocks.swapTransactionsService.markStatus).toHaveBeenCalledTimes(1);
    expect((mocks.swapTransactionsService.markStatus as jest.Mock).mock.calls[0][1]).toBe(SwapTransactionAction.SUCCESS);

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

// Leg-building (createLeg/buildLegContext) is invoked by applyKytVerdict
// (Task 6) now, not by initiateSwap — exercise it directly here to keep R1
// coverage for the code that moved, unchanged, out of the old executeSwap.
describe('SwapWorkflowService — R1: createLeg receives resolved wallets', () => {
  const swapRow = {
    id: 'swap-1', swapNo: 'SWP0001', ownerId: 'cust-1',
    fromAssetId: 'asset-usdt', toAssetId: 'asset-aed',
    fromAmount: new Prisma.Decimal('100'), toAmount: new Prisma.Decimal('0.05'),
    feeAmount: new Prisma.Decimal('0.01'),
  };

  it('createLeg leg1: passes resolved fromWalletId/toWalletId to funds_order.create', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);
    const tx: any = { asset: { findUnique: jest.fn(({ where }: any) => Promise.resolve(assetMap[where.id] ?? null)) } };
    const ctx = await (service as any).buildLegContext(swapRow, tx);
    const legSpecs = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat });

    await (service as any).createLeg(swapRow, legSpecs[0]!, ctx, 1, 1, 'TRACE-CREATELEG-1', tx);

    expect((mocks as any).legAccounting.resolveLegWallets).toHaveBeenCalledTimes(1);
    const createLegArg = ((mocks as any).fundsOrders.create as jest.Mock).mock.calls[0][0];
    expect(createLegArg.fromWalletId).toBe('w-from');
    expect(createLegArg.toWalletId).toBe('w-to');

    // Coverage dropped in the earlier test rewrite (finding 5):
    expect(createLegArg.swapTransactionId).toBe(swapRow.id);
    expect(createLegArg.legSeq).toBe(1);
    expect(createLegArg.attempt).toBe(1);
    // An unguarded change to SUBMITTED here would currently pass green without this.
    expect(createLegArg.initialStatus).toBe(FundsOrderStatus.CREATED);
    // traceId propagates onto the created funds order.
    expect(createLegArg.traceId).toBe('TRACE-CREATELEG-1');

    // legAccounting.initiateLegPending called once (positive assertion).
    expect((mocks as any).legAccounting.initiateLegPending).toHaveBeenCalledTimes(1);
    // createLeg's per-attempt context enrichment sets `attempt` on the leg context.
    expect((mocks as any).legAccounting.initiateLegPending.mock.calls[0][0].attempt).toBe(1);

    // createLeg must not auto-advance the leg.
    expect((mocks as any).fundsOrders.advance).not.toHaveBeenCalled();
  });

  it('createLeg throws InvalidInternalFundError when customer-side wallet does not resolve', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);
    ((mocks as any).legAccounting.resolveLegWallets as jest.Mock).mockResolvedValueOnce({
      fromWalletId: null,
      toWalletId: 'firm-ops-wallet',
    });
    const tx: any = { asset: { findUnique: jest.fn(({ where }: any) => Promise.resolve(assetMap[where.id] ?? null)) } };
    const ctx = await (service as any).buildLegContext(swapRow, tx);
    const legSpecs = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat });

    await expect(
      (service as any).createLeg(swapRow, legSpecs[0]!, ctx, 1, 1, undefined, tx),
    ).rejects.toBeInstanceOf(InvalidInternalFundError);

    // create must NOT be called when R1 assert fails.
    expect((mocks as any).fundsOrders.create).not.toHaveBeenCalled();
  });
});

// ── applyKytVerdict (Task 6) — approved → PROCESSING+leg1+buy-leg submit; ──
// ── rejected → REJECTED with zero accounting trace; both idempotent ────────

import { CustomerPendingActionService } from '../../identity/customers/customer-pending-action.service';

describe('SwapWorkflowService.applyKytVerdict', () => {
  function buildApplyKytVerdictMocks(overrides: { status?: string } = {}) {
    const swapRow = {
      id: 's1',
      swapNo: 'SWP0001',
      status: overrides.status ?? SwapTransactionStatus.COMPLIANCE_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      ownerNo: 'C0001',
      traceId: 'TRACE-1',
      fromAssetId: 'asset-usdt',
      toAssetId: 'asset-aed',
      fromAmount: new Prisma.Decimal('100'),
      toAmount: new Prisma.Decimal('0.05'),
      netToAmount: new Prisma.Decimal('0.04'),
      feeAmount: new Prisma.Decimal('0.01'),
      fromAsset: { decimals: 6, currency: 'USDT', type: 'CRYPTO' },
      toAsset: { decimals: 2, currency: 'AED', type: 'FIAT' },
    };

    // The $transaction callback's tx client — distinct from the top-level
    // `prisma.swapTransaction` spy below so tests can tell apart writes made
    // INSIDE the markStatus transaction from writes made outside it
    // (transaction-boundary property).
    const txClient: any = {
      asset: {
        findUnique: jest.fn(({ where }: any) => Promise.resolve(assetMap[where.id] ?? null)),
      },
      swapTransaction: {
        update: jest.fn(() => Promise.resolve({})),
      },
    };

    const swapTransactionsService = {
      findByIdInternal: jest.fn(() => Promise.resolve(swapRow)),
      markStatus: jest.fn(() => Promise.resolve()),
      recomputeProjections: jest.fn(() => Promise.resolve()),
      setNeedsReview: jest.fn(() => Promise.resolve()),
    };

    const legAccounting = {
      resolveLegWallets: jest.fn(() => Promise.resolve({ fromWalletId: 'w-from', toWalletId: 'w-to' })),
      initiateLegPending: jest.fn(() => Promise.resolve()),
    };

    const fundsOrders = {
      create: jest.fn(() => Promise.resolve({ id: 'fo-1', legSeq: 1, attempt: 1, status: 'CREATED' })),
    };

    const auditLogsService = {
      recordSystem: jest.fn(() => Promise.resolve()),
      recordByActor: jest.fn(() => Promise.resolve()),
    };

    const sumsubTxnClient = {
      submitTxn: jest.fn(() => Promise.resolve({ txnId: 'txn-mock-in' })),
    };

    // Guarantee #2 (rejection is zero-trace) is asserted against these too.
    const accountingService = {
      executePendingTransfer: jest.fn(() => Promise.resolve({ tbTransferId: 0n })),
      voidPendingTransfer: jest.fn(() => Promise.resolve()),
      postPendingTransfer: jest.fn(() => Promise.resolve()),
      executeTransfer: jest.fn(() => Promise.resolve({ tbTransferId: 1n })),
    };

    const prisma: any = {
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(txClient)),
      // submitSumsubTxnIn (buy leg) reads/writes the swap row directly,
      // outside the markStatus transaction — mirrors submitSumsubTxnOut.
      swapTransaction: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: 's1',
            swapNo: 'SWP0001',
            ownerId: 'cust-1',
            sumsubTxnIdIn: null,
            netToAmount: swapRow.netToAmount,
            toAmount: swapRow.toAmount,
            toAsset: { currency: 'AED', type: 'FIAT' },
            customer: { sumsubApplicantId: 'applicant-1' },
          }),
        ),
        update: jest.fn(() => Promise.resolve({})),
      },
    };

    // Task 7: CustomerRestrictionsService stays a jest mock here — its own
    // idempotency (dedup per capability) is already proven in
    // customer-restrictions.service.spec.ts (Task 1); these tests only need
    // to assert swap-workflow *calls* it correctly.
    const customerRestrictionsService = {
      add: jest.fn(() => Promise.resolve()),
    };

    // Task 7: CustomerPendingActionService is the REAL implementation wired
    // to a small stateful customerMain fake, not a jest mock. The whole point
    // of the tipping-off split is that the read side (.get()) is a dumb
    // accessor with no logic of its own — mocking .get() would just assert
    // our own assumption back at us instead of proving the write landed
    // right. Deliberately a separate prisma-like object from `prisma` above
    // (real production code injects two separate services, both ultimately
    // backed by the same PrismaService — test isolation mirrors that).
    const customerMainRow: any = {
      id: 'cust-1',
      customerNo: 'C0001',
      pendingActionExternalId: null,
      pendingActionReason: null,
      hardLineDispositionedAt: null,
    };
    const pendingActionPrisma: any = {
      customerMain: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(where.id === customerMainRow.id ? { ...customerMainRow } : null),
        ),
        update: jest.fn(({ data }: any) => {
          Object.assign(customerMainRow, data);
          return Promise.resolve({ ...customerMainRow });
        }),
      },
    };
    const pendingActionService = new CustomerPendingActionService(pendingActionPrisma);

    return {
      swapRow,
      txClient,
      swapTransactionsService,
      legAccounting,
      fundsOrders,
      auditLogsService,
      sumsubTxnClient,
      accountingService,
      prisma,
      customerRestrictionsService,
      pendingActionService,
      customerMainRow,
    };
  }

  function makeApplyKytVerdictService(mocks: ReturnType<typeof buildApplyKytVerdictMocks>) {
    return new SwapWorkflowService(
      mocks.prisma,
      {} as any, // onboardingService — not on this path
      {} as any, // swapQuoteService — not on this path
      mocks.swapTransactionsService as any,
      mocks.accountingService as any,
      mocks.auditLogsService as any,
      { emit: jest.fn() } as any, // eventEmitter — not on this path
      mocks.legAccounting as any,
      mocks.fundsOrders as any,
      {} as any, // walletQuery — not on this path
      {} as any, // limitGateService — not on this path
      mocks.sumsubTxnClient as any,
      mocks.customerRestrictionsService as any,
      mocks.pendingActionService as any,
    );
  }

  it('approved → markStatus(KYT_APPROVED) + builds leg1 + submits the buy leg to Sumsub', async () => {
    const mocks = buildApplyKytVerdictMocks();
    const service = makeApplyKytVerdictService(mocks);
    const createLegSpy = jest.spyOn(service as any, 'createLeg');

    await service.applyKytVerdict('s1', { verdict: 'approved' });

    expect(mocks.swapTransactionsService.markStatus).toHaveBeenCalledWith(
      's1',
      SwapTransactionAction.KYT_APPROVED,
      expect.anything(),
    );
    expect(createLegSpy).toHaveBeenCalledTimes(1);
    // leg1 is the SELL leg — its asset must be the FROM asset (proves the ctx
    // passed to createLeg came from a real buildLegContext, not a stub).
    const createArg = (mocks.fundsOrders.create as jest.Mock).mock.calls[0][0];
    expect(createArg.assetId).toBe('asset-usdt');
    expect(createArg.legSeq).toBe(1);
    expect(createArg.attempt).toBe(1);

    expect(mocks.sumsubTxnClient.submitTxn).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'in', orderId: 'SWP0001' }),
    );

    // KYT_APPROVED audit recorded with the richer shape used elsewhere in
    // this file (workflowType/traceId/entityOwnerType/entityOwnerId) — the
    // sparse SWAP_KYT_SUBMITTED call is the odd one out, not the model.
    const approvedAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((a: any) => a.action === AuditActions.SWAP_KYT_APPROVED);
    expect(approvedAudit).toBeDefined();
    expect(approvedAudit.workflowType).toBeDefined();
    expect(approvedAudit.traceId).toBe('TRACE-1');
    expect(approvedAudit.entityOwnerType).toBe('CUSTOMER');
    expect(approvedAudit.entityOwnerId).toBe('cust-1');
  });

  it('rejected → markStatus(KYT_REJECTED, {rejectReason: KYT_REJECTED}) with zero accounting/leg trace', async () => {
    const mocks = buildApplyKytVerdictMocks();
    const service = makeApplyKytVerdictService(mocks);
    const createLegSpy = jest.spyOn(service as any, 'createLeg');

    await service.applyKytVerdict('s1', { verdict: 'rejected', applicantActions: [] });

    expect(mocks.swapTransactionsService.markStatus).toHaveBeenCalledWith(
      's1',
      SwapTransactionAction.KYT_REJECTED,
      expect.anything(),
      { rejectReason: 'KYT_REJECTED' },
    );
    expect(mocks.accountingService.executePendingTransfer).not.toHaveBeenCalled();
    expect(mocks.accountingService.voidPendingTransfer).not.toHaveBeenCalled();
    expect(mocks.accountingService.executeTransfer).not.toHaveBeenCalled();
    expect(mocks.fundsOrders.create).not.toHaveBeenCalled();
    expect(createLegSpy).not.toHaveBeenCalled();
    // The buy-leg is never submitted for a rejected swap.
    expect(mocks.sumsubTxnClient.submitTxn).not.toHaveBeenCalled();

    const rejectedAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((a: any) => a.action === AuditActions.SWAP_KYT_REJECTED);
    expect(rejectedAudit).toBeDefined();
    expect(rejectedAudit.entityOwnerType).toBe('CUSTOMER');
    expect(rejectedAudit.entityOwnerId).toBe('cust-1');
  });

  it('rejected hands off to handleRejectDisposition (Task 7 stub) with the swap + raw input', async () => {
    const mocks = buildApplyKytVerdictMocks();
    const service = makeApplyKytVerdictService(mocks);
    const dispositionSpy = jest
      .spyOn(service as any, 'handleRejectDisposition')
      .mockResolvedValue(undefined);

    const input = { verdict: 'rejected' as const, typedTags: ['SANCTION'] };
    await service.applyKytVerdict('s1', input);

    expect(dispositionSpy).toHaveBeenCalledTimes(1);
    expect(dispositionSpy.mock.calls[0][0]).toMatchObject({ id: 's1' });
    expect(dispositionSpy.mock.calls[0][1]).toBe(input);
  });

  it.each([
    SwapTransactionStatus.SUCCESS,
    SwapTransactionStatus.REJECTED,
    SwapTransactionStatus.FAILED,
    SwapTransactionStatus.REVERSED,
  ])('already-terminal (%s) → no-op, idempotent against webhook redelivery', async (status) => {
    const mocks = buildApplyKytVerdictMocks({ status });
    const service = makeApplyKytVerdictService(mocks);

    await service.applyKytVerdict('s1', { verdict: 'approved' });

    expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.fundsOrders.create).not.toHaveBeenCalled();
    expect(mocks.sumsubTxnClient.submitTxn).not.toHaveBeenCalled();
  });

  // ── Review Fix 1 (Important): a REJECTED swap receiving another 'rejected'
  // ── verdict is the shape of a disposition-failure retry (handleRejectDisposition
  // ── threw after the REJECTED transaction committed, the ingestion dispatcher
  // ── marked the webhook FAILED and redelivered it) — it must re-run disposition,
  // ── not silently no-op like the other terminal statuses. markStatus/leg-building
  // ── must NOT re-run — only disposition, which is independently idempotent.
  it('REJECTED + rejected verdict → re-runs ONLY handleRejectDisposition (disposition-failure retry), not markStatus/$transaction', async () => {
    const mocks = buildApplyKytVerdictMocks({ status: SwapTransactionStatus.REJECTED });
    const service = makeApplyKytVerdictService(mocks);
    const dispositionSpy = jest
      .spyOn(service as any, 'handleRejectDisposition')
      .mockResolvedValue(undefined);

    const input = { verdict: 'rejected' as const, typedTags: ['SANCTION'] };
    await service.applyKytVerdict('s1', input);

    expect(dispositionSpy).toHaveBeenCalledTimes(1);
    expect(dispositionSpy.mock.calls[0][0]).toMatchObject({ id: 's1' });
    expect(dispositionSpy.mock.calls[0][1]).toBe(input);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
  });

  // A genuinely duplicate 'rejected' redelivery for an already-REJECTED swap
  // must stay harmless — handleRejectDisposition's own idempotency (proven
  // below) is what makes re-admitting this case into disposition safe rather
  // than a source of duplicate restrictions.
  it('REJECTED + approved verdict (contradictory / stale) → still a plain no-op, disposition not re-run', async () => {
    const mocks = buildApplyKytVerdictMocks({ status: SwapTransactionStatus.REJECTED });
    const service = makeApplyKytVerdictService(mocks);
    const dispositionSpy = jest.spyOn(service as any, 'handleRejectDisposition');

    await service.applyKytVerdict('s1', { verdict: 'approved' });

    expect(dispositionSpy).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  // ── Finding 2 (Minor, 终审): the same disposition-failure-retry shape as ──
  // ── the REJECTED carve-out above, but for a swap that reached SUCCESS —
  // ── disposition is also invoked from the PROCESSING branch (a hard line
  // ── raised after the swap already entered settlement); if THAT call
  // ── throws, the webhook retry can land ≥30s later, by which time all legs
  // ── may have cleared. The order's state must not decide whether the PERSON
  // ── gets restricted, so SUCCESS is admitted here too — but only to re-run
  // ── disposition, never markStatus/leg-building (proven below: it cannot
  // ── cause a state transition, a second set of legs, or unwind a completed
  // ── swap — that is exactly why the terminal guard exists).
  it('SUCCESS + rejected verdict → re-runs ONLY handleRejectDisposition (post-approval disposition-failure retry), never re-transitions or rebuilds legs (Finding 2)', async () => {
    const mocks = buildApplyKytVerdictMocks({ status: SwapTransactionStatus.SUCCESS });
    const service = makeApplyKytVerdictService(mocks);
    const dispositionSpy = jest
      .spyOn(service as any, 'handleRejectDisposition')
      .mockResolvedValue(undefined);

    const input = { verdict: 'rejected' as const, typedTags: ['SANCTION'] };
    await service.applyKytVerdict('s1', input);

    expect(dispositionSpy).toHaveBeenCalledTimes(1);
    expect(dispositionSpy.mock.calls[0][0]).toMatchObject({ id: 's1' });
    expect(dispositionSpy.mock.calls[0][1]).toBe(input);
    // A completed swap must never be touched again: no transaction, no state
    // transition, no second set of legs — only the person-level retry.
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
    expect(mocks.fundsOrders.create).not.toHaveBeenCalled();
  });

  it('SUCCESS + rejected (SANCTION) verdict → completed swap stays fully untouched, but the customer is still restricted (Finding 2)', async () => {
    const mocks = buildApplyKytVerdictMocks({ status: SwapTransactionStatus.SUCCESS });
    const service = makeApplyKytVerdictService(mocks);

    await service.applyKytVerdict('s1', { verdict: 'rejected', typedTags: ['SANCTION'] });

    expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
    expect(mocks.fundsOrders.create).not.toHaveBeenCalled();
    expect(mocks.customerRestrictionsService.add).toHaveBeenCalledWith(
      'cust-1',
      ['SWAP', 'WITHDRAW'],
      'KYT_REJECTED',
      'system',
    );
    // Sanction hit — tipping-off silence still applies against a completed swap.
    expect(await mocks.pendingActionService.get('cust-1')).toBeNull();
  });

  it('SUCCESS + approved verdict (stale/contradictory) → still a plain no-op, disposition not re-run', async () => {
    const mocks = buildApplyKytVerdictMocks({ status: SwapTransactionStatus.SUCCESS });
    const service = makeApplyKytVerdictService(mocks);
    const dispositionSpy = jest.spyOn(service as any, 'handleRejectDisposition');

    await service.applyKytVerdict('s1', { verdict: 'approved' });

    expect(dispositionSpy).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  // ── Review Fix 1 (Important): PROCESSING is NOT terminal, but neither verdict
  // ── has a legal state-machine edge from it — a late/re-scored verdict must
  // ── audit + flag review instead of falling through into markStatus and
  // ── throwing (which would dead-letter the webhook).
  it('PROCESSING + rejected verdict → no throw, no transition, no legs, flags needsReview', async () => {
    const mocks = buildApplyKytVerdictMocks({ status: SwapTransactionStatus.PROCESSING });
    const service = makeApplyKytVerdictService(mocks);
    const createLegSpy = jest.spyOn(service as any, 'createLeg');

    await expect(
      service.applyKytVerdict('s1', { verdict: 'rejected', typedTags: ['SANCTION'] }),
    ).resolves.toBeUndefined();

    expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
    expect(createLegSpy).not.toHaveBeenCalled();
    expect(mocks.fundsOrders.create).not.toHaveBeenCalled();
    expect(mocks.swapTransactionsService.setNeedsReview).toHaveBeenCalledWith(
      's1',
      true,
      expect.anything(),
    );

    const postAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((a: any) => a.action === AuditActions.SWAP_POST_APPROVAL_VERDICT);
    expect(postAudit).toBeDefined();
    expect(postAudit.metadata).toEqual({ verdict: 'rejected' });
  });

  // ── Review Fix 3 (Important): a sanction verdict landing after the swap ──
  // ── already entered PROCESSING must still restrict the PERSON, even though
  // ── the swap itself correctly keeps executing (already past the point of
  // ── no return — must not be unwound).
  it('PROCESSING + rejected (SANCTION) verdict → swap keeps executing, but the customer is still restricted (Review Fix 3)', async () => {
    const mocks = buildApplyKytVerdictMocks({ status: SwapTransactionStatus.PROCESSING });
    const service = makeApplyKytVerdictService(mocks);

    await service.applyKytVerdict('s1', { verdict: 'rejected', typedTags: ['SANCTION'] });

    // Swap itself is untouched — no state transition, no unwinding.
    expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
    // But the person is restricted exactly like a pre-PROCESSING rejection.
    expect(mocks.customerRestrictionsService.add).toHaveBeenCalledWith(
      'cust-1',
      ['SWAP', 'WITHDRAW'],
      'KYT_REJECTED',
      'system',
    );
    // Sanction hit — tipping-off silence still applies mid-swap.
    expect(await mocks.pendingActionService.get('cust-1')).toBeNull();
  });

  it('PROCESSING + approved verdict → disposition never runs (nothing to restrict)', async () => {
    const mocks = buildApplyKytVerdictMocks({ status: SwapTransactionStatus.PROCESSING });
    const service = makeApplyKytVerdictService(mocks);
    const dispositionSpy = jest.spyOn(service as any, 'handleRejectDisposition');

    await service.applyKytVerdict('s1', { verdict: 'approved' });

    expect(dispositionSpy).not.toHaveBeenCalled();
    expect(mocks.customerRestrictionsService.add).not.toHaveBeenCalled();
  });

  it('swap not found → no-op, does not throw', async () => {
    const mocks = buildApplyKytVerdictMocks();
    (mocks.swapTransactionsService.findByIdInternal as jest.Mock).mockResolvedValueOnce(null);
    const service = makeApplyKytVerdictService(mocks);

    await expect(service.applyKytVerdict('missing', { verdict: 'approved' })).resolves.toBeUndefined();
    expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
  });

  // ── transaction-boundary property (Task 4 review note) ──────────────────
  it('writes the compliance-verdict fields INSIDE the same $transaction as markStatus, not outside it', async () => {
    const mocks = buildApplyKytVerdictMocks();
    const service = makeApplyKytVerdictService(mocks);

    await service.applyKytVerdict('s1', { verdict: 'approved', detailRaw: { foo: 'bar' } });

    // The verdict write must land on the tx client (rolls back together with
    // markStatus if anything later in the same transaction throws) — never
    // on the top-level, non-transactional prisma client.
    expect(mocks.txClient.swapTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({
          complianceVerdict: 'approved',
          sumsubDetailJson: JSON.stringify({ foo: 'bar' }),
        }),
      }),
    );
    // The only non-transactional swapTransaction.update call is the buy-leg's
    // own sumsubTxnIdIn write (submitSumsubTxnIn), never the verdict fields.
    const topLevelUpdateCalls = (mocks.prisma.swapTransaction.update as jest.Mock).mock.calls;
    for (const [arg] of topLevelUpdateCalls) {
      expect(arg.data).not.toHaveProperty('complianceVerdict');
    }
  });

  // Mirror of the above for the rejected branch — this is the branch where a
  // stranded verdict (evidence written but the transaction rolls back before
  // markStatus/audit land) does the most damage, so it needs the same proof.
  it('rejected: also writes the compliance-verdict fields INSIDE the same $transaction as markStatus', async () => {
    const mocks = buildApplyKytVerdictMocks();
    const service = makeApplyKytVerdictService(mocks);

    await service.applyKytVerdict('s1', { verdict: 'rejected', detailRaw: { foo: 'bar' } });

    expect(mocks.txClient.swapTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({
          complianceVerdict: 'rejected',
          sumsubDetailJson: JSON.stringify({ foo: 'bar' }),
        }),
      }),
    );
    const topLevelUpdateCalls = (mocks.prisma.swapTransaction.update as jest.Mock).mock.calls;
    for (const [arg] of topLevelUpdateCalls) {
      expect(arg.data).not.toHaveProperty('complianceVerdict');
    }
  });

  // ── buy-leg submit (submitSumsubTxnIn) guards, mirroring submitSumsubTxnOut ──

  it('submitSumsubTxnIn is idempotent — no-ops when sumsubTxnIdIn is already set', async () => {
    const mocks = buildApplyKytVerdictMocks();
    (mocks.prisma.swapTransaction.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 's1', swapNo: 'SWP0001', sumsubTxnIdIn: 'already-submitted',
      toAsset: { currency: 'AED', type: 'FIAT' },
      customer: { sumsubApplicantId: 'applicant-1' },
    });
    const service = makeApplyKytVerdictService(mocks);

    await (service as any).submitSumsubTxnIn('s1');

    expect(mocks.sumsubTxnClient.submitTxn).not.toHaveBeenCalled();
    expect(mocks.prisma.swapTransaction.update).not.toHaveBeenCalled();
  });

  it('submitSumsubTxnIn skips (no submit) when the customer has no sumsubApplicantId', async () => {
    const mocks = buildApplyKytVerdictMocks();
    (mocks.prisma.swapTransaction.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 's1', swapNo: 'SWP0001', sumsubTxnIdIn: null,
      toAsset: { currency: 'AED', type: 'FIAT' },
      customer: { sumsubApplicantId: null },
    });
    const service = makeApplyKytVerdictService(mocks);

    await (service as any).submitSumsubTxnIn('s1');

    expect(mocks.sumsubTxnClient.submitTxn).not.toHaveBeenCalled();
  });

  it('a failing buy-leg submit is swallowed — approved swap already executed and must not be rolled back', async () => {
    const mocks = buildApplyKytVerdictMocks();
    (mocks.sumsubTxnClient.submitTxn as jest.Mock).mockRejectedValueOnce(new Error('sumsub down'));
    const service = makeApplyKytVerdictService(mocks);

    // Must resolve normally — the buy-leg failure must not propagate.
    await expect(service.applyKytVerdict('s1', { verdict: 'approved' })).resolves.toBeUndefined();
    // The status transition + leg1 already committed before the buy-leg call.
    expect(mocks.swapTransactionsService.markStatus).toHaveBeenCalledWith(
      's1',
      SwapTransactionAction.KYT_APPROVED,
      expect.anything(),
    );
    expect(mocks.fundsOrders.create).toHaveBeenCalledTimes(1);
  });

  // ── handleRejectDisposition (Task 7) — soft/hard line split + tipping-off ──
  //
  // The tipping-off decision is made exactly once, on the write side, inside
  // handleRejectDisposition. CustomerPendingActionService.get() (see
  // customer-pending-action.service.ts) is a dumb accessor with no logic of
  // its own — these tests read the disposition back through the REAL service
  // (not a mock) to prove the split actually happened on the write side, not
  // just that we asserted our own assumption back at ourselves. Nested here
  // (not a sibling top-level describe) so it can reuse
  // buildApplyKytVerdictMocks/makeApplyKytVerdictService via closure.
  describe('→ handleRejectDisposition (Task 7)', () => {
    it('软线（有 applicantActions，无 SANCTION）→ 写 restrictions(SWAP,WITHDRAW) + pendingAction 可见', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      await service.applyKytVerdict('s1', {
        verdict: 'rejected',
        applicantActions: [{ applicantActionId: 'A1', externalActionId: 'EA1' }],
      });

      expect(mocks.customerRestrictionsService.add).toHaveBeenCalledWith(
        'cust-1',
        ['SWAP', 'WITHDRAW'],
        'KYT_REJECTED',
        'system',
      );
      expect(await mocks.pendingActionService.get('cust-1')).toEqual({
        externalActionId: 'EA1',
        reason: 'KYT_REJECTED',
      });

      // Review Fix 4 (Minor): business key + which action was shown, both in
      // the audit trail — not just the UUID and a bare boolean.
      const dispositionAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
        .map((c) => c[0])
        .find((a: any) => a.action === AuditActions.SWAP_KYT_REJECTED_DISPOSED);
      expect(dispositionAudit.entityOwnerNo).toBe('C0001');
      expect(dispositionAudit.metadata.externalActionId).toBe('EA1');
    });

    it('硬线（SANCTION tag）→ 写 restrictions 但 pendingAction 为 null（tipping-off，即使有 action 也不暴露）', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      await service.applyKytVerdict('s1', {
        verdict: 'rejected',
        applicantActions: [{ applicantActionId: 'A1', externalActionId: 'EA1' }],
        typedTags: ['SANCTION'],
      });

      expect(mocks.customerRestrictionsService.add).toHaveBeenCalled();
      expect(await mocks.pendingActionService.get('cust-1')).toBeNull();
    });

    it('硬线（无 applicantActions）→ 写 restrictions，pendingAction 为 null（没有可做的动作，不给入口）', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      await service.applyKytVerdict('s1', { verdict: 'rejected', applicantActions: [] });

      expect(mocks.customerRestrictionsService.add).toHaveBeenCalled();
      expect(await mocks.pendingActionService.get('cust-1')).toBeNull();
    });

    it('降级覆盖：客户已有软线 pendingAction，之后一次硬线（SANCTION）裁决必须把它清空，不留旧入口', async () => {
      const mocks = buildApplyKytVerdictMocks();
      // Simulate a prior soft-line disposition that already stored a pendingAction.
      mocks.customerMainRow.pendingActionExternalId = 'STALE';
      mocks.customerMainRow.pendingActionReason = 'KYT_REJECTED';
      const service = makeApplyKytVerdictService(mocks);

      await service.applyKytVerdict('s1', {
        verdict: 'rejected',
        applicantActions: [{ applicantActionId: 'A2', externalActionId: 'EA2' }],
        typedTags: ['SANCTION'],
      });

      expect(await mocks.pendingActionService.get('cust-1')).toBeNull();
    });

    it('幂等：webhook 重投/人工重放 handleRejectDisposition 两次，restrictions 每次都调（Task 1 已证幂等）且 pendingAction 保持单一值，不讹误', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);
      const input = {
        verdict: 'rejected' as const,
        applicantActions: [{ applicantActionId: 'A1', externalActionId: 'EA1' }],
      };

      // Calls the private disposition method directly twice — this is the
      // scenario a manual replay tool would hit (applyKytVerdict's own
      // terminal-status guard would normally block a second webhook redelivery
      // once the swap is REJECTED; a direct replay of disposition itself must
      // still be safe).
      await (service as any).handleRejectDisposition(mocks.swapRow, input);
      await (service as any).handleRejectDisposition(mocks.swapRow, input);

      expect(mocks.customerRestrictionsService.add).toHaveBeenCalledTimes(2);
      expect(mocks.customerRestrictionsService.add).toHaveBeenNthCalledWith(
        1,
        'cust-1',
        ['SWAP', 'WITHDRAW'],
        'KYT_REJECTED',
        'system',
      );
      expect(mocks.customerRestrictionsService.add).toHaveBeenNthCalledWith(
        2,
        'cust-1',
        ['SWAP', 'WITHDRAW'],
        'KYT_REJECTED',
        'system',
      );
      // Re-running left exactly the same single pendingAction — not duplicated,
      // not nulled out by the replay.
      expect(await mocks.pendingActionService.get('cust-1')).toEqual({
        externalActionId: 'EA1',
        reason: 'KYT_REJECTED',
      });
    });

    it('审计记录能区分软硬线 —— reviewer 事后能看出客户是否被告知及原因', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      await service.applyKytVerdict('s1', {
        verdict: 'rejected',
        applicantActions: [{ applicantActionId: 'A1', externalActionId: 'EA1' }],
        typedTags: ['SANCTION'],
      });

      const dispositionAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
        .map((c) => c[0])
        .find((a: any) => a.action === AuditActions.SWAP_KYT_REJECTED_DISPOSED);
      expect(dispositionAudit).toBeDefined();
      expect(dispositionAudit.metadata).toMatchObject({ hasSanction: true, exposeToCustomer: false });
      expect(dispositionAudit.reason).toMatch(/not notified|tipping/i);
      // Review Fix 4 (Minor): business key present; no action id leaked into
      // metadata when nothing was actually shown to the customer.
      expect(dispositionAudit.entityOwnerNo).toBe('C0001');
      expect(dispositionAudit.metadata.externalActionId).toBeUndefined();
    });

    // ── Review Fix 2 (Important): the exact A-then-B cross-swap sequence ──
    // ── from the finding — swap A is hard-lined (SANCTION) first, correctly
    // ── silent; seconds later swap B (a DIFFERENT swap, same customer) gets
    // ── an independent soft-line rejection. Without the sticky marker, B's
    // ── own tags/actions alone would re-expose a re-verification entry point
    // ── for a customer who is under sanctions investigation.
    it('sticky 硬线：swap A 硬线（SANCTION）沉默之后，swap B（同客户，纯软线）到达也必须继续沉默', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);
      const swapA = { ...mocks.swapRow, id: 'sA', swapNo: 'SWP-A' };
      const swapB = { ...mocks.swapRow, id: 'sB', swapNo: 'SWP-B' };

      // Swap A: hard line via SANCTION tag — correctly silent.
      await (service as any).handleRejectDisposition(swapA, {
        verdict: 'rejected',
        typedTags: ['SANCTION'],
      });
      expect(await mocks.pendingActionService.get('cust-1')).toBeNull();

      // Swap B arrives seconds later: on its OWN merits this is a soft line
      // (an action is attached, no SANCTION tag on this particular verdict) —
      // last-writer-wins would incorrectly re-open the entry point here.
      await (service as any).handleRejectDisposition(swapB, {
        verdict: 'rejected',
        applicantActions: [{ applicantActionId: 'A2', externalActionId: 'EA2' }],
      });

      expect(await mocks.pendingActionService.get('cust-1')).toBeNull();
      const swapBAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
        .map((c) => c[0])
        .find((a: any) => a.action === AuditActions.SWAP_KYT_REJECTED_DISPOSED && a.entityId === 'sB');
      expect(swapBAudit.metadata).toMatchObject({ alreadyHardLined: true, exposeToCustomer: false });
      // The sticky marker itself is what makes the above hold — confirm it
      // actually got stamped by the SANCTION verdict (swap A), not by chance.
      expect(await mocks.pendingActionService.hasHardLineDisposition('cust-1')).toBe(true);
    });

    // ── Finding 3 (Minor, 终审): the sticky marker must be keyed on SANCTION
    // ── only, not on "this verdict happened to carry no applicantActions".
    // ── A no-actions hard line correctly exposes nothing for ITS OWN verdict,
    // ── but must not permanently silence the customer — the next, genuinely
    // ── independent soft-line rejection has to be exposed normally.
    it('无 applicantActions 的硬线不 sticky：同客户之后一笔独立软线裁决必须重新暴露入口（Finding 3）', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);
      const swapA = { ...mocks.swapRow, id: 'sA', swapNo: 'SWP-A' };
      const swapB = { ...mocks.swapRow, id: 'sB', swapNo: 'SWP-B' };

      // Swap A: hard line because Sumsub attached no applicantActions — NOT a
      // sanction hit. Correctly exposes nothing for this verdict.
      await (service as any).handleRejectDisposition(swapA, {
        verdict: 'rejected',
        applicantActions: [],
      });
      expect(await mocks.pendingActionService.get('cust-1')).toBeNull();
      // The no-actions case must NOT trip the sticky marker.
      expect(await mocks.pendingActionService.hasHardLineDisposition('cust-1')).toBe(false);

      // Swap B arrives later: a genuine, independent soft line — must be
      // exposed normally, not silenced forever by A's no-actions verdict.
      await (service as any).handleRejectDisposition(swapB, {
        verdict: 'rejected',
        applicantActions: [{ applicantActionId: 'A2', externalActionId: 'EA2' }],
      });

      expect(await mocks.pendingActionService.get('cust-1')).toEqual({
        externalActionId: 'EA2',
        reason: 'KYT_REJECTED',
      });
    });

    // ── Review Fix 1 (Important): a throw inside disposition must be visible
    // ── (audit + needsReview) AND still propagate so the caller's retry path
    // ── (the terminal-status guard carve-out proven above) actually gets a
    // ── chance to repair the customer's state on redelivery.
    it('处置失败：写 SWAP_KYT_REJECTED_DISPOSITION_FAILED 审计 + 打 needsReview，并把异常继续往外抛', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);
      (mocks.customerRestrictionsService.add as jest.Mock).mockRejectedValueOnce(
        new Error('SQLITE_BUSY: database is locked'),
      );

      await expect(
        (service as any).handleRejectDisposition(mocks.swapRow, {
          verdict: 'rejected' as const,
          typedTags: ['SANCTION'],
        }),
      ).rejects.toThrow('SQLITE_BUSY: database is locked');

      expect(mocks.swapTransactionsService.setNeedsReview).toHaveBeenCalledWith('s1', true);
      const failedAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
        .map((c) => c[0])
        .find((a: any) => a.action === AuditActions.SWAP_KYT_REJECTED_DISPOSITION_FAILED);
      expect(failedAudit).toBeDefined();
      expect(failedAudit.reason).toBe('SQLITE_BUSY: database is locked');
      expect(failedAudit.entityOwnerNo).toBe('C0001');
    });
  });
});
