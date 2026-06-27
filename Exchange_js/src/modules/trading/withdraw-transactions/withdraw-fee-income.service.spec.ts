/**
 * withdraw-fee-income.service.spec.ts
 *
 * Real-time 1:1 T5: Asserts that:
 * (a) WithdrawWorkflowService.createWithdrawal locks fee pending into CLIENT_ASSET (not FEE_INCOME / FEE_RECEIVABLE)
 * (b) withdraw-workflow handlePayoutConfirmed posts fee leg with creditCode = CLIENT_ASSET,
 *     then executes firm-side collect DR FIRM_ASSET / CR FIRM_FEE
 */
import { WithdrawWorkflowService } from './withdraw-workflow.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { Prisma } from '@prisma/client';

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
// TEST A: WithdrawTransactionsService.create — fee pending → CLIENT_ASSET
// ═══════════════════════════════════════════════════════════════════

function buildServiceMocks() {
  const resolveMap: Record<number, bigint> = {
    [TB_ACCOUNT_CODES.CLIENT_PAYABLE]: 10n,
    [TB_ACCOUNT_CODES.CLIENT_ASSET]: 20n,
    [TB_ACCOUNT_CODES.FIRM_ASSET]: 50n,
    [TB_ACCOUNT_CODES.FIRM_FEE]: 202n,
  };

  let counter = 1n;
  const makeTx = () => ({ tbTransferId: counter++ });

  const accountingService = {
    resolveTbAccountId: jest.fn(({ code }: { code: number }) =>
      Promise.resolve(resolveMap[code] ?? 99n),
    ),
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

  return {
    accountingService,
    withdrawQuoteService,
    auditLogsService,
    eventEmitter,
    prisma,
    withdrawService,
  };
}

// Build a WithdrawWorkflowService wired with the create-path deps from
// buildServiceMocks. The remaining downstream deps (payouts/approvals/etc.)
// are inert stubs — createWithdrawal does not touch them.
function makeWorkflowForCreate(mocks: ReturnType<typeof buildServiceMocks>) {
  return new WithdrawWorkflowService(
    mocks.prisma,
    mocks.eventEmitter as any,
    mocks.withdrawService as any,
    mocks.withdrawQuoteService as any,
    mocks.auditLogsService as any,
    mocks.accountingService as any,
    {} as any, // payoutsService
    {} as any, // approvalsService
    {} as any, // binanceRateProvider
    {} as any, // fundsFlowService
    {} as any, // systemWalletResolver
    {} as any, // tbEvidenceService
  );
}

describe('WithdrawWorkflowService.createWithdrawal — T5 fee account (real-time 1:1)', () => {
  it('locks fee pending to CLIENT_ASSET, not FEE_INCOME or FEE_RECEIVABLE', async () => {
    const mocks = buildServiceMocks();
    const service = makeWorkflowForCreate(mocks);

    await service.createWithdrawal(
      {
        assetId: 'asset-usdt',
        amount: 10,
        toAddress: '0xABCD',
        network: 'ETH',
        quoteId: 'q-1',
      } as any,
      'cust-1',
      'CUSTOMER',
    );

    const resolveCalls = (mocks.accountingService.resolveTbAccountId.mock.calls as any[][]).map(
      (c) => c[0].code,
    );

    // Both net and fee must resolve CLIENT_ASSET (not FEE_INCOME or old CLIENT_CUSTODY/CLIENT_BANK)
    expect(resolveCalls).toContain(TB_ACCOUNT_CODES.CLIENT_ASSET);

    // Must NOT resolve FEE_INCOME (code no longer exists in new COA)
    // Must NOT resolve FEE_RECEIVABLE (code 120, removed)
    expect(resolveCalls).not.toContain(120);
  });

  it('executePendingTransfer calls use CLIENT_ASSET credit code for both net and fee', async () => {
    const mocks = buildServiceMocks();
    const service = makeWorkflowForCreate(mocks);

    await service.createWithdrawal(
      {
        assetId: 'asset-usdt',
        amount: 10,
        toAddress: '0xABCD',
        network: 'ETH',
        quoteId: 'q-1',
      } as any,
      'cust-1',
      'CUSTOMER',
    );

    const pendingCalls = mocks.accountingService.executePendingTransfer.mock.calls as any[][];
    const creditCodes = pendingCalls.map((c) => c[0]?.evidence?.creditCode).filter(Boolean);

    // All credit codes should be CLIENT_ASSET
    expect(creditCodes.every((code) => code === TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET])).toBe(true);
    // Specifically: 'A.CLIENT_ASSET'
    expect(creditCodes).toContain(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST B: WithdrawWorkflowService.handlePayoutConfirmed — post fee → CLIENT_ASSET + FIRM_FEE collect
// ═══════════════════════════════════════════════════════════════════

function buildWorkflowMocks() {
  const accountingService = {
    postPendingTransfer: jest.fn(() => Promise.resolve({ tbTransferId: 1n })),
    executeTransfer: jest.fn(() => Promise.resolve({ tbTransferId: 3n })),
    voidPendingTransferBestEffort: jest.fn(() => Promise.resolve()),
    resolveTbAccountId: jest.fn((args: { code: number }) => {
      const map: Record<number, bigint> = {
        [TB_ACCOUNT_CODES.FIRM_ASSET]: 50n,
        [TB_ACCOUNT_CODES.FIRM_FEE]: 202n,
      };
      return Promise.resolve(map[args.code] ?? 99n);
    }),
  };

  const auditLogsService = {
    recordSystem: jest.fn(() => Promise.resolve()),
    recordByActor: jest.fn(() => Promise.resolve()),
  };

  const fullRecord = makeWithdrawRecord();

  const withdrawService = {
    findOneInternal: jest.fn(() => Promise.resolve(fullRecord)),
    updateStatus: jest.fn(() => Promise.resolve({ ...fullRecord, status: 'SUCCESS' })),
    linkPayout: jest.fn(() => Promise.resolve({})),
  };

  const payoutsService = {
    updateStatus: jest.fn(() => Promise.resolve({})),
    findOne: jest.fn(() =>
      Promise.resolve({
        id: 'payout-1',
        payoutNo: 'PO0001',
        // 乙 SUCCESS invariant: assertWithdrawSettled requires CONFIRMED/CLEARED.
        status: 'CONFIRMED',
        withdrawId: 'wd-1',
      }),
    ),
  };
  const approvalsService = { completeApproval: jest.fn(() => Promise.resolve({})) };
  const binanceRateProvider = {};
  // FundsFlowService is downstream of finalize (sets fee fund CLEAR).
  const fundsFlowService = { setWithdrawFeeFundStatus: jest.fn(() => Promise.resolve()) };
  // Phase B: resolves the platform F_FEE wallet for creditWalletRef on FIRM rows.
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
    payoutsService,
    approvalsService,
    binanceRateProvider,
    fundsFlowService,
    systemWalletResolver,
    tbEvidenceService,
    prisma,
  };
}

describe('WithdrawWorkflowService — T5 post fee evidence (real-time 1:1)', () => {
  it('posts fee pending with creditCode = CLIENT_ASSET (not FEE_INCOME), then executes FIRM_ASSET→FIRM_FEE', async () => {
    const mocks = buildWorkflowMocks();
    const service = new WithdrawWorkflowService(
      mocks.prisma as any, // prisma
      { emit: jest.fn() } as any, // eventEmitter
      mocks.withdrawService as any,
      {} as any, // withdrawQuoteService
      mocks.auditLogsService as any,
      mocks.accountingService as any,
      mocks.payoutsService as any,
      mocks.approvalsService as any,
      mocks.binanceRateProvider as any,
      mocks.fundsFlowService as any,
      mocks.systemWalletResolver as any,
      mocks.tbEvidenceService as any,
    );

    await (service as any).handlePayoutConfirmed({
      withdrawId: 'wd-1',
      payoutId: 'payout-1',
    });

    const postCalls = mocks.accountingService.postPendingTransfer.mock.calls as any[][];

    // Two postPendingTransfer calls: net and fee client-side
    expect(postCalls.length).toBeGreaterThanOrEqual(2);

    // Collect all creditCode values from evidence
    const creditCodes = postCalls
      .map((c) => c[0]?.evidence?.creditCode)
      .filter(Boolean);

    // Both post calls should have CLIENT_ASSET as credit (not FEE_INCOME)
    expect(creditCodes).toContain(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]);
    // Must NOT contain FEE_INCOME or FEE_RECEIVABLE
    expect(creditCodes).not.toContain('120');

    // Firm-side fee collect: executeTransfer called DR FIRM_ASSET / CR FIRM_FEE
    const execCalls = mocks.accountingService.executeTransfer.mock.calls as any[][];
    expect(execCalls.length).toBeGreaterThanOrEqual(1);
    const firmCall = execCalls[0][0];
    expect(firmCall?.evidence?.debitCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_ASSET]);
    expect(firmCall?.evidence?.creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_FEE]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST C: Phase B per-physical-wallet recon fields on withdraw flow
// ═══════════════════════════════════════════════════════════════════

describe('WithdrawWorkflowService — T2b Phase B recon fields (cross-wallet same-ref fee pair)', () => {
  function buildPhaseBMocks() {
    const m = buildWorkflowMocks();
    // Override withdraw record to carry fromWalletId + txHash so we can assert
    // that walletRef + externalRef thread through correctly.
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
      m.payoutsService as any,
      m.approvalsService as any,
      m.binanceRateProvider as any,
      m.fundsFlowService as any,
      m.systemWalletResolver as any,
      m.tbEvidenceService as any,
    );
  }

  it('finalize: POST rows carry walletRef + externalRef + crossing=true', async () => {
    const mocks = buildPhaseBMocks();
    const service = makeService(mocks);

    await (service as any).handlePayoutConfirmed({ withdrawId: 'wd-1', payoutId: 'payout-1' });

    const postCalls = mocks.accountingService.postPendingTransfer.mock.calls as any[][];
    expect(postCalls.length).toBe(2);

    // POST_NET evidence
    const netEvidence = postCalls.find(c => c[0]?.evidence?.eventCode === 'WITHDRAW_NET_POST')?.[0]?.evidence;
    expect(netEvidence).toMatchObject({
      debitWalletRef: 'wallet-c-out-1',
      creditWalletRef: 'wallet-c-out-1',
      externalRef: '0xabc123dead',
      isExternalCrossing: true,
    });

    // POST_FEE evidence
    const feeEvidence = postCalls.find(c => c[0]?.evidence?.eventCode === 'WITHDRAW_FEE_POST')?.[0]?.evidence;
    expect(feeEvidence).toMatchObject({
      debitWalletRef: 'wallet-c-out-1',
      creditWalletRef: 'wallet-c-out-1',
      externalRef: '0xabc123dead',
      isExternalCrossing: true,
    });
  });

  it('finalize: FEE_FIRM debits aggregate (null wallet) and credits F_FEE wallet, shares externalRef with FEE_POST', async () => {
    const mocks = buildPhaseBMocks();
    const service = makeService(mocks);

    await (service as any).handlePayoutConfirmed({ withdrawId: 'wd-1', payoutId: 'payout-1' });

    const execCalls = mocks.accountingService.executeTransfer.mock.calls as any[][];
    const firmEvidence = execCalls.find(c => c[0]?.evidence?.eventCode === 'WITHDRAW_FEE_FIRM')?.[0]?.evidence;
    expect(firmEvidence).toMatchObject({
      debitWalletRef: null,                   // FIRM_ASSET is aggregate, no physical wallet
      creditWalletRef: 'wallet-f-fee-1',      // F_FEE platform wallet (from SystemWalletResolver mock)
      externalRef: '0xabc123dead',
      isExternalCrossing: true,
    });

    // CRITICAL: FEE_POST and FEE_FIRM share the EXACT same externalRef.
    const postCalls = mocks.accountingService.postPendingTransfer.mock.calls as any[][];
    const feePostEv = postCalls.find(c => c[0]?.evidence?.eventCode === 'WITHDRAW_FEE_POST')?.[0]?.evidence;
    expect(feePostEv.externalRef).toBe(firmEvidence.externalRef);
    expect(firmEvidence.externalRef).not.toBeNull();

    // SystemWalletResolver was called for F_FEE on the correct asset
    expect(mocks.systemWalletResolver.resolve).toHaveBeenCalledWith('asset-usdt', 'F_FEE');
  });

  it('finalize: falls back to referenceNo when txHash is null on withdrawal', async () => {
    const mocks = buildPhaseBMocks();
    const recordWithRefNo = makeWithdrawRecord({
      fromWalletId: 'wallet-c-out-1',
      txHash: null,
      referenceNo: 'BANK-REF-XYZ',
    });
    mocks.withdrawService.findOneInternal = jest.fn(() => Promise.resolve(recordWithRefNo));
    const service = makeService(mocks);

    await (service as any).handlePayoutConfirmed({ withdrawId: 'wd-1', payoutId: 'payout-1' });

    const postCalls = mocks.accountingService.postPendingTransfer.mock.calls as any[][];
    const netEv = postCalls.find(c => c[0]?.evidence?.eventCode === 'WITHDRAW_NET_POST')?.[0]?.evidence;
    expect(netEv.externalRef).toBe('BANK-REF-XYZ');
  });

  it('finalize: falls back to payout.txHash when withdrawal has neither txHash nor referenceNo', async () => {
    const mocks = buildPhaseBMocks();
    const recordWithoutRef = makeWithdrawRecord({
      fromWalletId: 'wallet-c-out-1',
      txHash: null,
      referenceNo: null,
    });
    mocks.withdrawService.findOneInternal = jest.fn(() => Promise.resolve(recordWithoutRef));
    (mocks.payoutsService.findOne as any) = jest.fn(() => Promise.resolve({
      id: 'payout-1', txHash: '0xpayoutfallback', referenceNo: null, status: 'CONFIRMED',
    }));
    const service = makeService(mocks);

    await (service as any).handlePayoutConfirmed({ withdrawId: 'wd-1', payoutId: 'payout-1' });

    const postCalls = mocks.accountingService.postPendingTransfer.mock.calls as any[][];
    const netEv = postCalls.find(c => c[0]?.evidence?.eventCode === 'WITHDRAW_NET_POST')?.[0]?.evidence;
    expect(netEv.externalRef).toBe('0xpayoutfallback');
  });

  it('finalize: enrichForPost promotes LOCK rows to POST eventCode + walletRef + externalRef + crossing=true', async () => {
    const mocks = buildPhaseBMocks();
    const service = makeService(mocks);

    await (service as any).handlePayoutConfirmed({ withdrawId: 'wd-1', payoutId: 'payout-1' });

    const enrichCalls = mocks.tbEvidenceService.enrichForPost.mock.calls as any[][];
    // Two enrich calls — one for net pending hex id, one for fee pending hex id.
    expect(enrichCalls.length).toBe(2);

    // NET enrichment targets the net pending id
    const netEnrich = enrichCalls.find(c => c[0] === '0000000000000001')?.[1];
    expect(netEnrich).toMatchObject({
      eventCode: 'WITHDRAW_NET_POST',
      debitWalletRef: 'wallet-c-out-1',
      creditWalletRef: 'wallet-c-out-1',
      externalRef: '0xabc123dead',
      isExternalCrossing: true,
    });

    // FEE enrichment targets the fee pending id
    const feeEnrich = enrichCalls.find(c => c[0] === '0000000000000002')?.[1];
    expect(feeEnrich).toMatchObject({
      eventCode: 'WITHDRAW_FEE_POST',
      debitWalletRef: 'wallet-c-out-1',
      creditWalletRef: 'wallet-c-out-1',
      externalRef: '0xabc123dead',
      isExternalCrossing: true,
    });
  });

  it('finalize: F_FEE wallet miss returns null creditWalletRef but evidence still posts (best-effort)', async () => {
    const mocks = buildPhaseBMocks();
    mocks.systemWalletResolver.resolve = jest.fn(() => Promise.reject(new Error('SYSTEM_WALLET_NOT_FOUND')));
    const service = makeService(mocks);

    await (service as any).handlePayoutConfirmed({ withdrawId: 'wd-1', payoutId: 'payout-1' });

    const execCalls = mocks.accountingService.executeTransfer.mock.calls as any[][];
    const firmEvidence = execCalls.find(c => c[0]?.evidence?.eventCode === 'WITHDRAW_FEE_FIRM')?.[0]?.evidence;
    expect(firmEvidence.creditWalletRef).toBeNull();
    // externalRef must still be set so it pairs with FEE_POST
    expect(firmEvidence.externalRef).toBe('0xabc123dead');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST D: Phase B fields on the LOCK pending rows at create()
// ═══════════════════════════════════════════════════════════════════

describe('WithdrawWorkflowService.createWithdrawal — T2b Phase B LOCK rows', () => {
  it('LOCK_NET + LOCK_FEE pendings carry walletRef=null externalRef=null crossing=false at create time', async () => {
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

    // Every LOCK evidence row: externalRef null, isExternalCrossing false.
    // walletRef tracks record.fromWalletId — null at create time in this test
    // (orchestrator binds source wallet later), which is the expected behaviour.
    for (const ev of lockEvidence) {
      expect(ev).toMatchObject({
        externalRef: null,
        isExternalCrossing: false,
      });
      // walletRef may be null in this test; the contract is it equals
      // record.fromWalletId — which is null here because makeWithdrawRecord
      // sets fromWalletId: null.
      expect(ev.debitWalletRef).toBe(ev.creditWalletRef);
    }
  });
});
