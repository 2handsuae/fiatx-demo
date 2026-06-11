/**
 * withdraw-fee-income.service.spec.ts
 *
 * TwoBook T5: Asserts that:
 * (a) createWithdrawal (service.create) locks fee pending into FEE_INCOME, NOT FEE_RECEIVABLE
 * (b) withdraw-workflow handlePayoutConfirmed posts fee leg with creditCode = FEE_INCOME
 *
 * Mirror of swap-workflow.service.spec.ts (T4 pattern).
 */
import { WithdrawTransactionsService } from './withdraw-transactions.service';
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
// TEST A: WithdrawTransactionsService.create — fee pending → FEE_INCOME
// ═══════════════════════════════════════════════════════════════════

function buildServiceMocks() {
  const resolveMap: Record<number, bigint> = {
    [TB_ACCOUNT_CODES.CLIENT_PAYABLE]: 10n,
    [TB_ACCOUNT_CODES.CLIENT_CUSTODY]: 20n,
    [TB_ACCOUNT_CODES.CLIENT_BANK]: 25n,
    [120]: 30n, // FEE_RECEIVABLE (removed in Task 9) — must NOT be touched
    [TB_ACCOUNT_CODES.FEE_INCOME]: 40n,
  };

  let counter = 1n;
  const makeTx = () => ({ tbTransferId: counter++ });

  const accountingService = {
    resolveTbAccountId: jest.fn(({ code }: { code: number }) =>
      Promise.resolve(resolveMap[code] ?? 99n),
    ),
    executePendingTransfer: jest.fn(() => Promise.resolve(makeTx())),
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

  const transactionComplianceService = {
    runCheck: jest.fn(() => Promise.resolve({ action: 'PASS' })),
    assessTransaction: jest.fn(() => Promise.resolve({ action: 'PASS' })),
    scheduleComplianceCheck: jest.fn(() => Promise.resolve()),
  };

  const asset = { id: 'asset-usdt', currency: 'USDT', decimals: 6, type: 'CRYPTO' };
  const customer = {
    id: 'cust-1',
    customerNo: 'C0001',
    complianceStatus: 'ACTIVE',
    adminStatus: 'ACTIVE',
    onboardingStatus: 'APPROVED',
  };

  const createdRecord = makeWithdrawRecord();

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
    transactionComplianceService,
    prisma,
  };
}

describe('WithdrawTransactionsService — T5 fee account', () => {
  it('locks fee pending to FEE_INCOME, not FEE_RECEIVABLE', async () => {
    const mocks = buildServiceMocks();
    const service = new WithdrawTransactionsService(
      mocks.prisma,
      mocks.eventEmitter as any,
      mocks.transactionComplianceService as any,
      mocks.withdrawQuoteService as any,
      mocks.auditLogsService as any,
      mocks.accountingService as any,
    );

    await service.create(
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

    // Must resolve FEE_INCOME for fee leg
    expect(resolveCalls).toContain(TB_ACCOUNT_CODES.FEE_INCOME);

    // Must NOT resolve FEE_RECEIVABLE (code 120, removed in Task 9)
    expect(resolveCalls).not.toContain(120);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST B: WithdrawWorkflowService.handlePayoutConfirmed — post fee → FEE_INCOME
// ═══════════════════════════════════════════════════════════════════

function buildWorkflowMocks() {
  const accountingService = {
    postPendingTransfer: jest.fn(() => Promise.resolve({ tbTransferId: 1n })),
    voidPendingTransferBestEffort: jest.fn(() => Promise.resolve()),
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
        status: 'SUCCESS',
        withdrawId: 'wd-1',
      }),
    ),
  };
  const approvalsService = { completeApproval: jest.fn(() => Promise.resolve({})) };
  const binanceRateProvider = {};
  const fundTransferWorkflow = {};

  return {
    accountingService,
    auditLogsService,
    withdrawService,
    payoutsService,
    approvalsService,
    binanceRateProvider,
    fundTransferWorkflow,
  };
}

describe('WithdrawWorkflowService — T5 post fee evidence', () => {
  it('posts fee pending with creditCode = FEE_INCOME, not FEE_RECEIVABLE', async () => {
    const mocks = buildWorkflowMocks();
    const service = new WithdrawWorkflowService(
      mocks.withdrawService as any,
      mocks.auditLogsService as any,
      mocks.accountingService as any,
      mocks.payoutsService as any,
      mocks.approvalsService as any,
      mocks.binanceRateProvider as any,
      mocks.fundTransferWorkflow as any,
    );

    await (service as any).handlePayoutConfirmed({
      withdrawId: 'wd-1',
      payoutId: 'payout-1',
    });

    const postCalls = mocks.accountingService.postPendingTransfer.mock.calls as any[][];

    // At least one postPendingTransfer call is expected (fee leg)
    expect(postCalls.length).toBeGreaterThanOrEqual(1);

    // Collect all creditCode values from evidence
    const feeCreditCodes = postCalls
      .map((c) => c[0]?.evidence?.creditCode)
      .filter(Boolean);

    // At least one should be FEE_INCOME
    expect(feeCreditCodes).toContain(TB_CODE_TO_COA[TB_ACCOUNT_CODES.FEE_INCOME]);

    // None should be FEE_RECEIVABLE (code 120, removed in Task 9)
    expect(feeCreditCodes).not.toContain('120');
  });
});
