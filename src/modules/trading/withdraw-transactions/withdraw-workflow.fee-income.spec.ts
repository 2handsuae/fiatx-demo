// 测的是 WithdrawWorkflowService 的费腿记账行为——按行为命名；曾名 withdraw-fee-income.service.spec.ts（无同名 service，2026-09-09 波一更正）
/**
 * withdraw-fee-income.service.spec.ts
 *
 * Real-time 1:1 T5 + 戊波一(附录 B 提现): Asserts that:
 * (a) WithdrawWorkflowService.createWithdrawal locks net + fee pending against the customer's source
 *     wallet cash account (A.CLIENT_CASH 一钱包一户, resolveCashAccountId — never the aggregate, never FEE_INCOME / FEE_RECEIVABLE)
 * (b) the funds_order-driven per-leg handlers post the net leg (onPayoutLegConfirmed)
 *     and the fee leg (onFeeLegConfirmed) with creditCode = CLIENT_CASH, then execute
 *     firm-side collect DR 现金·F_FEE 钱包 (A.FIRM_CASH) / CR INCOME_WITHDRAW_FEE — mirroring the legacy
 *     handlePayoutConfirmed / finalizeWithdrawal, now split across legSeq 1 + 2.
 */
import { WithdrawWorkflowService } from './withdraw-workflow.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { Prisma } from '@prisma/client';
import { FundsOrderStatus } from '../../funds-orders/dto/funds-order.dto';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeWithdrawRecord(overrides: Record<string, any> = {}) {
  return {
    id: 'wd-1',
    withdrawNo: 'WD0001',
    ownerId: 'cust-1',
    ownerNo: 'C0001',
    ownerType: 'CUSTOMER',
    assetId: 'asset-usdt',
    amount: new Prisma.Decimal('10'),
    netAmount: new Prisma.Decimal('9.5'),
    feeAmount: new Prisma.Decimal('0.5'),
    fromWalletId: null,
    fromWalletNo: null,
    toWalletId: null,
    toWalletNo: null,
    toAddress: '0xABCD',
    network: 'ETH',
    traceId: 'trace-1',
    tbPendingNetId: '0000000000000001',
    tbPendingFeeId: '0000000000000002',
    status: 'PAYOUT_PENDING',
    statusHistory: '[]',
    payoutId: 'payout-1',
    payoutNo: 'PO0001',
    asset: { currency: 'USDT', decimals: 6, type: 'CRYPTO' },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// TEST A: WithdrawTransactionsService.create — fee pending → CLIENT_CASH
// ═══════════════════════════════════════════════════════════════════

function buildServiceMocks() {
  const resolveMap: Record<number, bigint> = {
    [TB_ACCOUNT_CODES.CLIENT_PAYABLE]: 10n,
    [TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE]: 202n,
  };

  let counter = 1n;
  const makeTx = () => ({ tbTransferId: counter++ });

  const accountingService = {
    resolveTbAccountId: jest.fn(({ code }: { code: number }) =>
      Promise.resolve(resolveMap[code] ?? 99n),
    ),
    // 戊波一:现金户只经这个入口取(钱包 id → 该钱包的 A.CLIENT_CASH 户)
    resolveCashAccountId: jest.fn((_walletId: string, _ledger: number, _tx?: any) => Promise.resolve(20n)),
    executePendingTransfer: jest.fn(() => Promise.resolve(makeTx())),
    executeTransfer: jest.fn(() => Promise.resolve({ tbTransferId: counter++ })),
    voidPendingTransferBestEffort: jest.fn(() => Promise.resolve()),
  };

  const quote = {
    id: 'q-1',
    ownerType: 'CUSTOMER',
    ownerId: 'cust-1',
    assetId: 'asset-usdt',
    amount: new Prisma.Decimal('10'),
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 60_000),
    totalsJson: JSON.stringify({ USDT: '0.5' }),
  };

  const withdrawQuoteService = {
    getActiveQuoteOrThrow: jest.fn(() => Promise.resolve(quote)),
    consumeQuote: jest.fn(() => Promise.resolve({})),
  };

  const auditLogsService = {
    recordByActor: jest.fn(() => Promise.resolve()),
    recordSystem: jest.fn(() => Promise.resolve()),
  };

  const eventEmitter = { emit: jest.fn() };

  const asset = { id: 'asset-usdt', currency: 'USDT', decimals: 6, type: 'CRYPTO' };
  const customer = {
    id: 'cust-1',
    customerNo: 'C0001',
    complianceStatus: 'ACTIVE',
    adminStatus: 'ACTIVE',
    onboardingStatus: 'APPROVED',
  };

  const createdRecord = makeWithdrawRecord();

  // Domain delegate the workflow leans on for pure persistence inside the tx.
  const withdrawService = {
    insertRecord: jest.fn((_tx: any, data: Record<string, any>) =>
      Promise.resolve({ ...createdRecord, ...data, id: 'wd-new' }),
    ),
    setPendingIds: jest.fn(() => Promise.resolve({})),
  };

  const prisma: any = {
    customerMain: {
      findUnique: jest.fn(() => Promise.resolve(customer)),
    },
    asset: {
      findUnique: jest.fn(() => Promise.resolve(asset)),
    },
    withdrawTransaction: {
      findUnique: jest.fn(() => Promise.resolve(createdRecord)),
    },
    // Task 3 address-registration guard: these tests create a crypto withdrawal
    // to a registered toAddress ('0xABCD') — return a hit so the guard passes.
    withdrawalAddress: {
      findFirst: jest.fn(() => Promise.resolve({ addressType: 'SELF_CUSTODY' })),
    },
    $transaction: jest.fn((cb: (tx: any) => Promise<any>) => {
      const tx: any = {
        asset: {
          findUnique: jest.fn(() => Promise.resolve(asset)),
        },
        withdrawTransaction: {
          create: jest.fn(() => Promise.resolve({ ...createdRecord, id: 'wd-new' })),
          update: jest.fn(() => Promise.resolve({ ...createdRecord, id: 'wd-new' })),
        },
        auditLogEvent: {
          findUnique: jest.fn(() => Promise.resolve(null)),
          create: jest.fn(() => Promise.resolve({})),
        },
        withdrawPricingQuote: {
          findUnique: jest.fn(() => Promise.resolve(quote)),
          update: jest.fn(() => Promise.resolve({})),
        },
      };
      return cb(tx);
    }),
  };

  // 戊波一:建单时 fromWalletId 还没绑(出款阶段 ensureSourceWalletBound 才绑),锁定按同一条规则现取客户源钱包
  const systemWalletResolver = {
    resolveCustomer: jest.fn((_assetId: string, _role: string, _ownerId: string, _tx?: any) =>
      Promise.resolve({ id: 'wallet-c-dep-1' }),
    ),
  };

  return {
    accountingService,
    withdrawQuoteService,
    auditLogsService,
    eventEmitter,
    prisma,
    withdrawService,
    systemWalletResolver,
  };
}

// Build a WithdrawWorkflowService wired with the create-path deps from
// buildServiceMocks. The remaining downstream deps (fundsOrders/approvals/etc.)
// are inert stubs — createWithdrawal does not touch them.
function makeWorkflowForCreate(mocks: ReturnType<typeof buildServiceMocks>) {
  return new WithdrawWorkflowService(
    mocks.prisma,
    mocks.eventEmitter as any,
    mocks.withdrawService as any,
    mocks.withdrawQuoteService as any,
    mocks.auditLogsService as any,
    mocks.accountingService as any,
    {} as any, // fundsOrders
    {} as any, // approvalsService
    {} as any, // binanceRateProvider
    mocks.systemWalletResolver as any,
    {} as any, // tbEvidenceService
    { evaluate: jest.fn(() => Promise.resolve({ grossAedValue: null, aedRate: null, rateFetchedAt: null, rateFetchFailed: false })) } as any, // limitGateService
    {} as any, // limitRulesService
    {} as any, // sumsubTxnClient
    {} as any, // applicantActions
    { assertTradingIntake: jest.fn().mockResolvedValue({ fold: false }), resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }) } as any, // customerAccessService
    { open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST', created: true }) } as any, // customerRestrictionsService
    { evaluate: jest.fn().mockResolvedValue({ evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'WITHDRAW', verdict: 'PASS', holdReason: null, tradingTier: 'BASIC', checks: [] }) } as any, // l1Gate
    {} as any, // supplementEvidence
    {} as any, // reconDisposition
    {} as any, // trRules
  );
}

describe('WithdrawWorkflowService.createWithdrawal — T5 fee account (real-time 1:1) + 戊波一 现金户', () => {
  const createDto = { assetId: 'asset-usdt', amount: 10, toAddress: '0xABCD', network: 'ETH', quoteId: 'q-1' } as any;

  it('locks net + fee against the source wallet cash account (resolveCashAccountId), not the CLIENT_CASH aggregate, FEE_INCOME or FEE_RECEIVABLE', async () => {
    const mocks = buildServiceMocks();
    const service = makeWorkflowForCreate(mocks);

    await service.createWithdrawal(createDto, 'cust-1', 'CUSTOMER');

    // 建单时 fromWalletId 未绑:按 ensureSourceWalletBound 同一规则现取客户源钱包(USDT = crypto → C_DEP),且在建单事务的 tx 里查(SQLite 单连接)
    expect(mocks.systemWalletResolver.resolveCustomer).toHaveBeenCalledWith('asset-usdt', 'C_DEP', 'cust-1', expect.anything());
    // 现金户 = 该钱包的户,只经 resolveCashAccountId 取(USDT 账本 2)
    expect(mocks.accountingService.resolveCashAccountId).toHaveBeenCalledWith('wallet-c-dep-1', 2, expect.anything());

    const resolveCalls = (mocks.accountingService.resolveTbAccountId.mock.calls as any[][]).map(
      (c) => c[0].code,
    );
    // 聚合 CLIENT_CASH(code 1)不再经手写元组解析
    expect(resolveCalls).not.toContain(TB_ACCOUNT_CODES.CLIENT_CASH);
    // 借方仍是客户应付
    expect(resolveCalls).toContain(TB_ACCOUNT_CODES.CLIENT_PAYABLE);
    // Must NOT resolve FEE_RECEIVABLE (code 120, removed)
    expect(resolveCalls).not.toContain(120);
  });

  it('executePendingTransfer: net + fee both DR 应付 / CR 钱包现金户 (codes 10 / 13), evidence labels A.CLIENT_CASH', async () => {
    const mocks = buildServiceMocks();
    const service = makeWorkflowForCreate(mocks);

    await service.createWithdrawal(createDto, 'cust-1', 'CUSTOMER');

    const pendingCalls = mocks.accountingService.executePendingTransfer.mock.calls as any[][];
    expect(pendingCalls).toHaveLength(2);
    const creditCodes = pendingCalls.map((c) => c[0]?.evidence?.creditCode).filter(Boolean);

    // All credit codes should be CLIENT_CASH
    expect(creditCodes.every((code) => code === TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_CASH])).toBe(true);
    // Specifically: 'A.CLIENT_CASH'
    expect(creditCodes).toContain(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_CASH]);
    for (const [arg] of pendingCalls) {
      expect(arg.debitAccountId).toBe(10n); // L.CLIENT_PAYABLE
      expect(arg.creditAccountId).toBe(20n); // 钱包现金户(resolveCashAccountId mock)
      expect(arg.evidence.debitCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE]);
    }
    expect(pendingCalls.map((c) => c[0].code).sort((a, b) => a - b)).toEqual([
      TB_TRANSFER_CODES.WITHDRAW_NET_PENDING,
      TB_TRANSFER_CODES.WITHDRAW_FEE_PENDING,
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST B: WithdrawWorkflowService.handlePayoutConfirmed — post fee → CLIENT_CASH + INCOME_WITHDRAW_FEE collect(借 F_FEE 钱包现金户)
// ═══════════════════════════════════════════════════════════════════

function buildWorkflowMocks() {
  const accountingService = {
    postPendingTransfer: jest.fn(() => Promise.resolve({ tbTransferId: 1n })),
    executeTransfer: jest.fn(() => Promise.resolve({ tbTransferId: 3n })),
    voidPendingTransferBestEffort: jest.fn(() => Promise.resolve()),
    resolveTbAccountId: jest.fn((args: { code: number }) => {
      const map: Record<number, bigint> = {
        [TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE]: 202n,
      };
      return Promise.resolve(map[args.code] ?? 99n);
    }),
    // 戊波一:公司侧收费借方 = F_FEE 钱包的现金户(50 公司现金),只经 resolveCashAccountId 取
    resolveCashAccountId: jest.fn((walletId: string, _ledger: number) =>
      Promise.resolve(walletId === 'wallet-f-fee-1' ? 5001n : 9999n),
    ),
  };

  const auditLogsService = {
    recordSystem: jest.fn(() => Promise.resolve()),
    recordByActor: jest.fn(() => Promise.resolve()),
  };

  const fullRecord = makeWithdrawRecord();

  const withdrawService = {
    findOneInternal: jest.fn(() => Promise.resolve(fullRecord)),
    updateStatus: jest.fn(() => Promise.resolve({ ...fullRecord, status: 'SUCCESS' })),
    // Task 6 settle-failure retry rung: onFeeLegConfirmed resets the counter on
    // every successful settle (these tests exercise the happy path only).
    resetFeeSettleAttempts: jest.fn(() => Promise.resolve()),
    incrementFeeSettleAttempts: jest.fn(() => Promise.resolve(1)),
    markNeedsReview: jest.fn(() => Promise.resolve()),
  };

  // FundsOrderService: the per-leg confirm handlers CLEAR each leg via advance().
  // externalRef now flows through the funds_order (findById → resolveExternalRef),
  // not off the withdrawal record. findById mirrors the current withdrawal fixture
  // (asset.type + txHash + referenceNo) so the type-based resolver yields the same
  // ref the withdrawal carries. resolveExternalRef is a faithful copy of the real
  // type-based logic: CRYPTO → txHash, FIAT → referenceNo (default CRYPTO).
  const fundsOrders = {
    advance: jest.fn(() => Promise.resolve({})),
    // Task 6 order guard: onFeeLegConfirmed looks up the principal leg (legSeq 1)
    // and defers unless it's at least CONFIRMED. Every test in this file calls
    // onPayoutLegConfirmed('wd-1', 'fo-net-1') before onFeeLegConfirmed — by then
    // the principal leg is CLEARED in reality, so the guard mock reflects that.
    findByParent: jest.fn((_parent: any, filter?: { legSeq?: number }) =>
      filter?.legSeq === 1
        ? Promise.resolve([{ id: 'fo-net-1', status: 'CLEARED' }])
        : Promise.resolve([]),
    ),
    findById: jest.fn(async () => {
      const w: any = await withdrawService.findOneInternal();
      return { status: FundsOrderStatus.CONFIRMED, asset: w.asset, txHash: w.txHash ?? null, referenceNo: w.referenceNo ?? null };
    }),
    resolveExternalRef: jest.fn((row) =>
      ((row?.asset?.type ?? 'CRYPTO').toUpperCase() === 'CRYPTO'
        ? (row?.txHash ?? null)
        : (row?.referenceNo ?? null))),
  };
  const approvalsService = { completeApproval: jest.fn(() => Promise.resolve({})) };
  const binanceRateProvider = {};
  // 戊波一:取平台 F_FEE 钱包——公司侧收费(码 16)借它的现金户
  const systemWalletResolver = { resolve: jest.fn(() => Promise.resolve({ id: 'wallet-f-fee-1' })) };
  // Phase B: post-promote enrichment — promotes a LOCK row's eventCode/walletRef/externalRef
  // to its POST semantics after postPendingTransfer flips transferType.
  const tbEvidenceService = { enrichForPost: jest.fn(() => Promise.resolve()) };

  // 乙 SUCCESS invariant: assertWithdrawSettled reads tbTransferEvidence to confirm
  // the full settlement (NET_POST + FEE_POST + FEE_FIRM) is on the books before SUCCESS.
  const prisma = {
    tbTransferEvidence: {
      findMany: jest.fn(() =>
        Promise.resolve([
          { eventCode: 'WITHDRAW_NET_POST' },
          { eventCode: 'WITHDRAW_FEE_POST' },
          { eventCode: 'WITHDRAW_FEE_FIRM' },
        ]),
      ),
    },
  };

  return {
    accountingService,
    auditLogsService,
    withdrawService,
    fundsOrders,
    approvalsService,
    binanceRateProvider,
    systemWalletResolver,
    tbEvidenceService,
    prisma,
  };
}

function makeWorkflowForLegs(mocks: ReturnType<typeof buildWorkflowMocks>) {
  return new WithdrawWorkflowService(
    mocks.prisma as any, // prisma
    { emit: jest.fn() } as any, // eventEmitter
    mocks.withdrawService as any,
    {} as any, // withdrawQuoteService
    mocks.auditLogsService as any,
    mocks.accountingService as any,
    mocks.fundsOrders as any,
    mocks.approvalsService as any,
    mocks.binanceRateProvider as any,
    mocks.systemWalletResolver as any,
    mocks.tbEvidenceService as any,
    {} as any, // limitGateService
    {} as any, // limitRulesService
    {} as any, // sumsubTxnClient
    {} as any, // applicantActions
    { assertCapability: jest.fn(), resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }) } as any, // customerAccessService
    { open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST', created: true }) } as any, // customerRestrictionsService
    { evaluate: jest.fn().mockResolvedValue({ evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'WITHDRAW', verdict: 'PASS', holdReason: null, tradingTier: 'BASIC', checks: [] }) } as any, // l1Gate
    {} as any, // supplementEvidence
    {} as any, // reconDisposition
    {} as any, // trRules
  );
}

describe('WithdrawWorkflowService — T5 post fee evidence (real-time 1:1)', () => {
  it('posts fee pending with creditCode = CLIENT_CASH (not FEE_INCOME), then executes F_FEE wallet cash → INCOME_WITHDRAW_FEE', async () => {
    const mocks = buildWorkflowMocks();
    const service = makeWorkflowForLegs(mocks);

    // funds_order-driven: payout leg (legSeq 1) CONFIRMED posts NET; fee leg
    // (legSeq 2) CONFIRMED posts FEE + FEE_FIRM.
    await (service as any).onPayoutLegConfirmed('wd-1', 'fo-net-1');
    await (service as any).onFeeLegConfirmed('wd-1', 'fo-fee-1');

    const postCalls = mocks.accountingService.postPendingTransfer.mock.calls as any[][];

    // Two postPendingTransfer calls: net and fee client-side
    expect(postCalls.length).toBeGreaterThanOrEqual(2);

    // Collect all creditCode values from evidence
    const creditCodes = postCalls
      .map((c) => c[0]?.evidence?.creditCode)
      .filter(Boolean);

    // Both post calls should have CLIENT_CASH as credit (not FEE_INCOME)
    expect(creditCodes).toContain(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_CASH]);
    // Must NOT contain FEE_INCOME or FEE_RECEIVABLE
    expect(creditCodes).not.toContain('120');

    // Firm-side fee collect: executeTransfer called DR 现金·F_FEE 钱包 / CR INCOME_WITHDRAW_FEE(码 16)
    const execCalls = mocks.accountingService.executeTransfer.mock.calls as any[][];
    expect(execCalls.length).toBeGreaterThanOrEqual(1);
    const firmCall = execCalls[0][0];
    expect(firmCall.code).toBe(TB_TRANSFER_CODES.WITHDRAW_FEE_FIRM);
    expect(firmCall?.evidence?.debitCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_CASH]);
    expect(firmCall?.evidence?.creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE]);
    // 借方 = F_FEE 钱包(平台费钱包 wallet-f-fee-1)的现金户,而不是聚合 FIRM_CASH
    expect(mocks.systemWalletResolver.resolve).toHaveBeenCalledWith('asset-usdt', 'F_FEE');
    expect(mocks.accountingService.resolveCashAccountId).toHaveBeenCalledWith('wallet-f-fee-1', 2);
    expect(firmCall.debitAccountId).toBe(5001n);
    expect(firmCall.creditAccountId).toBe(202n);
    const resolveCodes = (mocks.accountingService.resolveTbAccountId.mock.calls as any[][]).map((c) => c[0].code);
    expect(resolveCodes).not.toContain(TB_ACCOUNT_CODES.FIRM_CASH);

    // Each leg CLEARs its own funds order.
    expect(mocks.fundsOrders.advance).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST C: externalRef 配对
// ═══════════════════════════════════════════════════════════════════

describe('WithdrawWorkflowService — 费腿配对(同一 externalRef)+ 现金户落点', () => {
  function buildPhaseBMocks() {
    const m = buildWorkflowMocks();
    // Override withdraw record to carry fromWalletId + txHash so we can assert
    // that externalRef threads through correctly.
    const recordWithWallet = makeWithdrawRecord({
      fromWalletId: 'wallet-c-out-1',
      fromWalletNo: 'WA-CLI-001',
      txHash: '0xabc123dead',
      referenceNo: null,
    });
    m.withdrawService.findOneInternal = jest.fn(() => Promise.resolve(recordWithWallet));
    return m;
  }

  function makeService(m: ReturnType<typeof buildPhaseBMocks>) {
    return new WithdrawWorkflowService(
      m.prisma as any, // prisma
      { emit: jest.fn() } as any, // eventEmitter
      m.withdrawService as any,
      {} as any, // withdrawQuoteService
      m.auditLogsService as any,
      m.accountingService as any,
      m.fundsOrders as any,
      m.approvalsService as any,
      m.binanceRateProvider as any,
      m.systemWalletResolver as any,
      m.tbEvidenceService as any,
      {} as any, // limitGateService
      {} as any, // limitRulesService
      {} as any, // sumsubTxnClient
      {} as any, // applicantActions
      { assertCapability: jest.fn(), resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }) } as any, // customerAccessService
      { open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST', created: true }) } as any, // customerRestrictionsService
      { evaluate: jest.fn().mockResolvedValue({ evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'WITHDRAW', verdict: 'PASS', holdReason: null, tradingTier: 'BASIC', checks: [] }) } as any, // l1Gate
      {} as any, // supplementEvidence
      {} as any, // reconDisposition
      {} as any, // trRules
    );
  }

  // Drive both funds-order legs (payout principal + fee) to CONFIRMED, mirroring
  // the legacy single-shot finalizeWithdrawal now split across legSeq 1 + 2.
  async function confirmBothLegs(service: WithdrawWorkflowService) {
    await (service as any).onPayoutLegConfirmed('wd-1', 'fo-net-1');
    await (service as any).onFeeLegConfirmed('wd-1', 'fo-fee-1');
  }

  it('POST rows carry externalRef', async () => {
    const mocks = buildPhaseBMocks();
    const service = makeService(mocks);

    await confirmBothLegs(service);

    const postCalls = mocks.accountingService.postPendingTransfer.mock.calls as any[][];
    expect(postCalls.length).toBe(2);

    // POST_NET evidence
    const netEvidence = postCalls.find(c => c[0]?.evidence?.eventCode === 'WITHDRAW_NET_POST')?.[0]?.evidence;
    expect(netEvidence).toMatchObject({ externalRef: '0xabc123dead' });
    // POST_FEE evidence
    const feeEvidence = postCalls.find(c => c[0]?.evidence?.eventCode === 'WITHDRAW_FEE_POST')?.[0]?.evidence;
    expect(feeEvidence).toMatchObject({ externalRef: '0xabc123dead' });

    // 两阶段:post 只带待决转账 id,账户在锁定时就定了——post 阶段不再解析任何账户
    expect(mocks.accountingService.resolveCashAccountId).not.toHaveBeenCalledWith('wallet-c-out-1', expect.anything());
  });

  it('FEE_FIRM debits the F_FEE wallet cash account, credits INCOME_WITHDRAW_FEE, shares externalRef with FEE_POST', async () => {
    const mocks = buildPhaseBMocks();
    const service = makeService(mocks);

    await confirmBothLegs(service);

    const execCalls = mocks.accountingService.executeTransfer.mock.calls as any[][];
    const firmArg = execCalls.find(c => c[0]?.evidence?.eventCode === 'WITHDRAW_FEE_FIRM')?.[0];
    const firmEvidence = firmArg?.evidence;
    expect(firmEvidence).toMatchObject({
      debitCode: 'A.FIRM_CASH',
      creditCode: 'E.INCOME_WITHDRAW_FEE',
      externalRef: '0xabc123dead',
    });
    expect(firmArg.debitAccountId).toBe(5001n); // wallet-f-fee-1 的现金户

    // CRITICAL: FEE_POST and FEE_FIRM share the EXACT same externalRef.
    const postCalls = mocks.accountingService.postPendingTransfer.mock.calls as any[][];
    const feePostEv = postCalls.find(c => c[0]?.evidence?.eventCode === 'WITHDRAW_FEE_POST')?.[0]?.evidence;
    expect(feePostEv.externalRef).toBe(firmEvidence.externalRef);
    expect(firmEvidence.externalRef).not.toBeNull();

    // SystemWalletResolver was called for F_FEE on the correct asset
    expect(mocks.systemWalletResolver.resolve).toHaveBeenCalledWith('asset-usdt', 'F_FEE');
  });

  it('uses referenceNo for a FIAT withdrawal (type-based externalRef via funds_order)', async () => {
    const mocks = buildPhaseBMocks();
    const recordWithRefNo = makeWithdrawRecord({
      fromWalletId: 'wallet-c-out-1',
      // FIAT withdrawal: type-based resolver reads referenceNo (not txHash).
      // AED is the fiat currency with a real TB ledger (fee leg needs it).
      asset: { currency: 'AED', decimals: 2, type: 'FIAT' },
      txHash: null,
      referenceNo: 'BANK-REF-XYZ',
    });
    mocks.withdrawService.findOneInternal = jest.fn(() => Promise.resolve(recordWithRefNo));
    const service = makeService(mocks);

    await confirmBothLegs(service);

    const postCalls = mocks.accountingService.postPendingTransfer.mock.calls as any[][];
    const netEv = postCalls.find(c => c[0]?.evidence?.eventCode === 'WITHDRAW_NET_POST')?.[0]?.evidence;
    expect(netEv.externalRef).toBe('BANK-REF-XYZ');
    // 法币账本 1:F_FEE 现金户在 AED 账本上取
    expect(mocks.accountingService.resolveCashAccountId).toHaveBeenCalledWith('wallet-f-fee-1', 1);
  });

  it('enrichForPost promotes LOCK rows to POST eventCode + externalRef', async () => {
    const mocks = buildPhaseBMocks();
    const service = makeService(mocks);

    await confirmBothLegs(service);

    const enrichCalls = mocks.tbEvidenceService.enrichForPost.mock.calls as any[][];
    // Two enrich calls — one for net pending hex id, one for fee pending hex id.
    expect(enrichCalls.length).toBe(2);

    // NET enrichment targets the net pending id
    const netEnrich = enrichCalls.find(c => c[0] === '0000000000000001')?.[1];
    expect(netEnrich).toMatchObject({ eventCode: 'WITHDRAW_NET_POST', externalRef: '0xabc123dead' });

    // FEE enrichment targets the fee pending id
    const feeEnrich = enrichCalls.find(c => c[0] === '0000000000000002')?.[1];
    expect(feeEnrich).toMatchObject({ eventCode: 'WITHDRAW_FEE_POST', externalRef: '0xabc123dead' });

  });

  it('F_FEE wallet missing → no fallback to an aggregate: the fee leg posts nothing (client side included), stays un-CLEARed (记账失败 = 流程失败)', async () => {
    const mocks = buildPhaseBMocks();
    mocks.systemWalletResolver.resolve = jest.fn(() => Promise.reject(new Error('SYSTEM_WALLET_NOT_FOUND')));
    const service = makeService(mocks);

    await confirmBothLegs(service);

    const execCalls = mocks.accountingService.executeTransfer.mock.calls as any[][];
    expect(execCalls.find(c => c[0]?.evidence?.eventCode === 'WITHDRAW_FEE_FIRM')).toBeUndefined();
    // 公司侧解析先于客户侧费腿 POST:客户侧费也没落账(只有本金腿 POST 了一次),不会出现客户被收费而公司记不了
    const postCalls = mocks.accountingService.postPendingTransfer.mock.calls as any[][];
    expect(postCalls.map(c => c[0]?.evidence?.eventCode)).toEqual(['WITHDRAW_NET_POST']);
    // 费腿没 CLEAR(只有本金腿 CLEAR 了一次),失败计数 +1
    expect(mocks.fundsOrders.advance).toHaveBeenCalledTimes(1);
    expect(mocks.withdrawService.incrementFeeSettleAttempts).toHaveBeenCalledWith('wd-1');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST D: LOCK pending rows at create()
// ═══════════════════════════════════════════════════════════════════

describe('WithdrawWorkflowService.createWithdrawal — LOCK rows', () => {
  it('LOCK_NET + LOCK_FEE pendings carry externalRef=null', async () => {
    const mocks = buildServiceMocks();
    const service = makeWorkflowForCreate(mocks);

    await service.createWithdrawal(
      { assetId: 'asset-usdt', amount: 10, toAddress: '0xABCD', network: 'ETH', quoteId: 'q-1' } as any,
      'cust-1',
      'CUSTOMER',
    );

    const pendingCalls = mocks.accountingService.executePendingTransfer.mock.calls as any[][];
    const lockEvidence = pendingCalls.map(c => c[0]?.evidence).filter(Boolean);

    // Both LOCK_NET and LOCK_FEE present
    const codes = lockEvidence.map(e => e.eventCode).sort();
    expect(codes).toEqual(['WITHDRAW_LOCK_FEE', 'WITHDRAW_LOCK_NET']);

    // Every LOCK evidence row: externalRef null
    for (const ev of lockEvidence) {
      expect(ev).toMatchObject({ externalRef: null });
    }
  });
});
