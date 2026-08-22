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
import type { L1Snapshot } from '../shared/l1-gate/l1-gate.types';

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

  // B2: L1 闸门求值器。默认 PASS —— 既有 initiateSwap 用例全部照常走完。
  const l1Gate = {
    evaluate: jest.fn((): Promise<L1Snapshot> => Promise.resolve({
      evaluatedAt: '2026-08-22T00:00:00.000Z',
      domain: 'SWAP', verdict: 'PASS', holdReason: null, tradingTier: 'BASIC',
      checks: [],
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

  return { accountingService, swapQuoteService, swapTransactionsService, auditLogsService, eventEmitter, onboardingService, walletQuery, limitGateService, l1Gate, prisma, sumsubTxnClient };
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
    { resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }), assertCapability: jest.fn(), assertOffboardable: jest.fn() } as any, // customerAccessService
    {} as any, // materialRequests — not on this path
    {} as any, // materialRequestIssuer — not on this path
    mocks.l1Gate as any,
  );
}

// ── initiateSwap ─────────────────────────────────────────────────────────────

// B2（第四批）：把兑换的逐项 L1 判定落成可回显的快照。
// ⚠️ 订正（B2 审查）：兑换域**并非**此前没有资格 / 限制判定 —— initiateSwap 起手
// 的 assertTradingEligibility(:210) 内部就是 assertCapability(资格+限制)，且对非
// DEPOSIT 还多跑一层 assertTradingReady，严格强于 L1 这两项；该调用自 04433cdd
// (2026-05-31) 起就在。被便签摁住 SWAP 的客户拿到的一直是 403 CAPABILITY_RESTRICTED，
// 从来兑换不了。下面 BLOCK 分支覆盖的是 :210 与 :249 之间的毫秒级竞态窗口（兜底），
// 与提现侧完全同构。
describe('B2 · 兑换 L1 资格闸', () => {
  it('L1 verdict=BLOCK 时不建单、不消费报价', async () => {
    const mocks = buildMocks(makeQuote());
    mocks.l1Gate.evaluate.mockResolvedValue({
      evaluatedAt: '2026-08-22T00:00:00.000Z',
      domain: 'SWAP', verdict: 'BLOCK', holdReason: null, tradingTier: 'BASIC',
      checks: [{ code: 'CUSTOMER_RESTRICTION', outcome: 'FAIL', detail: 'blocked' }],
    });
    const service = makeService(mocks);

    await expect(service.initiateSwap('c1', 'q1')).rejects.toThrow();

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.swapQuoteService.consumeQuote).not.toHaveBeenCalled();
    expect(mocks.swapTransactionsService.create).not.toHaveBeenCalled();
  });

  it('BLOCK 的拒绝理由是中性文案 —— 不透出 cause / visibility（tipping-off 防线）', async () => {
    const mocks = buildMocks(makeQuote());
    mocks.l1Gate.evaluate.mockResolvedValue({
      evaluatedAt: '2026-08-22T00:00:00.000Z',
      domain: 'SWAP', verdict: 'BLOCK', holdReason: null, tradingTier: 'BASIC',
      checks: [{ code: 'CUSTOMER_RESTRICTION', outcome: 'FAIL', detail: '客户被限制账摁住 SWAP 能力' }],
    });
    const service = makeService(mocks);

    const err: any = await service.initiateSwap('c1', 'q1').catch((e) => e);
    const body = err?.getResponse ? err.getResponse() : err;
    expect(body.code).toBe('L1_GATE_BLOCKED');
    expect(body.message).toBe('This operation is not available for your account at the moment.');
    expect(JSON.stringify(body)).not.toMatch(/SANCTION|RESTRICTION|限制|便签/);
  });

  it('L1 verdict=PASS 时快照写进建单入参', async () => {
    const mocks = buildMocks(makeQuote());
    mocks.l1Gate.evaluate.mockResolvedValue({
      evaluatedAt: '2026-08-22T00:00:00.000Z',
      domain: 'SWAP', verdict: 'PASS', holdReason: null, tradingTier: 'PREMIUM',
      checks: [],
    });
    const service = makeService(mocks);

    await service.initiateSwap('c1', 'q1');

    expect(mocks.swapTransactionsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ l1Snapshot: expect.stringContaining('"tradingTier":"PREMIUM"') }),
      expect.anything(),
    );
  });

  it('调用方判过的项作为 preChecks 收进 L1（且不传自判的资格/限制两项）', async () => {
    const mocks = buildMocks(makeQuote());
    const service = makeService(mocks);

    await service.initiateSwap('cust-1', 'quote-1');

    const arg = (mocks.l1Gate.evaluate as jest.Mock).mock.calls[0][0];
    expect(arg.domain).toBe('SWAP');
    expect(arg.customerId).toBe('cust-1');
    const codes = arg.preChecks.map((c: any) => c.code);
    expect(codes).toEqual([
      'SINGLE_LIMIT', 'CUMULATIVE_LIMIT', 'QUOTE_VALIDITY',
      'ACCOUNT_READINESS', 'TRADING_READINESS',
    ]);
    // 自判的资格/限制两项永远由 L1GateService 自己算，调用方不许传
    expect(codes).not.toContain('CUSTOMER_ELIGIBILITY');
    expect(codes).not.toContain('CUSTOMER_RESTRICTION');
    // 这一刻没人判过余额 → 不传，留给 L1GateService 落 SKIPPED（不许盖 PASS 的章）
    expect(codes).not.toContain('BALANCE_SUFFICIENCY');
  });
});

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
    // parity 2026-08-14：证据四件套原子写（与 markStatus 同事务）
    saveSumsubVerdict: jest.fn(() => Promise.resolve()),
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
    { resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }), assertCapability: jest.fn(), assertOffboardable: jest.fn() } as any, // customerAccessService
    {} as any, // materialRequests — not on this path
    {} as any, // materialRequestIssuer — not on this path
    {} as any, // l1Gate — not on this path (advanceLeg 不建单)
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

import { CustomersService } from '../../identity/customers/customers.service';

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
      // parity 2026-08-14：证据四件套原子写（与 markStatus 同事务）
      saveSumsubVerdict: jest.fn(() => Promise.resolve()),
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
      // Task 10: handleRejectDisposition looks the customer up directly off
      // this (the workflow's own injected) prisma to grab sumsubApplicantId
      // before registering material requests — same applicant id as the
      // swapTransaction.findUnique fixture above, for consistency.
      customerMain: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(
            where.id === 'cust-1' ? { id: 'cust-1', sumsubApplicantId: 'applicant-1' } : null,
          ),
        ),
      },
    };

    // Task 7: CustomerRestrictionsService stays a jest mock here — its own
    // idempotency (dedup per capability) is already proven in
    // customer-restrictions.service.spec.ts (Task 1); these tests only need
    // to assert swap-workflow *calls* it correctly.
    const customerRestrictionsService = {
      open: jest.fn(() =>
        Promise.resolve({ restrictionNo: 'RST2608160001', created: true }),
      ),
    };

    // Task 7 (Task 12: moved to CustomersService): hasHardLineDisposition/
    // markHardLineDisposition is the REAL implementation wired to a small
    // stateful customerMain fake, not a jest mock. The whole point of the
    // tipping-off split is that the sticky marker is a dumb read/write pair
    // with no other logic of its own — mocking it would just assert our own
    // assumption back at us instead of proving the write landed right.
    // Deliberately a separate prisma-like object from `prisma` above (real
    // production code injects two separate services, both ultimately backed
    // by the same PrismaService — test isolation mirrors that).
    const customerMainRow: any = {
      id: 'cust-1',
      customerNo: 'C0001',
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
    const pendingActionService = new CustomersService(pendingActionPrisma, { recordByActor: jest.fn(), recordSystem: jest.fn() } as any);

    // Task 10: materialRequests/materialRequestIssuer are wired together
    // through a shared in-memory array so listLiveByOrder() actually reflects
    // what register() has "persisted" — needed to prove the retry-dedup guard
    // (handleRejectDisposition skips externalActionIds already registered)
    // rather than just asserting our own mock calls back at ourselves.
    const registeredMaterialRequests: Array<{ orderDomain: string; orderRef: string; externalActionId: string }> = [];
    const materialRequests = {
      listLiveByOrder: jest.fn((orderDomain: string, orderRef: string) =>
        Promise.resolve(
          registeredMaterialRequests.filter(
            (r) => r.orderDomain === orderDomain && r.orderRef === orderRef,
          ),
        ),
      ),
    };
    const materialRequestIssuer = {
      register: jest.fn((input: any) => {
        registeredMaterialRequests.push({
          orderDomain: input.orderDomain,
          orderRef: input.orderRef,
          externalActionId: input.externalActionId,
        });
        return Promise.resolve({
          requestNo: `MRQ${registeredMaterialRequests.length}`,
          restrictionNo: null,
        });
      }),
    };

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
      materialRequests,
      materialRequestIssuer,
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
      { resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }), assertCapability: jest.fn(), assertOffboardable: jest.fn() } as any, // customerAccessService
      mocks.materialRequests as any,
      mocks.materialRequestIssuer as any,
      {} as any, // l1Gate — not on this path (applyKytVerdict 不建单)
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

    const input = { verdict: 'rejected' as const, typedTags: ['SANCTION_APPLICANT'] };
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

  // ── 第一批 (2026-08-19): 忽略 ≠ 静默 ─────────────────────────────────
  it('B3: SUCCESS 收到迟到 approved → 写 IGNORED 审计、不动订单', async () => {
    const mocks = buildApplyKytVerdictMocks({ status: SwapTransactionStatus.SUCCESS });
    const service = makeApplyKytVerdictService(mocks);

    await service.applyKytVerdict('s1', { verdict: 'approved' });

    expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
    expect(mocks.swapTransactionsService.saveSumsubVerdict).not.toHaveBeenCalled();
    expect(mocks.auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.SWAP_KYT_VERDICT_IGNORED,
        entityNo: 'SWP0001',
      }),
    );
  });

  it('B3: REJECTED 收到迟到 rejected → 仍跑处置，且【不】写 IGNORED（carve-out 保留）', async () => {
    const mocks = buildApplyKytVerdictMocks({ status: SwapTransactionStatus.REJECTED });
    const service = makeApplyKytVerdictService(mocks);

    await service.applyKytVerdict('s1', { verdict: 'rejected', typedTags: ['SANCTION_APPLICANT'] });

    expect(mocks.auditLogsService.recordSystem).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.SWAP_KYT_VERDICT_IGNORED }),
    );
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

    const input = { verdict: 'rejected' as const, typedTags: ['SANCTION_APPLICANT'] };
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

    const input = { verdict: 'rejected' as const, typedTags: ['SANCTION_APPLICANT'] };
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

  it('SUCCESS + rejected (SANCTION_APPLICANT) verdict → completed swap stays fully untouched, but the customer is still restricted (Finding 2)', async () => {
    const mocks = buildApplyKytVerdictMocks({ status: SwapTransactionStatus.SUCCESS });
    const service = makeApplyKytVerdictService(mocks);

    await service.applyKytVerdict('s1', { verdict: 'rejected', typedTags: ['SANCTION_APPLICANT'] });

    expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
    expect(mocks.fundsOrders.create).not.toHaveBeenCalled();
    // Task 8：制裁命中 → 贴 SANCTION 便签（SILENT / 卡全部能力 / 只能 MLRO 解）。
    // scopes 不传：SANCTION 的 scopeSelectable=false，由注册表带出。
    expect(mocks.customerRestrictionsService.open).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-1',
        cause: 'SANCTION',
        openedBy: 'system',
      }),
    );
    // Sanction hit — tipping-off silence still applies against a completed swap:
    // 一条材料请求都不登记（Task 10：不再写 customer_main 单指针）。
    expect(mocks.materialRequestIssuer.register).not.toHaveBeenCalled();
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
      service.applyKytVerdict('s1', { verdict: 'rejected', typedTags: ['SANCTION_APPLICANT'] }),
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
  it('PROCESSING + rejected (SANCTION_APPLICANT) verdict → swap keeps executing, but the customer is still restricted (Review Fix 3)', async () => {
    const mocks = buildApplyKytVerdictMocks({ status: SwapTransactionStatus.PROCESSING });
    const service = makeApplyKytVerdictService(mocks);

    await service.applyKytVerdict('s1', { verdict: 'rejected', typedTags: ['SANCTION_APPLICANT'] });

    // Swap itself is untouched — no state transition, no unwinding.
    expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
    // But the person is restricted exactly like a pre-PROCESSING rejection.
    // Task 8：制裁命中 → 贴 SANCTION 便签（SILENT / 卡全部能力 / 只能 MLRO 解）。
    // scopes 不传：SANCTION 的 scopeSelectable=false，由注册表带出。
    expect(mocks.customerRestrictionsService.open).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-1',
        cause: 'SANCTION',
        openedBy: 'system',
      }),
    );
    // Sanction hit — tipping-off silence still applies mid-swap: 一条材料请求
    // 都不登记（Task 10：不再写 customer_main 单指针）。
    expect(mocks.materialRequestIssuer.register).not.toHaveBeenCalled();
  });

  it('PROCESSING + approved verdict → disposition never runs (nothing to restrict)', async () => {
    const mocks = buildApplyKytVerdictMocks({ status: SwapTransactionStatus.PROCESSING });
    const service = makeApplyKytVerdictService(mocks);
    const dispositionSpy = jest.spyOn(service as any, 'handleRejectDisposition');

    await service.applyKytVerdict('s1', { verdict: 'approved' });

    expect(dispositionSpy).not.toHaveBeenCalled();
    expect(mocks.customerRestrictionsService.open).not.toHaveBeenCalled();
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

    await service.applyKytVerdict('s1', {
      verdict: 'approved',
      riskScore: 10,
      detailRaw: { foo: 'bar' },
    });

    // parity 2026-08-14：证据写经 saveSumsubVerdict(swapId, evidence, tx)。
    // 原子性证明拆两层——本层断言"收到的是与 markStatus 同一个 tx client"；
    // "它确实写在传入 tx 上"由 swap-transactions.service.spec 的
    // saveSumsubVerdict 单测钉住。两层合起来等价于旧断言。
    const saveCall = (mocks.swapTransactionsService.saveSumsubVerdict as jest.Mock).mock.calls[0];
    expect(saveCall[0]).toBe('s1');
    expect(saveCall[1]).toEqual(
      expect.objectContaining({
        verdict: 'approved',
        score: 10,
        detailJson: JSON.stringify({ foo: 'bar' }),
      }),
    );
    expect(saveCall[1].scoredAt).toBeInstanceOf(Date);
    expect(saveCall[2]).toBe(mocks.txClient); // 与 markStatus 同事务
    const markCall = (mocks.swapTransactionsService.markStatus as jest.Mock).mock.calls[0];
    expect(markCall[2]).toBe(mocks.txClient);
    // 顶层非事务 client 上绝不落 verdict 字段（buy 腿的 sumsubTxnIdIn 写除外）。
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

    await service.applyKytVerdict('s1', {
      verdict: 'rejected',
      riskScore: 88,
      detailRaw: { foo: 'bar' },
    });

    // 同 approved 支：saveSumsubVerdict 收到与 markStatus 同一个 tx（原子性
    // 的另一半由 service 单测钉住）。rejected 是"证据落了状态却没落"伤害最大
    // 的分支，故同样必须证明。
    const saveCall = (mocks.swapTransactionsService.saveSumsubVerdict as jest.Mock).mock.calls[0];
    expect(saveCall[0]).toBe('s1');
    expect(saveCall[1]).toEqual(
      expect.objectContaining({
        verdict: 'rejected',
        score: 88,
        detailJson: JSON.stringify({ foo: 'bar' }),
      }),
    );
    expect(saveCall[2]).toBe(mocks.txClient);
    const markCall = (mocks.swapTransactionsService.markStatus as jest.Mock).mock.calls[0];
    expect(markCall[2]).toBe(mocks.txClient);
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
  // handleRejectDisposition. CustomersService.hasHardLineDisposition is a
  // dumb accessor with no logic of its own — these tests read the
  // disposition back through the REAL service (not a mock) to prove the
  // split actually happened on the write side, not just that we asserted our
  // own assumption back at ourselves. Nested here (not a sibling top-level
  // describe) so it can reuse buildApplyKytVerdictMocks/makeApplyKytVerdictService
  // via closure.
  describe('→ handleRejectDisposition (Task 7 disposition split, Task 10 material requests)', () => {
    it('软线（有 applicantActions，无 SANCTION）→ 写 restrictions(SWAP,WITHDRAW) + 登记材料请求', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      await service.applyKytVerdict('s1', {
        verdict: 'rejected',
        applicantActions: [{ applicantActionId: 'A1', externalActionId: 'EA1' }],
      });

      // Task 8：软线 → KYT_REJECTED_SOFT（DISCLOSED，客户看得见 "Verification required"）。
      // caseRef=swapNo，便于按单撕。scopes 不传，由注册表带出 SWAP+WITHDRAW。
      expect(mocks.customerRestrictionsService.open).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-1',
          cause: 'KYT_REJECTED_SOFT',
          caseRef: 'SWP0001',
          openedBy: 'system',
        }),
      );
      // Task 10：不再写 customer_main 单指针，改登记材料账一行——restrict:false
      // 因为限制便签已经在上面 open() 过了，这里不重复开。
      // 2026-08-18 修复：restrict:false 不代表"不接便签"——existingRestrictionNo
      // 必须等于 open() 刚刚返回的那个 restrictionNo，否则 GREEN 复核时
      // autoRelease 永远读不到便签、客户交齐材料后限制原地不动、永久卡死
      // （本次要修的 Critical）。
      expect(mocks.materialRequestIssuer.register).toHaveBeenCalledTimes(1);
      expect(mocks.materialRequestIssuer.register).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-1',
          sumsubApplicantId: 'applicant-1',
          materialType: 'SOURCE_OF_FUNDS',
          applicantActionId: 'A1',
          externalActionId: 'EA1',
          orderDomain: 'SWAP',
          orderRef: 'SWP0001',
          origin: 'SUMSUB_PUSHED',
          restrict: false,
          existingRestrictionNo: 'RST2608160001',
        }),
      );

      // Review Fix 4 (Minor): business key + which actions were shown, both in
      // the audit trail — not just the UUID and a bare boolean. Amended
      // 2026-08-18: metadata now records every action, not just actions[0]
      // (that "only actions[0]" pattern is the exact bug class this task fixes).
      const dispositionAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
        .map((c) => c[0])
        .find((a: any) => a.action === AuditActions.SWAP_KYT_REJECTED_DISPOSED);
      expect(dispositionAudit.entityOwnerNo).toBe('C0001');
      expect(dispositionAudit.metadata.actionIds).toEqual(['EA1']);
    });

    // 单指针病的直接反证：旧写法 `actions[0]!.externalActionId` 只取第一条，
    // 后面两条直接丢。现在一条 action 一行，逐条登记，一条都不能少。
    it('软线拒：报文带三条 action → 逐条登记，不再只取第一条（单指针病的直接反证）', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      await service.applyKytVerdict('s1', {
        verdict: 'rejected',
        applicantActions: [
          { applicantActionId: 'A1', externalActionId: 'EA1' },
          { applicantActionId: 'A2', externalActionId: 'EA2' },
          { applicantActionId: 'A3', externalActionId: 'EA3' },
        ],
      });

      expect(mocks.materialRequestIssuer.register).toHaveBeenCalledTimes(3);
      const registeredCalls = (mocks.materialRequestIssuer.register as jest.Mock).mock.calls.map((c) => c[0]);
      expect(registeredCalls.map((c: any) => c.externalActionId)).toEqual(['EA1', 'EA2', 'EA3']);
      // 三条都必须接同一张便签（open() 只开了一次）——不是三张便签各配一条。
      for (const call of registeredCalls) {
        expect(call.existingRestrictionNo).toBe('RST2608160001');
      }

      const dispositionAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
        .map((c) => c[0])
        .find((a: any) => a.action === AuditActions.SWAP_KYT_REJECTED_DISPOSED);
      expect(dispositionAudit.metadata.actionIds).toEqual(['EA1', 'EA2', 'EA3']);
    });

    it('硬线（SANCTION_APPLICANT tag）→ 写 restrictions，一条材料请求都不登记，且盖 sticky 硬线章（tipping-off，即使有 action 也不暴露）', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      await service.applyKytVerdict('s1', {
        verdict: 'rejected',
        applicantActions: [
          { applicantActionId: 'A1', externalActionId: 'EA1' },
          { applicantActionId: 'A2', externalActionId: 'EA2' },
        ],
        typedTags: ['SANCTION_APPLICANT'],
      });

      expect(mocks.customerRestrictionsService.open).toHaveBeenCalled();
      // 硬线拒：一条都不登记 —— 客户端结构上没有入口。
      expect(mocks.materialRequestIssuer.register).not.toHaveBeenCalled();
      expect(await mocks.pendingActionService.hasHardLineDisposition('cust-1')).toBe(true);
    });

    it('硬线（无 applicantActions）→ 写 restrictions，不登记材料请求，也不盖 sticky 章（没有可做的动作，不给入口）', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      await service.applyKytVerdict('s1', { verdict: 'rejected', applicantActions: [] });

      expect(mocks.customerRestrictionsService.open).toHaveBeenCalled();
      expect(mocks.materialRequestIssuer.register).not.toHaveBeenCalled();
      // 无 action 的硬线不是制裁，不该永久沉默这个客户（Finding 3）。
      expect(await mocks.pendingActionService.hasHardLineDisposition('cust-1')).toBe(false);
    });

    it('客户已有一笔来自前一笔软线 swap 的材料请求，之后一次硬线（SANCTION_APPLICANT）裁决不登记新材料请求、也不影响那一行', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      // 先来一笔软线拒，登记一行材料请求。
      await (service as any).handleRejectDisposition(mocks.swapRow, {
        verdict: 'rejected' as const,
        applicantActions: [{ applicantActionId: 'A1', externalActionId: 'EA1' }],
      });
      expect(mocks.materialRequestIssuer.register).toHaveBeenCalledTimes(1);

      // 同客户第二笔单命中制裁——旧写法这里会 set(null) 把上一笔的软线指针整个
      // 盖掉；材料账下软线登记的是"属于那笔单"的行，不会被这笔硬线单波及，所以
      // 唯一可断言的是"这次硬线不新增登记"。
      const swapB = { ...mocks.swapRow, id: 'sB', swapNo: 'SWP-B' };
      await (service as any).handleRejectDisposition(swapB, {
        verdict: 'rejected' as const,
        applicantActions: [{ applicantActionId: 'A2', externalActionId: 'EA2' }],
        typedTags: ['SANCTION_APPLICANT'],
      });

      expect(mocks.materialRequestIssuer.register).toHaveBeenCalledTimes(1);
    });

    it('幂等：webhook 重投/人工重放 handleRejectDisposition 两次，restrictions 每次都调（Task 1 已证幂等），材料请求只登记一次（不撞 externalActionId 唯一键）', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);
      const input = {
        verdict: 'rejected' as const,
        applicantActions: [{ applicantActionId: 'A1', externalActionId: 'EA1' }],
      };

      // Calls the private disposition method directly twice — this is the
      // scenario a manual replay tool (or an ingestion retry after a partial
      // failure) would hit (applyKytVerdict's own terminal-status guard would
      // normally block a second webhook redelivery once the swap is
      // REJECTED; a direct replay of disposition itself must still be safe).
      await (service as any).handleRejectDisposition(mocks.swapRow, input);
      await (service as any).handleRejectDisposition(mocks.swapRow, input);

      expect(mocks.customerRestrictionsService.open).toHaveBeenCalledTimes(2);
      // 两次都调 open —— 幂等由限制账自己保证（同 customerId+cause+caseRef
      // 第二次返回 created:false，不会贴出第二张，已在 Task 3 的 spec 里证过）。
      for (const nth of [1, 2]) {
        expect(mocks.customerRestrictionsService.open).toHaveBeenNthCalledWith(
          nth,
          expect.objectContaining({
            customerId: 'cust-1',
            cause: 'KYT_REJECTED_SOFT',
            caseRef: 'SWP0001',
            openedBy: 'system',
          }),
        );
      }
      // register() 不像旧 set() 天然幂等——externalActionId 撞了会抛 P2002。
      // 第二次重放必须被 listLiveByOrder 的 dedup 挡掉，不能再调 register。
      expect(mocks.materialRequestIssuer.register).toHaveBeenCalledTimes(1);
    });

    it('审计记录能区分软硬线 —— reviewer 事后能看出客户是否被告知及原因', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      await service.applyKytVerdict('s1', {
        verdict: 'rejected',
        applicantActions: [{ applicantActionId: 'A1', externalActionId: 'EA1' }],
        typedTags: ['SANCTION_APPLICANT'],
      });

      const dispositionAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
        .map((c) => c[0])
        .find((a: any) => a.action === AuditActions.SWAP_KYT_REJECTED_DISPOSED);
      expect(dispositionAudit).toBeDefined();
      expect(dispositionAudit.metadata).toMatchObject({ hasSanction: true, exposeToCustomer: false });
      expect(dispositionAudit.reason).toMatch(/not notified|tipping/i);
      // Review Fix 4 (Minor): business key present; no action ids leaked into
      // metadata when nothing was actually shown to the customer.
      expect(dispositionAudit.entityOwnerNo).toBe('C0001');
      expect(dispositionAudit.metadata.actionIds).toBeUndefined();
    });

    // ── Review Fix 2 (Important): the exact A-then-B cross-swap sequence ──
    // ── from the finding — swap A is hard-lined (SANCTION_APPLICANT) first, correctly
    // ── silent; seconds later swap B (a DIFFERENT swap, same customer) gets
    // ── an independent soft-line rejection. Without the sticky marker, B's
    // ── own tags/actions alone would re-expose a re-verification entry point
    // ── for a customer who is under sanctions investigation.
    it('sticky 硬线：swap A 硬线（SANCTION_APPLICANT）沉默之后，swap B（同客户，纯软线）到达也必须继续沉默', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);
      const swapA = { ...mocks.swapRow, id: 'sA', swapNo: 'SWP-A' };
      const swapB = { ...mocks.swapRow, id: 'sB', swapNo: 'SWP-B' };

      // Swap A: hard line via SANCTION_APPLICANT tag — correctly silent.
      await (service as any).handleRejectDisposition(swapA, {
        verdict: 'rejected',
        typedTags: ['SANCTION_APPLICANT'],
      });
      expect(mocks.materialRequestIssuer.register).not.toHaveBeenCalled();

      // Swap B arrives seconds later: on its OWN merits this is a soft line
      // (an action is attached, no SANCTION_APPLICANT tag on this particular verdict) —
      // last-writer-wins would incorrectly re-open the entry point here.
      await (service as any).handleRejectDisposition(swapB, {
        verdict: 'rejected',
        applicantActions: [{ applicantActionId: 'A2', externalActionId: 'EA2' }],
      });

      // 全程一条材料请求都没登记过——sticky 标记压住了 swap B 本可暴露的软线。
      expect(mocks.materialRequestIssuer.register).not.toHaveBeenCalled();
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
      expect(mocks.materialRequestIssuer.register).not.toHaveBeenCalled();
      // The no-actions case must NOT trip the sticky marker.
      expect(await mocks.pendingActionService.hasHardLineDisposition('cust-1')).toBe(false);

      // Swap B arrives later: a genuine, independent soft line — must be
      // exposed normally, not silenced forever by A's no-actions verdict.
      await (service as any).handleRejectDisposition(swapB, {
        verdict: 'rejected',
        applicantActions: [{ applicantActionId: 'A2', externalActionId: 'EA2' }],
      });

      expect(mocks.materialRequestIssuer.register).toHaveBeenCalledTimes(1);
      expect(mocks.materialRequestIssuer.register).toHaveBeenCalledWith(
        expect.objectContaining({ externalActionId: 'EA2', orderDomain: 'SWAP', orderRef: 'SWP-B' }),
      );
    });

    // ── fail-safe 顺序（load-bearing，不许调换）：登记材料请求 = 暴露入口，
    // ── 必须排在限制便签 open() 之后。崩在中间时客户「已被限制、只是暂时看不到
    // ── 入口」是保守的；反过来会出现「入口已暴露但限制没落地」的危险窗口。
    it('fail-safe 顺序：open 便签的调用发生在 register 之前', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      await service.applyKytVerdict('s1', {
        verdict: 'rejected',
        applicantActions: [{ applicantActionId: 'A1', externalActionId: 'EA1' }],
      });

      const openOrder = (mocks.customerRestrictionsService.open as jest.Mock).mock.invocationCallOrder[0];
      const registerOrder = (mocks.materialRequestIssuer.register as jest.Mock).mock.invocationCallOrder[0];
      expect(openOrder).toBeLessThan(registerOrder);
    });

    // ── Review Fix 1 (Important): a throw inside disposition must be visible
    // ── (audit + needsReview) AND still propagate so the caller's retry path
    // ── (the terminal-status guard carve-out proven above) actually gets a
    // ── chance to repair the customer's state on redelivery.
    it('处置失败：写 SWAP_KYT_REJECTED_DISPOSITION_FAILED 审计 + 打 needsReview，并把异常继续往外抛', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);
      (mocks.customerRestrictionsService.open as jest.Mock).mockRejectedValueOnce(
        new Error('SQLITE_BUSY: database is locked'),
      );

      await expect(
        (service as any).handleRejectDisposition(mocks.swapRow, {
          verdict: 'rejected' as const,
          typedTags: ['SANCTION_APPLICANT'],
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

  // ── 2026-08-20 制裁分主体（命门）───────────────────────────────────────
  // handleRejectDisposition 里的 `(input.typedTags ?? []).includes('SANCTION_APPLICANT')`
  // 吃的是已经 map 成 string[] 的 typedTags，includes 对任意字符串都合法，
  // TypeScript 抓不到写错的标签名。写错 → hasSanction 恒 false →
  // restrictionCause 掉进 KYT_REJECTED_SOFT → markHardLineDisposition 不盖章
  // → 走软线开出面向客户的补料请求 → tipping-off，而构建和测试全绿、零日志。
  // 这组测试就是为钉死这一行存在的 —— 改那一行必须回看这里。
  describe('handleRejectDisposition · 制裁主体判定（命门）', () => {
    it('SANCTION_APPLICANT → cause=SANCTION，且不暴露补料入口', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      await (service as any).handleRejectDisposition(mocks.swapRow, {
        verdict: 'rejected',
        typedTags: ['SANCTION_APPLICANT'],
        applicantActions: [{ applicantActionId: 'a1', externalActionId: 'e1' }],
      });

      expect(mocks.customerRestrictionsService.open).toHaveBeenCalledWith(
        expect.objectContaining({ cause: 'SANCTION' }),
      );
      // tipping-off：命中制裁绝不能登记面向客户的材料请求。
      expect(mocks.materialRequestIssuer.register).not.toHaveBeenCalled();
    });

    it('SANCTION_COUNTERPARTY → 不是硬线制裁，走软线（有 action 时暴露补料入口）', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      await (service as any).handleRejectDisposition(mocks.swapRow, {
        verdict: 'rejected',
        typedTags: ['SANCTION_COUNTERPARTY'],
        applicantActions: [{ applicantActionId: 'a1', externalActionId: 'e1' }],
      });

      expect(mocks.customerRestrictionsService.open).toHaveBeenCalledWith(
        expect.objectContaining({ cause: 'KYT_REJECTED_SOFT' }),
      );
    });

    it('旧标签 SANCTION 已退役 —— 不得再被识别成制裁', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      await (service as any).handleRejectDisposition(mocks.swapRow, {
        verdict: 'rejected',
        typedTags: ['SANCTION'],
        applicantActions: [{ applicantActionId: 'a1', externalActionId: 'e1' }],
      });

      expect(mocks.customerRestrictionsService.open).not.toHaveBeenCalledWith(
        expect.objectContaining({ cause: 'SANCTION' }),
      );
    });
  });

  // ── Task 9: FROZEN 落地 —— 本单裁决驱动 + 幂等闸 ─────────────────────────
  describe('FROZEN 落地（Task 9）', () => {
    // Guards against the exact production bug this task's implementation
    // uncovered: applyKytVerdict's plain-reject tail used to unconditionally
    // markStatus(KYT_REJECTED) BEFORE calling handleRejectDisposition, so a
    // hasSanction FREEZE attempted from inside handleRejectDisposition would
    // land on an already-REJECTED (zero-out-edge) row and throw
    // `Invalid transition: REJECTED + freeze`. The fix makes the tail skip
    // its own KYT_REJECTED transition when hasSanction, so FREEZE is the
    // ONLY transition attempted, straight off COMPLIANCE_PENDING.
    it('COMPLIANCE_PENDING 单 + 本单 SANCTION_APPLICANT 裁决 → markStatus(FREEZE)，且写了 SWAP_FROZEN 审计', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      await service.applyKytVerdict('s1', { verdict: 'rejected', typedTags: ['SANCTION_APPLICANT'] });

      expect(mocks.swapTransactionsService.markStatus).toHaveBeenCalledWith(
        's1',
        SwapTransactionAction.FREEZE,
        expect.anything(),
        { rejectReason: 'SANCTION_APPLICANT' },
      );
      // Exactly the FREEZE transition, never KYT_REJECTED for a sanction hit —
      // proves the tail's own KYT_REJECTED branch was skipped, not just that
      // FREEZE also happened to fire alongside it.
      expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalledWith(
        's1',
        SwapTransactionAction.KYT_REJECTED,
        expect.anything(),
        expect.anything(),
      );
      expect(mocks.swapTransactionsService.markStatus).toHaveBeenCalledTimes(1);

      const frozenAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
        .map((c) => c[0])
        .find((a: any) => a.action === AuditActions.SWAP_FROZEN);
      expect(frozenAudit).toBeDefined();
      expect(frozenAudit.entityId).toBe('s1');
      expect(frozenAudit.entityNo).toBe('SWP0001');
      expect(frozenAudit.entityOwnerType).toBe('CUSTOMER');
      expect(frozenAudit.entityOwnerId).toBe('cust-1');
      expect(frozenAudit.entityOwnerNo).toBe('C0001');
      expect(frozenAudit.workflowType).toBeDefined();
    });

    // 2026-08-20 Review Important Fix：applyKytVerdict 顶部（:501）读出的 swap
    // 是陈旧快照 —— onCustomerRestrictionOpened 广播 handler（同一次 open()
    // 触发）可能在本单自己的 markStatus(FREEZE) 之前抢先把它冻上。此时
    // markStatus 会撞 `Invalid transition: FROZEN + freeze`。修复前，这个异常
    // 会被 handleRejectDisposition 外层 try/catch 当成整段处置失败：sticky
    // 硬线章（markHardLineDisposition）与 SWAP_KYT_REJECTED_DISPOSED 审计全部
    // 被跳过，还会写 DISPOSITION_FAILED + needsReview + rethrow，导致 webhook
    // 重投一进门撞上 FROZEN 幂等闸被 IGNORE —— sticky 章永远补不上，
    // tipping-off 防线失效。这条用例钉死修复后的行为：判成良性竞态、
    // 不上抛、后面该做的都照常做。
    it('markStatus(FREEZE) 抛 Invalid transition 且重读发现该行已是 FROZEN（被广播抢先冻上）→ 判良性竞态：不上抛，sticky 硬线章与 SWAP_KYT_REJECTED_DISPOSED 审计仍照常执行', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      // 唯一一次 markStatus 调用就是这里的 FREEZE 尝试（hasSanction 时
      // applyKytVerdict 顶部的 $transaction 会跳过自己的 KYT_REJECTED
      // markStatus，见生产代码 :668 `if (hasSanction) return;`）。模拟它撞上
      // 广播抢先冻单：先把行的状态改成 FROZEN（模拟广播那条链已经真冻上了），
      // 再抛 Invalid transition。
      mocks.swapTransactionsService.markStatus.mockImplementationOnce(() => {
        mocks.swapRow.status = SwapTransactionStatus.FROZEN;
        return Promise.reject(new BadRequestException('Invalid transition: FROZEN + freeze'));
      });

      await expect(
        service.applyKytVerdict('s1', {
          verdict: 'rejected',
          typedTags: ['SANCTION_APPLICANT'],
          applicantActions: [],
        }),
      ).resolves.toBeUndefined();

      // 重读判良性竞态：调用了 findByIdInternal 复核当前状态，而不是信
      // :501 读来的陈旧快照。
      expect(mocks.swapTransactionsService.findByIdInternal).toHaveBeenCalledWith('s1');

      // sticky 硬线章必须照常盖上 —— 这正是本次修复要保住的东西。
      expect(await mocks.pendingActionService.hasHardLineDisposition('cust-1')).toBe(true);

      // 处置审计必须照常写，不能被良性竞态吞掉。
      const disposedAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
        .map((c) => c[0])
        .find((a: any) => a.action === AuditActions.SWAP_KYT_REJECTED_DISPOSED);
      expect(disposedAudit).toBeDefined();
      expect(disposedAudit.metadata.hasSanction).toBe(true);

      // 不能被误判成整段处置失败：needsReview 不该被置位，
      // DISPOSITION_FAILED 审计不该被写。
      expect(mocks.swapTransactionsService.setNeedsReview).not.toHaveBeenCalled();
      const failedAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
        .map((c) => c[0])
        .find((a: any) => a.action === AuditActions.SWAP_KYT_REJECTED_DISPOSITION_FAILED);
      expect(failedAudit).toBeUndefined();
    });

    it('FROZEN 单再收裁决 → 不抛异常、markStatus 不再被调用、写 IGNORED 审计（幂等闸，防死信）', async () => {
      const mocks = buildApplyKytVerdictMocks({ status: SwapTransactionStatus.FROZEN });
      const service = makeApplyKytVerdictService(mocks);

      await expect(
        service.applyKytVerdict('s1', { verdict: 'rejected', typedTags: ['SANCTION_APPLICANT'] }),
      ).resolves.toBeUndefined();

      expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
      const ignoredAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
        .map((c) => c[0])
        .find((a: any) => a.action === AuditActions.SWAP_KYT_VERDICT_IGNORED);
      expect(ignoredAudit).toBeDefined();
      expect(ignoredAudit.metadata.status).toBe(SwapTransactionStatus.FROZEN);
    });

    // A redelivered *approved* verdict on a FROZEN swap must be equally inert
    // — the guard checks status only, not verdict, so this proves it isn't
    // accidentally scoped to 'rejected' redeliveries alone.
    it('FROZEN 单收到迟到 approved 裁决 → 同样不抛异常、不建腿、写 IGNORED 审计', async () => {
      const mocks = buildApplyKytVerdictMocks({ status: SwapTransactionStatus.FROZEN });
      const service = makeApplyKytVerdictService(mocks);
      const createLegSpy = jest.spyOn(service as any, 'createLeg');

      await expect(service.applyKytVerdict('s1', { verdict: 'approved' })).resolves.toBeUndefined();

      expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
      expect(createLegSpy).not.toHaveBeenCalled();
      const ignoredAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
        .map((c) => c[0])
        .find((a: any) => a.action === AuditActions.SWAP_KYT_VERDICT_IGNORED);
      expect(ignoredAudit).toBeDefined();
    });
  });
});

// ── Task 9: 跨域冻人广播驱动（onCustomerRestrictionOpened）───────────────────
describe('SwapWorkflowService.onCustomerRestrictionOpened (Task 9 — FROZEN 落地)', () => {
  function buildListenerMocks(overrides: { inflight?: any[] } = {}) {
    const inflight = overrides.inflight ?? [
      {
        id: 's1',
        swapNo: 'SWP0001',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        ownerNo: 'C0001',
        status: SwapTransactionStatus.COMPLIANCE_PENDING,
        traceId: 'TRACE-1',
      },
    ];

    const txClient: any = { swapTransaction: { update: jest.fn(() => Promise.resolve({})) } };

    const swapTransactionsService = {
      findNonTerminalByOwner: jest.fn(() => Promise.resolve(inflight)),
      markStatus: jest.fn(() => Promise.resolve('FROZEN')),
      findByIdInternal: jest.fn((id: string) =>
        Promise.resolve(inflight.find((s: any) => s.id === id) ?? null),
      ),
      setNeedsReview: jest.fn(() => Promise.resolve()),
    };

    const auditLogsService = {
      recordSystem: jest.fn(() => Promise.resolve()),
    };

    const prisma: any = {
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(txClient)),
    };

    // Simulates the restriction having just landed — SWAP capability blocked.
    const customerAccessService = {
      resolve: jest.fn(() => Promise.resolve({ blocked: new Set(['SWAP', 'WITHDRAW']) })),
    };

    return { inflight, txClient, swapTransactionsService, auditLogsService, prisma, customerAccessService };
  }

  function makeListenerService(mocks: ReturnType<typeof buildListenerMocks>) {
    return new SwapWorkflowService(
      mocks.prisma,
      {} as any, // onboardingService — not on this path
      {} as any, // swapQuoteService — not on this path
      mocks.swapTransactionsService as any,
      {} as any, // accountingService — not on this path
      mocks.auditLogsService as any,
      { emit: jest.fn() } as any, // eventEmitter — not on this path
      {} as any, // swapLegAccounting — not on this path
      {} as any, // fundsOrders — not on this path
      {} as any, // walletQuery — not on this path
      {} as any, // limitGateService — not on this path
      {} as any, // sumsubTxnClient — not on this path
      {} as any, // customerRestrictionsService — not on this path (the restriction is already open by the time this event fires)
      {} as any, // customersService — not on this path
      mocks.customerAccessService as any,
      {} as any, // materialRequests — not on this path
      {} as any, // materialRequestIssuer — not on this path
      {} as any, // l1Gate — not on this path (限制便签监听器不建单)
    );
  }

  const baseEvent = {
    customerId: 'cust-1',
    restrictionNo: 'RST2608200001',
    cause: 'SANCTION',
    blocksAllCapabilities: true as const,
    traceId: 'TRACE-EVT',
  };

  it('COMPLIANCE_PENDING 单 + 跨域冻人广播 → markStatus(FREEZE)，写 SWAP_FROZEN 审计', async () => {
    const mocks = buildListenerMocks();
    const service = makeListenerService(mocks);

    await service.onCustomerRestrictionOpened(baseEvent);

    expect(mocks.swapTransactionsService.markStatus).toHaveBeenCalledWith(
      's1',
      SwapTransactionAction.FREEZE,
      mocks.txClient,
      { rejectReason: 'SANCTION_APPLICANT' },
    );
    const frozenAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((a: any) => a.action === AuditActions.SWAP_FROZEN);
    expect(frozenAudit).toBeDefined();
    expect(frozenAudit.entityId).toBe('s1');
    expect(frozenAudit.entityNo).toBe('SWP0001');
    // Review Fix 4 (Minor): business key alongside the UUID, matching the
    // disposition-driven SWAP_FROZEN audit in handleRejectDisposition.
    expect(frozenAudit.entityOwnerNo).toBe('C0001');
    expect(frozenAudit.reason).toMatch(/RST2608200001/);
  });

  // The load-bearing negative case: PROCESSING has no FREEZE edge in the
  // transitions table on purpose (legs are already posting one at a time —
  // freezing mid-flight would strand a half-settled ledger). The listener
  // must route PROCESSING through the existing leg-halt gate instead of
  // attempting a transition.
  it('PROCESSING 单 + 跨域冻人广播 → 状态不变（维持停腿），不进 FROZEN', async () => {
    const mocks = buildListenerMocks({
      inflight: [
        {
          id: 's2',
          swapNo: 'SWP0002',
          ownerType: 'CUSTOMER',
          ownerId: 'cust-1',
          status: SwapTransactionStatus.PROCESSING,
          traceId: 'TRACE-2',
        },
      ],
    });
    const service = makeListenerService(mocks);

    await service.onCustomerRestrictionOpened(baseEvent);

    // No transition attempted at all for the in-flight swap.
    expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    // Routed through the existing capability gate (assertSwapCustomerAccessOrHalt) instead.
    expect(mocks.customerAccessService.resolve).toHaveBeenCalledWith('cust-1');
    expect(mocks.swapTransactionsService.setNeedsReview).toHaveBeenCalledWith('s2', true);
    expect(mocks.auditLogsService.recordSystem).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.SWAP_FROZEN }),
    );
  });

  // Review Important Fix (2026-08-20): blocksAllCapabilities=true is not
  // SANCTION-exclusive — ADMIN_SUSPENSION (operator-terminated material
  // refresh, or a tier-upgrade case rejected in approval) carries the same
  // scope=['ALL'] and reaches this listener through the identical event. It
  // must NOT drive a COMPLIANCE_PENDING swap into FROZEN (zero-out-edge,
  // unrecoverable, and would falsely stamp rejectReason=SANCTION_APPLICANT
  // on a customer who was never sanctioned) — it has to fall through to the
  // same halt-only path as PROCESSING, exactly like this restriction being
  // DISCLOSED/OPS_APPROVAL-releasable implies.
  it('COMPLIANCE_PENDING 单 + 跨域广播但 cause=ADMIN_SUSPENSION（非制裁）→ 不进 FROZEN，只停腿', async () => {
    const mocks = buildListenerMocks();
    const service = makeListenerService(mocks);

    await service.onCustomerRestrictionOpened({ ...baseEvent, cause: 'ADMIN_SUSPENSION' });

    expect(mocks.swapTransactionsService.markStatus).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.customerAccessService.resolve).toHaveBeenCalledWith('cust-1');
    expect(mocks.swapTransactionsService.setNeedsReview).toHaveBeenCalledWith('s1', true);
    expect(mocks.auditLogsService.recordSystem).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.SWAP_FROZEN }),
    );
  });
});
