import { Prisma } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { WithdrawWorkflowService, IllegalSourceWalletError } from './withdraw-workflow.service';
import {
  WithdrawTransactionAction,
  WithdrawTransactionStatus,
} from './dto/withdraw-transaction.dto';
import { AuditActions } from '../../audit-logging/constants/audit-actions.constant';
import { FundsOrderStatus, FundsOrderAction } from '../../funds-orders/dto/funds-order.dto';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { hexToBigint } from '../../accounting/tigerbeetle/utils/tb-id.util';
import { ApprovalActionTypes, ApprovalStatuses } from '../../governance/approvals/constants/approval.constants';

describe('WithdrawWorkflowService — releaseLock on approval decline', () => {
  let workflow: WithdrawWorkflowService;
  let withdrawService: any;
  let auditLogsService: any;
  let accountingService: any;
  let fundsOrders: any;

  const declinedWithdrawal = {
    id: 'wd-decline-1',
    withdrawNo: 'WD9001',
    status: WithdrawTransactionStatus.PENDING_APPROVAL,
    ownerType: 'CUSTOMER',
    ownerId: 'user-1',
    traceId: 'trace-1',
    netAmount: new Prisma.Decimal(90),
    feeAmount: new Prisma.Decimal(10),
    tbPendingNetId: '1',
    tbPendingFeeId: '2',
    asset: { decimals: 8 },
  };

  beforeEach(() => {
    withdrawService = {
      findOneInternal: jest.fn().mockResolvedValue(declinedWithdrawal),
      getOwnerComplianceStatus: jest.fn().mockResolvedValue('ACTIVE'),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue({}),
    };
    accountingService = {
      voidPendingTransferBestEffort: jest.fn().mockResolvedValue(true),
    };

    // A6: 终态收口时还要把费腿这张资金单也 FAIL 掉(否则终态订单下永久挂活腿)

    fundsOrders = {
      findByParent: jest.fn().mockResolvedValue([{ id: 'fee-leg-1' }]),
      advance: jest.fn().mockResolvedValue(undefined),
    };

    workflow = new WithdrawWorkflowService(
      {} as any, // prisma
      {} as any, // eventEmitter
      withdrawService as any,
      {} as any, // withdrawQuoteService
      auditLogsService as any,
      accountingService as any,
      fundsOrders as any, // fundsOrders
      {} as any, // approvalsService
      {} as any, // binanceRateProvider
      {} as any, // systemWalletResolver
      {} as any, // tbEvidenceService
      {} as any, // limitGateService
      {} as any, // limitRulesService
      {} as any, // sumsubTxnClient
      {} as any, // applicantActions
      { assertCapability: jest.fn(), assertOffboardable: jest.fn(), resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }) } as any, // customerAccessService
      { open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST', created: true }) } as any, // customerRestrictionsService
      { evaluate: jest.fn().mockResolvedValue({ evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'WITHDRAW', verdict: 'PASS', holdReason: null, tradingTier: 'BASIC', checks: [] }) } as any, // l1Gate
    );
  });

  it('releases both pending locks and audits WITHDRAW_LOCK_RELEASED on decline', async () => {
    await workflow.onLargeValueApprovalDecided({
      decision: 'DECLINED',
      entityRef: declinedWithdrawal.id,
      approvalNo: 'AP-1',
      decisionReason: 'risk',
    });

    // THE P6 FIX: voids both pending transfers (net + fee).
    expect(accountingService.voidPendingTransferBestEffort).toHaveBeenCalledTimes(2);

    // Writes the lock-released audit.
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.WITHDRAW_LOCK_RELEASED }),
    );
  });
});

describe('WithdrawWorkflowService — releaseLock on payout leg failure (P6)', () => {
  let workflow: WithdrawWorkflowService;
  let withdrawService: any;
  let auditLogsService: any;
  let accountingService: any;
  let fundsOrders: any;

  const payoutPendingWithdrawal = {
    id: 'wd-payout-fail-1',
    withdrawNo: 'WD9100',
    status: WithdrawTransactionStatus.PAYOUT_PENDING,
    ownerType: 'CUSTOMER',
    ownerId: 'user-9',
    traceId: 'trace-9',
    netAmount: new Prisma.Decimal(90),
    feeAmount: new Prisma.Decimal(10),
    tbPendingNetId: '11',
    tbPendingFeeId: '22',
    asset: { decimals: 8 },
  };

  beforeEach(() => {
    withdrawService = {
      findOneInternal: jest.fn().mockResolvedValue(payoutPendingWithdrawal),
      getOwnerComplianceStatus: jest.fn().mockResolvedValue('ACTIVE'),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue({}),
    };
    accountingService = {
      voidPendingTransferBestEffort: jest.fn().mockResolvedValue(true),
    };

    // A6: 终态收口时还要把费腿这张资金单也 FAIL 掉(否则终态订单下永久挂活腿)

    fundsOrders = {
      findByParent: jest.fn().mockResolvedValue([{ id: 'fee-leg-1' }]),
      advance: jest.fn().mockResolvedValue(undefined),
    };

    workflow = new WithdrawWorkflowService(
      {} as any, // prisma
      {} as any, // eventEmitter
      withdrawService as any,
      {} as any, // withdrawQuoteService
      auditLogsService as any,
      accountingService as any,
      fundsOrders as any, // fundsOrders
      {} as any, // approvalsService
      {} as any, // binanceRateProvider
      {} as any, // systemWalletResolver
      {} as any, // tbEvidenceService
      {} as any, // limitGateService
      {} as any, // limitRulesService
      {} as any, // sumsubTxnClient
      {} as any, // applicantActions
      { assertCapability: jest.fn(), assertOffboardable: jest.fn(), resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }) } as any, // customerAccessService
      { open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST', created: true }) } as any, // customerRestrictionsService
      { evaluate: jest.fn().mockResolvedValue({ evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'WITHDRAW', verdict: 'PASS', holdReason: null, tradingTier: 'BASIC', checks: [] }) } as any, // l1Gate
    );
  });

  it('voids both pending locks, audits release, and fails the withdrawal when the payout leg FAILS', async () => {
    // Payout principal leg (legSeq 1) transitions to FAILED → funds_order event.
    await workflow.handleFundsOrderChanged({
      fundsOrderId: 'fo-payout-1',
      fundsOrderNo: 'FO-PAYOUT-1',
      parent: { withdrawTransactionId: payoutPendingWithdrawal.id },
      legSeq: 1,
      attempt: 1,
      oldStatus: FundsOrderStatus.SUBMITTED,
      newStatus: FundsOrderStatus.FAILED,
    });

    // Transitions the withdrawal toward FAILED.
    expect(withdrawService.updateStatus).toHaveBeenCalledWith(
      payoutPendingWithdrawal.id,
      expect.objectContaining({ action: WithdrawTransactionAction.FAIL }),
      expect.anything(),
    );

    // THE P6 FIX: voids both pending transfers (net + fee).
    expect(accountingService.voidPendingTransferBestEffort).toHaveBeenCalledTimes(2);

    // Writes the payout-failed + lock-released audits.
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.WITHDRAW_PAYOUT_FAILED }),
    );
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.WITHDRAW_LOCK_RELEASED }),
    );
  });

  // ── A6 (2026-08-13): 终态订单下不得再挂活资金单 ──────────────────────────────
  // 修复前 releaseLock 只解 TB 的锁,费腿那张**资金单**没人终结 → 一笔终态 FAILED 的提现
  // 底下永久挂一条非终态费腿:对账在途桶只增不减,且能被推单推成"已结清"
  // (自称收了费,实际客户的钱已解锁退回)。
  it('A6: 本金腿失败后,费腿这张资金单也必须被 FAIL(否则终态订单下永久挂活腿)', async () => {
    await workflow.handleFundsOrderChanged({
      fundsOrderId: 'fo-payout-1',
      fundsOrderNo: 'FO-PAYOUT-1',
      parent: { withdrawTransactionId: payoutPendingWithdrawal.id },
      legSeq: 1,
      attempt: 1,
      oldStatus: FundsOrderStatus.SUBMITTED,
      newStatus: FundsOrderStatus.FAILED,
    } as any);

    expect(fundsOrders.advance).toHaveBeenCalledWith('fee-leg-1', FundsOrderAction.FAIL, 'SYSTEM');

    // 顺序不变量:提现先落 FAILED,再 FAIL 费腿——否则 onFeeLegFailed 的
    // PAYOUT_PENDING 守卫会放行,走三级梯重建出一条新的活费腿。
    const statusOrder = withdrawService.updateStatus.mock.invocationCallOrder[0];
    const advanceOrder = fundsOrders.advance.mock.invocationCallOrder[0];
    expect(statusOrder).toBeLessThan(advanceOrder);
  });

  it('A6: 费腿 FAIL 抛错(已终态/非法转移)只 warn,不上抛——钱的路径已完成不可回滚', async () => {
    fundsOrders.advance.mockRejectedValue(new Error('already terminal'));

    await expect(
      workflow.handleFundsOrderChanged({
        fundsOrderId: 'fo-payout-1',
        fundsOrderNo: 'FO-PAYOUT-1',
        parent: { withdrawTransactionId: payoutPendingWithdrawal.id },
        legSeq: 1,
        attempt: 1,
        oldStatus: FundsOrderStatus.SUBMITTED,
        newStatus: FundsOrderStatus.FAILED,
      } as any),
    ).resolves.toBeUndefined();

    // 锁照解、审计照记 —— 资金单视图落后不影响钱
    expect(accountingService.voidPendingTransferBestEffort).toHaveBeenCalledTimes(2);
  });
});

describe('WithdrawWorkflowService — assertWithdrawSettled (乙 SUCCESS invariant)', () => {
  let workflow: WithdrawWorkflowService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      tbTransferEvidence: { findMany: jest.fn() },
    };

    workflow = new WithdrawWorkflowService(
      prisma as any, // prisma
      {} as any, // eventEmitter
      {} as any, // withdrawService
      {} as any, // withdrawQuoteService
      {} as any, // auditLogsService
      {} as any, // accountingService
      {} as any, // fundsOrders
      {} as any, // approvalsService
      {} as any, // binanceRateProvider
      {} as any, // systemWalletResolver
      {} as any, // tbEvidenceService
      {} as any, // limitGateService
      {} as any, // limitRulesService
      {} as any, // sumsubTxnClient
      {} as any, // applicantActions
      { assertCapability: jest.fn(), assertOffboardable: jest.fn(), resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }) } as any, // customerAccessService
      { open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST', created: true }) } as any, // customerRestrictionsService
      { evaluate: jest.fn().mockResolvedValue({ evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'WITHDRAW', verdict: 'PASS', holdReason: null, tradingTier: 'BASIC', checks: [] }) } as any, // l1Gate
    );
  });

  const baseWithdrawal = {
    id: 'wd-settle-1',
    withdrawNo: 'WD9200',
    tbPendingNetId: '101',
  };

  it('throws when firm-fee evidence (WITHDRAW_FEE_FIRM) is missing', async () => {
    prisma.tbTransferEvidence.findMany.mockResolvedValue([
      { eventCode: 'WITHDRAW_NET_POST' },
      { eventCode: 'WITHDRAW_FEE_POST' },
    ]);

    await expect(
      (workflow as any).assertWithdrawSettled(baseWithdrawal, 100n),
    ).rejects.toThrow(/WITHDRAW_FEE_FIRM/);
  });

  it('resolves when all settlement evidence (NET + FEE + FEE_FIRM) is present', async () => {
    prisma.tbTransferEvidence.findMany.mockResolvedValue([
      { eventCode: 'WITHDRAW_NET_POST' },
      { eventCode: 'WITHDRAW_FEE_POST' },
      { eventCode: 'WITHDRAW_FEE_FIRM' },
    ]);

    await expect(
      (workflow as any).assertWithdrawSettled(baseWithdrawal, 100n),
    ).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// R4: ensureSourceWalletBound — customer-owned source wallets only
//
// The fromWalletId of a customer withdrawal MUST be the customer's own wallet:
//   FIAT → walletRole = C_VIBAN, ownerType = CUSTOMER, ownerId = withdrawal.ownerId
//   CRYPTO → walletRole = C_DEP, ownerType = CUSTOMER, ownerId = withdrawal.ownerId
//
// Previously the FIAT branch hardcoded walletRole = C_CMA + ownerType = PLATFORM,
// which silently attached the customer's outflow to the platform pool wallet
// (3 of 3 FIAT withdrawals were misrouted in the demo seed). This regression
// suite locks the corrected behaviour.
// ─────────────────────────────────────────────────────────────

describe('WithdrawWorkflowService — ensureSourceWalletBound (R4)', () => {
  let workflow: WithdrawWorkflowService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      wallet: { findFirst: jest.fn() },
      withdrawTransaction: { update: jest.fn().mockResolvedValue(undefined) },
    };

    workflow = new WithdrawWorkflowService(
      prisma as any,
      {} as any, // eventEmitter
      {} as any, // withdrawService
      {} as any, // withdrawQuoteService
      {} as any, // auditLogsService
      {} as any, // accountingService
      {} as any, // fundsOrders
      {} as any, // approvalsService
      {} as any, // binanceRateProvider
      {} as any, // systemWalletResolver
      {} as any, // tbEvidenceService
      {} as any, // limitGateService
      {} as any, // limitRulesService
      {} as any, // sumsubTxnClient
      {} as any, // applicantActions
      { assertCapability: jest.fn(), assertOffboardable: jest.fn(), resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }) } as any, // customerAccessService
      { open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST', created: true }) } as any, // customerRestrictionsService
      { evaluate: jest.fn().mockResolvedValue({ evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'WITHDRAW', verdict: 'PASS', holdReason: null, tradingTier: 'BASIC', checks: [] }) } as any, // l1Gate
    );
  });

  it('FIAT withdrawal binds fromWalletId to the customer C_VIBAN (NOT platform C_CMA)', async () => {
    const customerViban = {
      id: 'wallet-viban-1',
      walletNo: 'WA-VIBAN-1',
      address: null,
      iban: 'AE07 0331 2345 6789',
    };
    prisma.wallet.findFirst.mockResolvedValue(customerViban);

    const fiatWithdrawal = {
      id: 'wd-fiat-1',
      ownerId: 'cust-1',
      assetId: 'asset-aed',
      fromWalletId: null,
      asset: { currency: 'AED', type: 'FIAT' },
    };

    const result = await (workflow as any).ensureSourceWalletBound(fiatWithdrawal);

    // R4 contract: walletRole = C_VIBAN, ownerType = CUSTOMER (NOT PLATFORM/C_CMA).
    expect(prisma.wallet.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          walletRole: 'C_VIBAN',
          ownerType: 'CUSTOMER',
          ownerId: 'cust-1',
          assetId: 'asset-aed',
          status: 'ACTIVE',
        }),
      }),
    );
    expect(result.fromWalletId).toBe('wallet-viban-1');
    expect(prisma.withdrawTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wd-fiat-1' },
        data: expect.objectContaining({ fromWalletId: 'wallet-viban-1' }),
      }),
    );
  });

  it('CRYPTO withdrawal still binds fromWalletId to the customer C_DEP (unchanged path)', async () => {
    const customerDep = {
      id: 'wallet-cdep-1',
      walletNo: 'WA-CDEP-1',
      address: '0xabc',
      iban: null,
    };
    prisma.wallet.findFirst.mockResolvedValue(customerDep);

    const cryptoWithdrawal = {
      id: 'wd-crypto-1',
      ownerId: 'cust-2',
      assetId: 'asset-usdt',
      fromWalletId: null,
      asset: { currency: 'USDT', type: 'CRYPTO' },
    };

    const result = await (workflow as any).ensureSourceWalletBound(cryptoWithdrawal);

    expect(prisma.wallet.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          walletRole: 'C_DEP',
          ownerType: 'CUSTOMER',
          ownerId: 'cust-2',
          assetId: 'asset-usdt',
          status: 'ACTIVE',
        }),
      }),
    );
    expect(result.fromWalletId).toBe('wallet-cdep-1');
  });

  it('throws IllegalSourceWalletError when the customer has no active C_VIBAN (FIAT)', async () => {
    prisma.wallet.findFirst.mockResolvedValue(null);

    const fiatWithdrawal = {
      id: 'wd-fiat-noviban',
      withdrawNo: 'WD-NO-VIBAN',
      ownerId: 'cust-orphan',
      assetId: 'asset-aed',
      fromWalletId: null,
      asset: { currency: 'AED', type: 'FIAT' },
    };

    await expect(
      (workflow as any).ensureSourceWalletBound(fiatWithdrawal),
    ).rejects.toBeInstanceOf(IllegalSourceWalletError);
    await expect(
      (workflow as any).ensureSourceWalletBound(fiatWithdrawal),
    ).rejects.toThrow(/C_VIBAN/);
    // No update is attempted when the precondition fails.
    expect(prisma.withdrawTransaction.update).not.toHaveBeenCalled();
  });

  it('throws IllegalSourceWalletError when the customer has no active C_DEP (CRYPTO)', async () => {
    prisma.wallet.findFirst.mockResolvedValue(null);

    const cryptoWithdrawal = {
      id: 'wd-crypto-nocdep',
      withdrawNo: 'WD-NO-CDEP',
      ownerId: 'cust-orphan',
      assetId: 'asset-usdt',
      fromWalletId: null,
      asset: { currency: 'USDT', type: 'CRYPTO' },
    };

    await expect(
      (workflow as any).ensureSourceWalletBound(cryptoWithdrawal),
    ).rejects.toBeInstanceOf(IllegalSourceWalletError);
    await expect(
      (workflow as any).ensureSourceWalletBound(cryptoWithdrawal),
    ).rejects.toThrow(/C_DEP/);
  });

  it('is a no-op when fromWalletId is already set (idempotent)', async () => {
    const alreadyBound = {
      id: 'wd-bound',
      ownerId: 'cust-3',
      assetId: 'asset-aed',
      fromWalletId: 'pre-existing-wallet-id',
      asset: { currency: 'AED', type: 'FIAT' },
    };

    const result = await (workflow as any).ensureSourceWalletBound(alreadyBound);

    expect(result).toBe(alreadyBound);
    expect(prisma.wallet.findFirst).not.toHaveBeenCalled();
    expect(prisma.withdrawTransaction.update).not.toHaveBeenCalled();
  });
});

// Task 2 ("出生即着陆"): every withdrawal is now BORN on COMPLIANCE_PENDING (not
// PENDING_APPROVAL) — handleWithdrawalCreated only proceeds when status is
// COMPLIANCE_PENDING, valuates, and either leaves the row there (below threshold)
// or routes it up to PENDING_APPROVAL via openApprovalGate's sanctioned
// birth-routing write (WithdrawTransactionsService#landOnPendingApproval), which
// bypasses updateStatus/transitions entirely (the 20-edge table has no edge for
// it). Also covers Task 5 review D1: threshold comes from the rule row
// (getLargeApprovalThreshold), not a dead constant, fail-closed on a missing rule
// or a failed re-valuation — with a sane reason string (never "≥ null AED").
describe('WithdrawWorkflowService.handleWithdrawalCreated — birth landing (Task 2) + D1 threshold source', () => {
  const event = {
    withdrawId: 'wd-hc-1',
    withdrawNo: 'WD7001',
    status: 'COMPLIANCE_PENDING',
    ownerType: 'CUSTOMER',
    ownerId: 'cust-hc',
    assetId: 'asset-usdt',
    amount: '100',
    traceId: 'trace-hc',
  };

  function buildWorkflow(opts: {
    fetchRate?: () => Promise<{ rate: Prisma.Decimal; fetchedAt: Date }>;
    threshold: Prisma.Decimal | null;
  }) {
    const row = {
      id: 'wd-hc-1',
      withdrawNo: 'WD7001',
      status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-hc',
      traceId: 'trace-hc',
      amount: new Prisma.Decimal('100'),
      asset: { currency: 'USDT', type: 'CRYPTO' },
    };
    const withdrawService = {
      findOneInternal: jest.fn().mockResolvedValue(row),
      getOwnerComplianceStatus: jest.fn().mockResolvedValue('ACTIVE'),
      saveValuationSnapshot: jest.fn().mockResolvedValue(undefined),
      linkApprovalCase: jest.fn().mockResolvedValue(undefined),
      landOnPendingApproval: jest.fn().mockResolvedValue(undefined),
    };
    const auditLogsService = { recordSystem: jest.fn().mockResolvedValue({}) };
    const approvalsService = {
      createAndSubmit: jest.fn().mockResolvedValue({ id: 'ap-hc', approvalNo: 'AP-HC-1' }),
    };
    const binanceRateProvider = {
      fetchRate: jest.fn(
        opts.fetchRate ??
          (() => Promise.resolve({ rate: new Prisma.Decimal('3.67'), fetchedAt: new Date() })),
      ),
    };
    const limitRulesService = {
      getLargeApprovalThreshold: jest.fn().mockResolvedValue(opts.threshold),
    };
    const workflow = new WithdrawWorkflowService(
      {} as any, // prisma
      {} as any, // eventEmitter
      withdrawService as any,
      {} as any, // withdrawQuoteService
      auditLogsService as any,
      {} as any, // accountingService
      {} as any, // fundsOrders
      approvalsService as any,
      binanceRateProvider as any,
      {} as any, // systemWalletResolver
      {} as any, // tbEvidenceService
      {} as any, // limitGateService
      limitRulesService as any,
      {} as any, // sumsubTxnClient
      {} as any, // applicantActions
      { assertCapability: jest.fn(), assertOffboardable: jest.fn(), resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }) } as any, // customerAccessService
      { open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST', created: true }) } as any, // customerRestrictionsService
      { evaluate: jest.fn().mockResolvedValue({ evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'WITHDRAW', verdict: 'PASS', holdReason: null, tradingTier: 'BASIC', checks: [] }) } as any, // l1Gate
    );
    return { workflow, withdrawService, approvalsService, binanceRateProvider, limitRulesService };
  }

  it('below-threshold: lands (stays) COMPLIANCE_PENDING — no approval case opened, no birth-routing write', async () => {
    const { workflow, withdrawService, approvalsService } = buildWorkflow({
      // default fetchRate → grossAedValue = 100 * 3.67 = 367, well under threshold.
      threshold: new Prisma.Decimal('200000'),
    });

    await workflow.handleWithdrawalCreated(event);

    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    expect(withdrawService.landOnPendingApproval).not.toHaveBeenCalled();
    expect(withdrawService.saveValuationSnapshot).toHaveBeenCalledWith(
      'wd-hc-1',
      expect.objectContaining({ rateFetchFailed: false }),
    );
  });

  it('≥200000 AED gross value: routes to PENDING_APPROVAL via the sanctioned birth-routing write, approval case linked first', async () => {
    const { workflow, withdrawService, approvalsService } = buildWorkflow({
      // 100 * 3000 = 300,000 AED ≥ 200,000 threshold.
      fetchRate: () => Promise.resolve({ rate: new Prisma.Decimal('3000'), fetchedAt: new Date() }),
      threshold: new Prisma.Decimal('200000'),
    });

    await workflow.handleWithdrawalCreated(event);

    expect(approvalsService.createAndSubmit).toHaveBeenCalledTimes(1);
    // linkApprovalCase must happen BEFORE the birth-routing write (comment/invariant
    // in openApprovalGate: never PENDING_APPROVAL with no linked approval case).
    const linkOrder = (withdrawService.linkApprovalCase as jest.Mock).mock.invocationCallOrder[0];
    const landOrder = (withdrawService.landOnPendingApproval as jest.Mock).mock.invocationCallOrder[0];
    expect(linkOrder).toBeLessThan(landOrder);
    expect(withdrawService.linkApprovalCase).toHaveBeenCalledWith('wd-hc-1', 'ap-hc', 'AP-HC-1');
    // The status write is direct (WithdrawTransactionsService#landOnPendingApproval),
    // NOT updateStatus/transitions — the 20-edge table has no such edge.
    expect(withdrawService.landOnPendingApproval).toHaveBeenCalledWith('wd-hc-1');
  });

  it('reads getLargeApprovalThreshold(WITHDRAWAL); a null rule fail-closes to approval with a sane reason (no "≥ null AED")', async () => {
    const { workflow, withdrawService, approvalsService, limitRulesService } = buildWorkflow({
      threshold: null,
    });

    await workflow.handleWithdrawalCreated(event);

    expect(limitRulesService.getLargeApprovalThreshold).toHaveBeenCalledWith('WITHDRAWAL');
    // Fail-closed on the missing rule → approval, not compliance.
    expect(approvalsService.createAndSubmit).toHaveBeenCalledTimes(1);
    expect(withdrawService.landOnPendingApproval).toHaveBeenCalledWith('wd-hc-1');
    const reason = (approvalsService.createAndSubmit as jest.Mock).mock.calls[0][1].reason as string;
    expect(reason).not.toContain('null');
    expect(reason).toContain('large-value approval required');
  });

  it('valuation failure (rate provider throws): fail-closes to approval, PENDING_APPROVAL via birth-routing write', async () => {
    const { workflow, withdrawService, approvalsService } = buildWorkflow({
      fetchRate: () => Promise.reject(new Error('binance timeout')),
      threshold: new Prisma.Decimal('200000'),
    });

    await workflow.handleWithdrawalCreated(event);

    // Persistence receives the FAILED valuation; the domain no-clobber guard
    // (asserted directly in withdraw-transactions.service.spec) protects any
    // good birth-value from being downgraded to null here.
    expect(withdrawService.saveValuationSnapshot).toHaveBeenCalledWith(
      'wd-hc-1',
      expect.objectContaining({ grossAedValue: null, rateFetchFailed: true }),
    );
    // Approval decision fail-closes on the fresh failure regardless of threshold.
    expect(approvalsService.createAndSubmit).toHaveBeenCalledTimes(1);
    expect(withdrawService.landOnPendingApproval).toHaveBeenCalledWith('wd-hc-1');
    const reason = (approvalsService.createAndSubmit as jest.Mock).mock.calls[0][1].reason as string;
    expect(reason).toContain('200000');
  });

  it('openApprovalGate failure (approvalsService throws): the birth-routing write never runs, row stays COMPLIANCE_PENDING', async () => {
    const { workflow, withdrawService, approvalsService } = buildWorkflow({
      threshold: null, // fail-closed → routes into openApprovalGate
    });
    approvalsService.createAndSubmit.mockRejectedValue(new Error('approvals service down'));

    await expect(workflow.handleWithdrawalCreated(event)).rejects.toThrow('approvals service down');

    // Never linked, never routed — the row is cleanly left in COMPLIANCE_PENDING
    // (funds still locked, retriable on the next WITHDRAWAL_CREATED replay).
    expect(withdrawService.linkApprovalCase).not.toHaveBeenCalled();
    expect(withdrawService.landOnPendingApproval).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// Task 5: submitSumsubTxn + applyKytVerdict (real Sumsub single-txn submit +
// verdict-driven state machine, replacing the old preKyt/travelRule mock).
// ─────────────────────────────────────────────────────────────

function buildFullWorkflow(overrides: {
  withdrawService?: Partial<Record<string, jest.Mock>>;
  sumsubTxnClient?: Partial<Record<string, jest.Mock>>;
  applicantActions?: Partial<Record<string, jest.Mock>>;
  customerRestrictionsService?: Partial<Record<string, jest.Mock>>;
} = {}) {
  const withdrawService = {
    findOneInternal: jest.fn(),
    getOwnerComplianceStatus: jest.fn().mockResolvedValue('ACTIVE'),
    setSumsubTxn: jest.fn().mockResolvedValue(undefined),
    saveSumsubVerdict: jest.fn().mockResolvedValue(undefined),
    setSlaDeadline: jest.fn().mockResolvedValue(undefined),
    // reissue 路径(applyKytAwaitUser 的 clearWithdrawCache 调用点)显式查一次
    // 收口处同一张配置表 —— mock 出一个恒有效的 ACTION_PENDING deadline。
    resolveSlaFields: jest.fn().mockReturnValue({
      slaDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      slaBreached: false,
    }),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    markNeedsReview: jest.fn().mockResolvedValue(undefined),
    ...overrides.withdrawService,
  };
  const auditLogsService = { recordSystem: jest.fn().mockResolvedValue({}) };
  const accountingService = { voidPendingTransferBestEffort: jest.fn().mockResolvedValue(true) };
  const sumsubTxnClient = {
    submitTxn: jest.fn().mockResolvedValue({ txnId: 'SUMSUB-TXN-1' }),
    getTxn: jest.fn(),
    rescore: jest.fn(),
    reviewComplete: jest.fn(),
    ...overrides.sumsubTxnClient,
  };
  // Default hasOutstanding=true so the pre-existing awaitUser-progression tests
  // (written before the 集合同步/zero-outstanding guard existed) keep exercising
  // the "enters ACTION_PENDING" path without each test having to opt in; the new
  // zero-outstanding tests below override it explicitly per case.
  const applicantActions = {
    syncApplicantActions: jest.fn().mockResolvedValue({ added: [], retired: [] }),
    hasOutstanding: jest.fn().mockResolvedValue(true),
    clearWithdrawCache: jest.fn().mockResolvedValue(undefined),
    findBySeq: jest.fn(),
    submitBySeq: jest.fn(),
    ...overrides.applicantActions,
  };
  const customerRestrictionsService = {
    open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST', created: true }),
    ...overrides.customerRestrictionsService,
  };

  const workflow = new WithdrawWorkflowService(
    {} as any, // prisma
    {} as any, // eventEmitter
    withdrawService as any,
    {} as any, // withdrawQuoteService
    auditLogsService as any,
    accountingService as any,
    {} as any, // fundsOrders
    {} as any, // approvalsService
    {} as any, // binanceRateProvider
    {} as any, // systemWalletResolver
    {} as any, // tbEvidenceService
    {} as any, // limitGateService
    {} as any, // limitRulesService
    sumsubTxnClient as any,
    applicantActions as any,
    { assertCapability: jest.fn(), assertOffboardable: jest.fn(), resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }) } as any, // customerAccessService
    customerRestrictionsService as any,
    { evaluate: jest.fn().mockResolvedValue({ evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'WITHDRAW', verdict: 'PASS', holdReason: null, tradingTier: 'BASIC', checks: [] }) } as any, // l1Gate
  );

  return { workflow, withdrawService, auditLogsService, accountingService, sumsubTxnClient, applicantActions, customerRestrictionsService };
}

function baseWithdrawRow(overrides: Record<string, any> = {}) {
  return {
    id: 'wd-sumsub-1',
    withdrawNo: 'WD-SUMSUB-1',
    status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
    ownerType: 'CUSTOMER',
    ownerId: 'cust-1',
    traceId: 'trace-1',
    amount: new Prisma.Decimal('100'),
    netAmount: new Prisma.Decimal('95'),
    feeAmount: new Prisma.Decimal('5'),
    counterpartyIsVasp: false,
    sumsubTxnId: null,
    asset: { type: 'CRYPTO', currency: 'USDT', decimals: 8 },
    customer: { sumsubApplicantId: 'APPLICANT-1' },
    tbPendingNetId: null,
    tbPendingFeeId: null,
    ...overrides,
  };
}

describe('WithdrawWorkflowService.submitSumsubTxn (private, Task 5)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('idempotent: withdrawal already has sumsubTxnId → skips submitTxn entirely', async () => {
    const { workflow, withdrawService, sumsubTxnClient } = buildFullWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(baseWithdrawRow({ sumsubTxnId: 'ALREADY-SUBMITTED' }));

    await (workflow as any).submitSumsubTxn('wd-sumsub-1');

    expect(sumsubTxnClient.submitTxn).not.toHaveBeenCalled();
    expect(withdrawService.setSumsubTxn).not.toHaveBeenCalled();
  });

  it('guard: status is not COMPLIANCE_PENDING → skips (no submit)', async () => {
    const { workflow, withdrawService, sumsubTxnClient } = buildFullWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(
      baseWithdrawRow({ status: WithdrawTransactionStatus.PAYOUT_PENDING }),
    );

    await (workflow as any).submitSumsubTxn('wd-sumsub-1');

    expect(sumsubTxnClient.submitTxn).not.toHaveBeenCalled();
  });

  it('missing applicant: customer has no sumsubApplicantId → warns + skips, stays COMPLIANCE_PENDING (no throw)', async () => {
    const { workflow, withdrawService, sumsubTxnClient } = buildFullWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(baseWithdrawRow({ customer: {} }));

    await expect((workflow as any).submitSumsubTxn('wd-sumsub-1')).resolves.toBeUndefined();

    expect(sumsubTxnClient.submitTxn).not.toHaveBeenCalled();
    expect(withdrawService.setSumsubTxn).not.toHaveBeenCalled();
  });

  it('I2: submitTxn throws (real HTTP failure) → caught internally, never strands the withdrawal (no throw propagates)', async () => {
    const { workflow, withdrawService, sumsubTxnClient } = buildFullWorkflow({
      sumsubTxnClient: { submitTxn: jest.fn().mockRejectedValue(new Error('sumsub down')) },
    });
    withdrawService.findOneInternal.mockResolvedValue(baseWithdrawRow());

    await expect((workflow as any).submitSumsubTxn('wd-sumsub-1')).resolves.toBeUndefined();

    expect(withdrawService.setSumsubTxn).not.toHaveBeenCalled();
  });

  it('success: submits with direction=out, clientTxnId=withdrawNo, persists sumsubTxnId/Type, audits WITHDRAW_SUMSUB_SUBMITTED', async () => {
    const { workflow, withdrawService, auditLogsService, sumsubTxnClient } = buildFullWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(baseWithdrawRow());

    await (workflow as any).submitSumsubTxn('wd-sumsub-1');

    expect(sumsubTxnClient.submitTxn).toHaveBeenCalledWith(
      expect.objectContaining({
        applicantId: 'APPLICANT-1',
        clientTxnId: 'WD-SUMSUB-1',
        direction: 'out',
        amount: 100,
        currencyCode: 'USDT',
        currencyType: 'crypto',
      }),
    );
    expect(withdrawService.setSumsubTxn).toHaveBeenCalledWith('wd-sumsub-1', {
      sumsubTxnId: 'SUMSUB-TXN-1',
      sumsubTxnType: 'finance',
    });
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.WITHDRAW_SUMSUB_SUBMITTED }),
    );
  });

  it('travelRule decision under SUMSUB_MOCK_MODE=true: crypto+VASP+over-threshold → type=travelRule', async () => {
    process.env.SUMSUB_MOCK_MODE = 'true';
    delete process.env.SUMSUB_SINGLE_TXN_SUBMIT;
    const { workflow, withdrawService, sumsubTxnClient } = buildFullWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(
      baseWithdrawRow({ counterpartyIsVasp: true, amount: new Prisma.Decimal('5000') }),
    );

    await (workflow as any).submitSumsubTxn('wd-sumsub-1');

    expect(sumsubTxnClient.submitTxn).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'travelRule' }),
    );
  });

  it('switch OFF (SUMSUB_MOCK_MODE/SUMSUB_SINGLE_TXN_SUBMIT both unset): still submits once, forced to type=finance', async () => {
    delete process.env.SUMSUB_MOCK_MODE;
    delete process.env.SUMSUB_SINGLE_TXN_SUBMIT;
    const { workflow, withdrawService, sumsubTxnClient } = buildFullWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(
      baseWithdrawRow({ counterpartyIsVasp: true, amount: new Prisma.Decimal('5000') }),
    );

    await (workflow as any).submitSumsubTxn('wd-sumsub-1');

    expect(sumsubTxnClient.submitTxn).toHaveBeenCalledTimes(1);
    expect(sumsubTxnClient.submitTxn).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'finance' }),
    );
  });
});

describe('WithdrawWorkflowService.applyKytVerdict (Task 5: verdict-driven state machine)', () => {
  it('terminal statuses (SUCCESS/REJECTED/FAILED/RETURNED) → no-op, no evidence write', async () => {
    for (const status of [
      WithdrawTransactionStatus.SUCCESS,
      WithdrawTransactionStatus.REJECTED,
      WithdrawTransactionStatus.FAILED,
      WithdrawTransactionStatus.RETURNED,
    ]) {
      const { workflow, withdrawService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(baseWithdrawRow({ status }));

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'approved', riskScore: 5 });

      expect(withdrawService.saveSumsubVerdict).not.toHaveBeenCalled();
      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
    }
  });

  it('FROZEN + late/re-evaluated approved → full no-op (evidence NOT written, no status flip)', async () => {
    const { workflow, withdrawService } = buildFullWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(
      baseWithdrawRow({ status: WithdrawTransactionStatus.FROZEN }),
    );
    const initiateSpy = jest
      .spyOn(workflow as any, 'initiatePayoutPhase')
      .mockResolvedValue(undefined);

    await workflow.applyKytVerdict('wd-sumsub-1', {
      verdict: 'approved',
      riskScore: 5,
      detailRaw: { txnId: 'late-approved' },
    });

    expect(withdrawService.saveSumsubVerdict).not.toHaveBeenCalled();
    expect(withdrawService.updateStatus).not.toHaveBeenCalled();
    expect(initiateSpy).not.toHaveBeenCalled();
  });

  // ── 第一批 (2026-08-19): 三段结构 —— 判定先于写库 ──────────────────────
  it.each(['onHold', 'awaitUser', 'rejected'] as const)(
    'B2: FROZEN 收到迟到 %s → 不覆写证据 + IGNORED 审计 + 不抛',
    async (verdict) => {
      const { workflow, withdrawService, auditLogsService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({
          id: 'wd-b2',
          withdrawNo: 'WDB2',
          status: WithdrawTransactionStatus.FROZEN,
        }),
      );

      await expect(
        workflow.applyKytVerdict('wd-b2', {
          verdict,
          riskScore: 50,
          detailRaw: { late: true },
        }),
      ).resolves.toBeUndefined();

      expect(withdrawService.saveSumsubVerdict).not.toHaveBeenCalled();
      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.WITHDRAW_KYT_VERDICT_IGNORED,
          primarySubjectNo: 'WDB2',
        }),
      );
    },
  );

  it('B2: FROZEN 收到迟到 approved → 同样留痕（此前只有 logger.debug）', async () => {
    const { workflow, withdrawService, auditLogsService } = buildFullWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(
      baseWithdrawRow({
        id: 'wd-b2b',
        withdrawNo: 'WDB2B',
        status: WithdrawTransactionStatus.FROZEN,
      }),
    );

    await workflow.applyKytVerdict('wd-b2b', { verdict: 'approved' });

    expect(withdrawService.saveSumsubVerdict).not.toHaveBeenCalled();
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.WITHDRAW_KYT_VERDICT_IGNORED }),
    );
  });

  it('B2: SUCCESS 终态收到迟到 rejected → 留痕（此前零审计）', async () => {
    const { workflow, withdrawService, auditLogsService } = buildFullWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(
      baseWithdrawRow({
        id: 'wd-b2c',
        withdrawNo: 'WDB2C',
        status: WithdrawTransactionStatus.SUCCESS,
      }),
    );

    await workflow.applyKytVerdict('wd-b2c', { verdict: 'rejected', riskScore: 98 });

    expect(withdrawService.saveSumsubVerdict).not.toHaveBeenCalled();
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.WITHDRAW_KYT_VERDICT_IGNORED,
        metadata: expect.objectContaining({ verdict: 'rejected', riskScore: 98 }),
      }),
    );
  });

  describe('approved branch — three legal entry states', () => {
    it('from COMPLIANCE_PENDING → delegates to initiatePayoutPhase, no manual-approved audit', async () => {
      const { workflow, withdrawService, auditLogsService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.COMPLIANCE_PENDING }),
      );
      const initiateSpy = jest
        .spyOn(workflow as any, 'initiatePayoutPhase')
        .mockResolvedValue(undefined);

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'approved', riskScore: 3 });

      expect(withdrawService.saveSumsubVerdict).toHaveBeenCalledWith(
        'wd-sumsub-1',
        expect.objectContaining({ verdict: 'approved', score: 3 }),
      );
      expect(initiateSpy).toHaveBeenCalledWith('wd-sumsub-1');
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_MANUAL_APPROVED }),
      );
    });

    it('from ACTION_PENDING (re-evaluated after补料) → delegates to initiatePayoutPhase, no manual-approved audit', async () => {
      const { workflow, withdrawService, auditLogsService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.ACTION_PENDING }),
      );
      const initiateSpy = jest
        .spyOn(workflow as any, 'initiatePayoutPhase')
        .mockResolvedValue(undefined);

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'approved', riskScore: 3 });

      expect(initiateSpy).toHaveBeenCalledWith('wd-sumsub-1');
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_MANUAL_APPROVED }),
      );
    });

    it('from MANUAL_CHECKING → records WITHDRAW_MANUAL_APPROVED (翻案) THEN delegates to initiatePayoutPhase', async () => {
      const { workflow, withdrawService, auditLogsService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.MANUAL_CHECKING }),
      );
      const initiateSpy = jest
        .spyOn(workflow as any, 'initiatePayoutPhase')
        .mockResolvedValue(undefined);

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'approved', riskScore: 3 });

      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_MANUAL_APPROVED, primarySubjectNo: 'WD-SUMSUB-1' }),
      );
      expect(initiateSpy).toHaveBeenCalledWith('wd-sumsub-1');
    });
  });

  describe('awaitUser branch — atomic extraData (manualReason only; SLA 由收口处的 resolveSlaFields 统一算)', () => {
    it('sceneTag=PEP → manualReason=EDD_PEP, single atomic updateStatus call, extraData 不带 slaDeadline/slaBreached', async () => {
      const { workflow, withdrawService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.COMPLIANCE_PENDING }),
      );

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'awaitUser', sceneTag: 'PEP' });

      expect(withdrawService.updateStatus).toHaveBeenCalledTimes(1);
      const [, dto, ctx] = withdrawService.updateStatus.mock.calls[0];
      expect(dto.action).toBe(WithdrawTransactionAction.ACTION_PENDING);
      expect((ctx as any).extraData.manualReason).toBe('EDD_PEP');
      // 2026-08-21 第三批：进入 ACTION_PENDING 的 slaDeadline/slaBreached 由
      // updateStatus 内部的 resolveSlaFields(收口处)统一算,extraData 不再带这两个 key
      // ——否则会覆盖收口处刚算好的值。
      expect((ctx as any).extraData).not.toHaveProperty('slaDeadline');
      expect((ctx as any).extraData).not.toHaveProperty('slaBreached');
    });

    it('no sceneTag (general) → manualReason=CLIENT_ACTION', async () => {
      const { workflow, withdrawService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.COMPLIANCE_PENDING }),
      );

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'awaitUser' });

      const [, , ctx] = withdrawService.updateStatus.mock.calls[0];
      expect((ctx as any).extraData.manualReason).toBe('CLIENT_ACTION');
    });

    it('idempotent: already ACTION_PENDING → no-op (repeat webhook)', async () => {
      const { workflow, withdrawService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.ACTION_PENDING }),
      );

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'awaitUser' });

      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('onHold branch — non-transitional, COMPLIANCE_PENDING guard', () => {
    // 2026-08-21 第三批：onHold 与 SLA 解绑（业主裁定「onHold 从来没表达过 SLA，
    // 跟它一点关系都没有」）。SLA 只按「状态」计时，onHold 回调不再触碰 slaDeadline，
    // 但 WITHDRAW_ONHOLD 审计这一事实仍要记录。
    it('onHold 不改变 slaDeadline —— SLA 按状态计时,与 webhook 无关', async () => {
      const { workflow, withdrawService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.COMPLIANCE_PENDING }),
      );

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'onHold' });

      expect(withdrawService.setSlaDeadline).not.toHaveBeenCalled();
      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
    });

    it('onHold 仍写 WITHDRAW_ONHOLD 审计', async () => {
      const { workflow, withdrawService, auditLogsService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.COMPLIANCE_PENDING }),
      );

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'onHold' });

      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_ONHOLD }),
      );
    });

    it('guard: ACTION_PENDING (already moved on) → no-op, late onHold webhook ignored', async () => {
      const { workflow, withdrawService, auditLogsService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.ACTION_PENDING }),
      );

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'onHold' });

      expect(withdrawService.setSlaDeadline).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_ONHOLD }),
      );
      // Fix 1（终审 Important）：与充值域同族的漏格 —— 此前 decideVerdictLanding 不看
      // verdict，onHold 在此状态会先写证据（saveSumsubVerdict）再被 applyKytOnHold 自己
      // 的守卫静默 return，零审计、零报错。现在必须在写库前就判 IGNORE。
      expect(withdrawService.saveSumsubVerdict).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_KYT_VERDICT_IGNORED }),
      );
    });
  });

  describe('rejected branch — tag three-way (SANCTION_COUNTERPARTY/FROZEN_BY_MLRO → FREEZE; REJECT_REFUND → REJECTED+releaseLock; no tag → MANUAL_CHECKING)', () => {
    it('sceneTag=SANCTION_COUNTERPARTY from COMPLIANCE_PENDING → FREEZE + audits WITHDRAW_FROZEN', async () => {
      const { workflow, withdrawService, auditLogsService, customerRestrictionsService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.COMPLIANCE_PENDING }),
      );

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'rejected', sceneTag: 'SANCTION_COUNTERPARTY' });

      expect(withdrawService.updateStatus).toHaveBeenCalledWith(
        'wd-sumsub-1',
        expect.objectContaining({ action: WithdrawTransactionAction.FREEZE }),
        expect.anything(),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_FROZEN }),
      );
      // Task 6：对手方被制裁 ≠ 客户本人被制裁 —— 只冻这一单，绝不冻人。
      expect(customerRestrictionsService.open).not.toHaveBeenCalled();
    });

    it('sceneTag=SANCTION_APPLICANT from COMPLIANCE_PENDING → 先冻人(open cause=SANCTION)再冻单 FREEZE', async () => {
      const { workflow, withdrawService, auditLogsService, customerRestrictionsService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({
          id: 'wd-sumsub-applicant',
          withdrawNo: 'WD-SANCTION-APPLICANT',
          ownerId: 'cust-applicant-1',
          status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
        }),
      );

      await workflow.applyKytVerdict('wd-sumsub-applicant', { verdict: 'rejected', sceneTag: 'SANCTION_APPLICANT' });

      // 冻人：customerRestrictionsService.open() 必须以 cause: 'SANCTION' 被调用，
      // 且必须发生在 updateStatus(FREEZE) 之前（先冻人、再冻单，顺序 load-bearing）。
      // caseRef 会被 openWithin 顶成 customerNo（SANCTION 是客户级因由），真正承载
      // 「哪笔单牵出来的」取证线索的是 reason —— 必须钉住提现单号。
      expect(customerRestrictionsService.open).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-applicant-1',
          cause: 'SANCTION',
          caseRef: 'WD-SANCTION-APPLICANT',
          reason: expect.stringContaining('WD-SANCTION-APPLICANT'),
        }),
      );
      const openOrder = customerRestrictionsService.open.mock.invocationCallOrder[0];
      const updateStatusOrder = withdrawService.updateStatus.mock.invocationCallOrder[0];
      expect(openOrder).toBeLessThan(updateStatusOrder);

      expect(withdrawService.updateStatus).toHaveBeenCalledWith(
        'wd-sumsub-applicant',
        expect.objectContaining({ action: WithdrawTransactionAction.FREEZE }),
        expect.anything(),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_FROZEN }),
      );
    });

    it('dispoTag=FROZEN_BY_MLRO from ACTION_PENDING → FREEZE', async () => {
      const { workflow, withdrawService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.ACTION_PENDING }),
      );

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'rejected', dispoTag: 'FROZEN_BY_MLRO' });

      expect(withdrawService.updateStatus).toHaveBeenCalledWith(
        'wd-sumsub-1',
        expect.objectContaining({ action: WithdrawTransactionAction.FREEZE }),
        expect.anything(),
      );
    });

    it('idempotent: already FROZEN + sceneTag=SANCTION_COUNTERPARTY → no-op (repeat webhook, no double freeze)', async () => {
      const { workflow, withdrawService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.FROZEN }),
      );

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'rejected', sceneTag: 'SANCTION_COUNTERPARTY' });

      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
    });

    // ── 终审必修 (2026-08-20)：FROZEN 单撞上迟到的 SANCTION_APPLICANT 裁决 ─────
    // 失败场景:客户因 ADMIN_SUSPENSION(等级升级被拒/补料周期终止/admin 手工停用,
    // scope=['ALL'] 广播)被摁住 → 本域 onCustomerRestrictionOpened 把这笔在途提现
    // 冻成 FROZEN → 该单自己的 SANCTION_APPLICANT 裁决随后到达 → decideVerdictLanding
    // 对 FROZEN 一律判 IGNORE → 修复前直接 return,制裁命中被整条丢弃:人不被冻,
    // 运营解除 ADMIN_SUSPENSION 便签后客户完全自由。
    it('FROZEN 单 + 迟到 SANCTION_APPLICANT 裁决 → 仍冻人(open cause=SANCTION)+ 写审计,单据状态不变(不推动状态机)', async () => {
      const { workflow, withdrawService, auditLogsService, customerRestrictionsService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({
          id: 'wd-sanction-frozen',
          withdrawNo: 'WD-SANCTION-FROZEN',
          ownerId: 'cust-frozen-applicant',
          status: WithdrawTransactionStatus.FROZEN,
        }),
      );

      await workflow.applyKytVerdict('wd-sanction-frozen', {
        verdict: 'rejected',
        sceneTag: 'SANCTION_APPLICANT',
      });

      // 冻人:customerRestrictionsService.open() 必须以 cause: 'SANCTION' 被调用,
      // 即便单据本身早已是 FROZEN、状态机这一步完全不动。
      expect(customerRestrictionsService.open).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-frozen-applicant',
          cause: 'SANCTION',
          caseRef: 'WD-SANCTION-FROZEN',
          reason: expect.stringContaining('WD-SANCTION-FROZEN'),
        }),
      );

      // 写审计:MLRO 要能查到"虽然单子没动,但人被冻了"。
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.WITHDRAW_SANCTION_HIT_ON_IGNORED_VERDICT,
          primarySubjectNo: 'WD-SANCTION-FROZEN',
        }),
      );

      // 「判定先于写库」不变量必须保住:单子本来就该留在 FROZEN,不推动状态机。
      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
    });

    it('FROZEN 单 + 迟到 SANCTION_COUNTERPARTY 裁决 → 不冻人(对手方命中,只冻单,单早已 FROZEN)', async () => {
      const { workflow, withdrawService, auditLogsService, customerRestrictionsService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({
          id: 'wd-counterparty-frozen',
          withdrawNo: 'WD-COUNTERPARTY-FROZEN',
          status: WithdrawTransactionStatus.FROZEN,
        }),
      );

      await workflow.applyKytVerdict('wd-counterparty-frozen', {
        verdict: 'rejected',
        sceneTag: 'SANCTION_COUNTERPARTY',
      });

      expect(customerRestrictionsService.open).not.toHaveBeenCalled();
      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_SANCTION_HIT_ON_IGNORED_VERDICT }),
      );
    });

    it('FROZEN 单 + 迟到普通 rejected(无 sceneTag)→ 不冻人', async () => {
      const { workflow, withdrawService, auditLogsService, customerRestrictionsService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({
          id: 'wd-plain-frozen',
          withdrawNo: 'WD-PLAIN-FROZEN',
          status: WithdrawTransactionStatus.FROZEN,
        }),
      );

      await workflow.applyKytVerdict('wd-plain-frozen', { verdict: 'rejected' });

      expect(customerRestrictionsService.open).not.toHaveBeenCalled();
      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_SANCTION_HIT_ON_IGNORED_VERDICT }),
      );
    });

    it('recordVerdictIgnored 的 metadata 里能查到 sceneTag(取证链不再断)', async () => {
      const { workflow, withdrawService, auditLogsService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({
          id: 'wd-metadata-frozen',
          withdrawNo: 'WD-METADATA-FROZEN',
          ownerId: 'cust-metadata',
          status: WithdrawTransactionStatus.FROZEN,
        }),
      );

      await workflow.applyKytVerdict('wd-metadata-frozen', {
        verdict: 'rejected',
        sceneTag: 'SANCTION_APPLICANT',
      });

      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.WITHDRAW_KYT_VERDICT_IGNORED,
          metadata: expect.objectContaining({ sceneTag: 'SANCTION_APPLICANT' }),
        }),
      );
    });

    it('dispoTag=REJECT_REFUND from MANUAL_CHECKING → REJECT_REFUND action + releaseLock (void both pending) + WITHDRAW_REFUNDED_BY_TAG audit', async () => {
      const { workflow, withdrawService, auditLogsService, accountingService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({
          status: WithdrawTransactionStatus.MANUAL_CHECKING,
          tbPendingNetId: '01',
          tbPendingFeeId: '02',
        }),
      );

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'rejected', dispoTag: 'REJECT_REFUND' });

      expect(withdrawService.updateStatus).toHaveBeenCalledWith(
        'wd-sumsub-1',
        expect.objectContaining({ action: WithdrawTransactionAction.REJECT_REFUND }),
        expect.anything(),
      );
      // releaseLock voids both pending locks (net + fee).
      expect(accountingService.voidPendingTransferBestEffort).toHaveBeenCalledTimes(2);
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_REFUNDED_BY_TAG }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_LOCK_RELEASED }),
      );
    });

    // Review Fix 1 (Critical): REJECT_REFUND must not bypass the FROZEN maker-checker.
    it('dispoTag=REJECT_REFUND from FROZEN → full no-op (no status change, no releaseLock) + WITHDRAW_KYT_VERDICT_IGNORED audit', async () => {
      const { workflow, withdrawService, auditLogsService, accountingService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({
          status: WithdrawTransactionStatus.FROZEN,
          tbPendingNetId: '01',
          tbPendingFeeId: '02',
        }),
      );

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'rejected', dispoTag: 'REJECT_REFUND' });

      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      expect(accountingService.voidPendingTransferBestEffort).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_REFUNDED_BY_TAG }),
      );
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_LOCK_RELEASED }),
      );
      // 第一批 (2026-08-19)：FROZEN + 任意 verdict 一律判 IGNORE（含 REJECT_REFUND
      // 标签），判定层在到达 applyKytRejected 内部那段专属 FROZEN 守卫之前就已
      // 拦截并 return，不再穿透到 WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED，统一走
      // 通用 WITHDRAW_KYT_VERDICT_IGNORED 审计（spec §2.2）。
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_KYT_VERDICT_IGNORED }),
      );
    });

    // Review Fix 1: REJECT_REFUND has no transition edge from COMPLIANCE_PENDING/
    // ACTION_PENDING — land on KYT_REJECTED (→ MANUAL_CHECKING) instead of throwing.
    it('dispoTag=REJECT_REFUND from COMPLIANCE_PENDING → lands KYT_REJECTED (MANUAL_CHECKING), no releaseLock', async () => {
      const { workflow, withdrawService, accountingService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.COMPLIANCE_PENDING }),
      );

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'rejected', dispoTag: 'REJECT_REFUND' });

      expect(withdrawService.updateStatus).toHaveBeenCalledWith(
        'wd-sumsub-1',
        expect.objectContaining({ action: WithdrawTransactionAction.KYT_REJECTED }),
        expect.anything(),
      );
      expect(withdrawService.updateStatus).not.toHaveBeenCalledWith(
        'wd-sumsub-1',
        expect.objectContaining({ action: WithdrawTransactionAction.REJECT_REFUND }),
        expect.anything(),
      );
      expect(accountingService.voidPendingTransferBestEffort).not.toHaveBeenCalled();
    });

    it('no tag from COMPLIANCE_PENDING → KYT_REJECTED action (routes to MANUAL_CHECKING)', async () => {
      const { workflow, withdrawService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.COMPLIANCE_PENDING }),
      );

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'rejected' });

      expect(withdrawService.updateStatus).toHaveBeenCalledWith(
        'wd-sumsub-1',
        expect.objectContaining({ action: WithdrawTransactionAction.KYT_REJECTED }),
        expect.anything(),
      );
    });

    it('idempotent: no tag, already MANUAL_CHECKING → no-op (repeat webhook)', async () => {
      const { workflow, withdrawService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.MANUAL_CHECKING }),
      );

      await workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'rejected' });

      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
    });

    it('no tag from FROZEN → no-op (no throw despite missing KYT_REJECTED edge from FROZEN)', async () => {
      const { workflow, withdrawService, auditLogsService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.FROZEN }),
      );

      await expect(
        workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'rejected' }),
      ).resolves.toBeUndefined();

      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      // 第一批 (2026-08-19)：判定先于写库（spec §2.1）—— FROZEN 一律判 IGNORE，
      // evidence 不再先写后判被覆盖，saveSumsubVerdict 压根不会被调用。
      expect(withdrawService.saveSumsubVerdict).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED }),
      );
    });
  });

  describe('awaitUser on FROZEN — no ACTION_PENDING edge, must not throw', () => {
    it('awaitUser verdict while FROZEN → no-op (evidence NOT written, status unchanged, no throw)', async () => {
      const { workflow, withdrawService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.FROZEN }),
      );

      await expect(
        workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'awaitUser', sceneTag: 'PEP' }),
      ).resolves.toBeUndefined();

      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      // 第一批 (2026-08-19)：判定先于写库（spec §2.1）—— FROZEN 一律判 IGNORE，
      // applyKytVerdict 在到达 applyKytAwaitUser 内部的 FROZEN 守卫之前就已 return，
      // saveSumsubVerdict 压根不会被调用（此前会先覆写证据再静默 no-op）。
      expect(withdrawService.saveSumsubVerdict).not.toHaveBeenCalled();
    });
  });

  // Task 2 (withdraw action-embed): applyKytAwaitUser 改集合同步 + 零未提交行 guard +
  // 同状态重入清缓存/REISSUED 审计 + 跨状态弧清缓存——mirrors
  // deposit-workflow.service.spec.ts 的『applyKytAwaitUser：多条 action 集合比对』。
  // 直调私有方法(绕开 applyKytVerdict 外层的 findOneInternal/saveSumsubVerdict 等
  // 无关逻辑),与 deposit 那组测试同一测法。
  describe('applyKytAwaitUser — 多条 action 集合比对 (mirrors deposit)', () => {
    const ACTIONS = [
      { applicantActionId: 'aa-1', externalActionId: 'EXT-1' },
      { applicantActionId: 'aa-2', externalActionId: 'EXT-2' },
    ];

    it('从 COMPLIANCE_PENDING 首次进态:同步集合 + 状态迁移', async () => {
      const { workflow, withdrawService, applicantActions } = buildFullWorkflow();
      const w = baseWithdrawRow({ status: WithdrawTransactionStatus.COMPLIANCE_PENDING });
      applicantActions.syncApplicantActions.mockResolvedValue({ added: [1, 2], retired: [] });
      applicantActions.hasOutstanding.mockResolvedValue(true);

      await (workflow as any).applyKytAwaitUser(w, undefined, ACTIONS);

      expect(applicantActions.syncApplicantActions).toHaveBeenCalledWith(w.id, ACTIONS);
      expect(withdrawService.updateStatus).toHaveBeenCalledTimes(1);
      const [, dto, ctx] = withdrawService.updateStatus.mock.calls[0];
      expect(dto.action).toBe(WithdrawTransactionAction.ACTION_PENDING);
      // 2026-08-21 第三批：extraData 不再带 slaDeadline/slaBreached —— 由
      // updateStatus 内部的 resolveSlaFields(收口处)统一算。
      expect((ctx as any).extraData).toEqual(
        expect.objectContaining({ actionSubmittedAt: null }),
      );
      expect((ctx as any).extraData).not.toHaveProperty('slaDeadline');
      expect((ctx as any).extraData).not.toHaveProperty('slaBreached');
    });

    it('重复 webhook,集合完全一致、缓存本就干净:真 no-op', async () => {
      const { workflow, withdrawService, applicantActions } = buildFullWorkflow();
      const w = baseWithdrawRow({ status: WithdrawTransactionStatus.ACTION_PENDING });
      applicantActions.syncApplicantActions.mockResolvedValue({ added: [], retired: [] });
      applicantActions.hasOutstanding.mockResolvedValue(true);

      await (workflow as any).applyKytAwaitUser(w, undefined, ACTIONS);

      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      expect(applicantActions.clearWithdrawCache).not.toHaveBeenCalled();
    });

    it('已在 ACTION_PENDING 且集合有变、缓存里还留着旧的"已交齐"值:不动状态,清缓存,记 REISSUED 审计', async () => {
      const { workflow, withdrawService, applicantActions, auditLogsService } = buildFullWorkflow();
      const w = baseWithdrawRow({
        status: WithdrawTransactionStatus.ACTION_PENDING,
        actionSubmittedAt: new Date('2026-08-01'),
      });
      applicantActions.syncApplicantActions.mockResolvedValue({ added: [2], retired: [] });
      applicantActions.hasOutstanding.mockResolvedValue(true);

      await (workflow as any).applyKytAwaitUser(w, undefined, ACTIONS);

      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      expect(applicantActions.clearWithdrawCache).toHaveBeenCalledWith(w.id, expect.any(Date));
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.WITHDRAW_ACTION_REISSUED,
          primarySubjectNo: w.withdrawNo,
          metadata: expect.objectContaining({ addedSeqs: [2], retiredSeqs: [] }),
        }),
      );
    });

    it('零未提交行(跨状态,COMPLIANCE_PENDING 收到空 applicantActions):状态不变,记 EMPTY_ACTIONS 审计,不进 ACTION_PENDING', async () => {
      const { workflow, withdrawService, applicantActions, auditLogsService } = buildFullWorkflow();
      const w = baseWithdrawRow({ status: WithdrawTransactionStatus.COMPLIANCE_PENDING });
      applicantActions.syncApplicantActions.mockResolvedValue({ added: [], retired: [] });
      applicantActions.hasOutstanding.mockResolvedValue(false);

      await (workflow as any).applyKytAwaitUser(w, undefined, undefined);

      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.WITHDRAW_AWAITUSER_EMPTY_ACTIONS,
          primarySubjectNo: w.withdrawNo,
        }),
      );
    });

    it('已在 ACTION_PENDING,报文把全部未提交行撤空:不清缓存不推进,只记 EMPTY_ACTIONS 审计', async () => {
      const { workflow, withdrawService, applicantActions, auditLogsService } = buildFullWorkflow();
      const w = baseWithdrawRow({ status: WithdrawTransactionStatus.ACTION_PENDING });
      applicantActions.syncApplicantActions.mockResolvedValue({ added: [], retired: [1, 2] });
      applicantActions.hasOutstanding.mockResolvedValue(false);

      await (workflow as any).applyKytAwaitUser(w, undefined, []);

      expect(applicantActions.clearWithdrawCache).not.toHaveBeenCalled();
      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.WITHDRAW_AWAITUSER_EMPTY_ACTIONS,
          primarySubjectNo: w.withdrawNo,
          metadata: expect.objectContaining({ addedSeqs: [], retiredSeqs: [1, 2] }),
        }),
      );
    });

    it('MANUAL_CHECKING → ACTION_PENDING 跨状态弧:清缓存(actionSubmittedAt 随原子写归零,slaDeadline/slaBreached 由收口处的 resolveSlaFields 统一算)', async () => {
      const { workflow, withdrawService, applicantActions } = buildFullWorkflow();
      const w = baseWithdrawRow({ status: WithdrawTransactionStatus.MANUAL_CHECKING });
      applicantActions.syncApplicantActions.mockResolvedValue({ added: [1], retired: [] });
      applicantActions.hasOutstanding.mockResolvedValue(true);

      await (workflow as any).applyKytAwaitUser(w, 'PEP', ACTIONS);

      expect(withdrawService.updateStatus).toHaveBeenCalledTimes(1);
      const [, dto, ctx] = withdrawService.updateStatus.mock.calls[0];
      expect(dto.action).toBe(WithdrawTransactionAction.ACTION_PENDING);
      expect((ctx as any).extraData).toEqual(
        expect.objectContaining({
          manualReason: 'EDD_PEP',
          actionSubmittedAt: null,
        }),
      );
      expect((ctx as any).extraData).not.toHaveProperty('slaDeadline');
      expect((ctx as any).extraData).not.toHaveProperty('slaBreached');
    });

    it('FROZEN:子表仍同步,但不推进状态(no ACTION_PENDING edge)', async () => {
      const { workflow, withdrawService, applicantActions } = buildFullWorkflow();
      const w = baseWithdrawRow({ status: WithdrawTransactionStatus.FROZEN });
      applicantActions.hasOutstanding.mockResolvedValue(true);

      await (workflow as any).applyKytAwaitUser(w, undefined, ACTIONS);

      expect(applicantActions.syncApplicantActions).toHaveBeenCalledWith(w.id, ACTIONS);
      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
    });
  });

  // Review Fix 2 (Important): PAYOUT_PENDING post-broadcast verdicts must not dead-letter.
  describe('applyKytVerdict — PAYOUT_PENDING post-broadcast verdicts (Fix 2)', () => {
    it('approved verdict on PAYOUT_PENDING → evidence written, audited, no branch dispatch (no throw retrying APPROVE)', async () => {
      const { workflow, withdrawService, auditLogsService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.PAYOUT_PENDING }),
      );
      const initiateSpy = jest
        .spyOn(workflow as any, 'initiatePayoutPhase')
        .mockResolvedValue(undefined);

      await expect(
        workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'approved', riskScore: 1 }),
      ).resolves.toBeUndefined();

      expect(withdrawService.saveSumsubVerdict).toHaveBeenCalled();
      expect(initiateSpy).not.toHaveBeenCalled();
      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      expect(withdrawService.markNeedsReview).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.WITHDRAW_POST_BROADCAST_VERDICT,
          metadata: { verdict: 'approved' },
        }),
      );
    });

    it('rejected verdict on PAYOUT_PENDING → evidence + audit + needsReview flagged, no status change', async () => {
      const { workflow, withdrawService, auditLogsService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.PAYOUT_PENDING }),
      );

      await expect(
        workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'rejected' }),
      ).resolves.toBeUndefined();

      expect(withdrawService.saveSumsubVerdict).toHaveBeenCalled();
      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      expect(withdrawService.markNeedsReview).toHaveBeenCalledWith('wd-sumsub-1');
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.WITHDRAW_POST_BROADCAST_VERDICT,
          metadata: { verdict: 'rejected' },
        }),
      );
    });

    it('awaitUser verdict on PAYOUT_PENDING → evidence + audit, no needsReview (only rejected sets it), no throw', async () => {
      const { workflow, withdrawService } = buildFullWorkflow();
      withdrawService.findOneInternal.mockResolvedValue(
        baseWithdrawRow({ status: WithdrawTransactionStatus.PAYOUT_PENDING }),
      );

      await expect(
        workflow.applyKytVerdict('wd-sumsub-1', { verdict: 'awaitUser' }),
      ).resolves.toBeUndefined();

      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      expect(withdrawService.markNeedsReview).not.toHaveBeenCalled();
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Task 6: 费腿顺序守卫 + 失败三级梯
//
//   Order guard   — onFeeLegConfirmed defers (no settle) until the principal
//                    leg (legSeq 1) is at least CONFIRMED.
//   回捞           — onPayoutLegConfirmed, after CLEARing the principal leg,
//                    picks up a fee leg that is sitting CONFIRMED (deferred by
//                    the guard above).
//   onFeeLegFailed — fee leg FAILED/TIMEOUT rebuilds a fresh attempt (≤3);
//                    exhausted → needsReview + WITHDRAW_FEE_SETTLE_STUCK,
//                    withdrawal stays PAYOUT_PENDING, never releaseLock.
//   Settle retry   — a throw inside onFeeLegConfirmed's settlement body
//                    increments feeSettleAttempts; 3rd failure → STUCK;
//                    success resets the counter to 0.
// ─────────────────────────────────────────────────────────────

function buildFeeWorkflow(overrides: {
  withdrawService?: Partial<Record<string, jest.Mock>>;
  fundsOrders?: Partial<Record<string, jest.Mock>>;
  accountingService?: Partial<Record<string, jest.Mock>>;
} = {}) {
  const withdrawService = {
    findOneInternal: jest.fn(),
    getOwnerComplianceStatus: jest.fn().mockResolvedValue('ACTIVE'),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    markNeedsReview: jest.fn().mockResolvedValue(undefined),
    incrementFeeSettleAttempts: jest.fn().mockResolvedValue(1),
    resetFeeSettleAttempts: jest.fn().mockResolvedValue(undefined),
    ...overrides.withdrawService,
  };
  const auditLogsService = { recordSystem: jest.fn().mockResolvedValue({}) };
  const accountingService = {
    postPendingTransfer: jest.fn().mockResolvedValue(undefined),
    executeTransfer: jest.fn().mockResolvedValue(undefined),
    resolveTbAccountId: jest.fn().mockResolvedValue('tb-acct-1'),
    voidPendingTransferBestEffort: jest.fn().mockResolvedValue(true),
    ...overrides.accountingService,
  };
  const fundsOrders = {
    findByParent: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
    advance: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockResolvedValue({ id: 'fo-new', fundsOrderNo: 'FO-NEW' }),
    resolveExternalRef: jest.fn().mockReturnValue(null),
    ...overrides.fundsOrders,
  };
  const tbEvidenceService = { enrichForPost: jest.fn().mockResolvedValue(undefined) };
  const systemWalletResolver = { resolve: jest.fn().mockResolvedValue({ id: 'wallet-f-fee' }) };

  const workflow = new WithdrawWorkflowService(
    {} as any, // prisma
    {} as any, // eventEmitter
    withdrawService as any,
    {} as any, // withdrawQuoteService
    auditLogsService as any,
    accountingService as any,
    fundsOrders as any,
    {} as any, // approvalsService
    {} as any, // binanceRateProvider
    systemWalletResolver as any,
    tbEvidenceService as any,
    {} as any, // limitGateService
    {} as any, // limitRulesService
    {} as any, // sumsubTxnClient
    {} as any, // applicantActions
    { assertCapability: jest.fn(), assertOffboardable: jest.fn(), resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }) } as any, // customerAccessService
    { open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST', created: true }) } as any, // customerRestrictionsService
    { evaluate: jest.fn().mockResolvedValue({ evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'WITHDRAW', verdict: 'PASS', holdReason: null, tradingTier: 'BASIC', checks: [] }) } as any, // l1Gate
  );

  return {
    workflow,
    withdrawService,
    auditLogsService,
    accountingService,
    fundsOrders,
    tbEvidenceService,
    systemWalletResolver,
  };
}

const feeWithdrawal = {
  id: 'wd-fee-1',
  withdrawNo: 'WD-FEE-1',
  status: WithdrawTransactionStatus.PAYOUT_PENDING,
  ownerType: 'CUSTOMER',
  ownerId: 'cust-fee-1',
  traceId: 'trace-fee-1',
  assetId: 'asset-usdt',
  netAmount: new Prisma.Decimal('95'),
  feeAmount: new Prisma.Decimal('5'),
  tbPendingNetId: null,
  tbPendingFeeId: 'AB',
  asset: { currency: 'USDT', decimals: 8, type: 'CRYPTO' },
};

describe('WithdrawWorkflowService — Task 6: fee-leg order guard', () => {
  it('fee leg CONFIRMED before principal → defers without settling (no post calls)', async () => {
    const { workflow, withdrawService, fundsOrders, accountingService } = buildFeeWorkflow();
    fundsOrders.findByParent.mockImplementation(async (_parent: any, filter: any) => {
      if (filter?.legSeq === 1) return [{ id: 'fo-principal-1', status: FundsOrderStatus.SUBMITTED }];
      return [];
    });

    await (workflow as any).onFeeLegConfirmed(feeWithdrawal.id, 'fo-fee-1');

    // Deferred before even loading the withdrawal row — no settle attempted.
    expect(withdrawService.findOneInternal).not.toHaveBeenCalled();
    expect(accountingService.postPendingTransfer).not.toHaveBeenCalled();
    expect(accountingService.executeTransfer).not.toHaveBeenCalled();
    expect(fundsOrders.advance).not.toHaveBeenCalled();
  });

  it('回捞: principal leg CLEAR picks up a fee leg already sitting CONFIRMED', async () => {
    const { workflow, withdrawService, fundsOrders, accountingService } = buildFeeWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(feeWithdrawal);
    fundsOrders.findByParent.mockImplementation(async (_parent: any, filter: any) => {
      if (filter?.legSeq === 1) return [{ id: 'fo-principal-1', status: FundsOrderStatus.CONFIRMED }];
      if (filter?.legSeq === 2) return [{ id: 'fo-fee-1', fundsOrderNo: 'FO-FEE-1', status: FundsOrderStatus.CONFIRMED }];
      return [];
    });
    fundsOrders.findById.mockResolvedValue({
      id: 'fo-fee-1',
      status: FundsOrderStatus.CONFIRMED,
      asset: feeWithdrawal.asset,
      txHash: null,
      referenceNo: null,
    });

    await (workflow as any).onPayoutLegConfirmed(feeWithdrawal.id, 'fo-principal-1');

    // Principal leg CLEARed.
    expect(fundsOrders.advance).toHaveBeenCalledWith('fo-principal-1', 'CLEAR', 'SYSTEM');
    // 回捞 settled the deferred fee leg: POST + firm-fee collect + CLEAR.
    expect(accountingService.postPendingTransfer).toHaveBeenCalled();
    expect(accountingService.executeTransfer).toHaveBeenCalled();
    expect(fundsOrders.advance).toHaveBeenCalledWith('fo-fee-1', 'CLEAR', 'SYSTEM');
    expect(withdrawService.resetFeeSettleAttempts).toHaveBeenCalledWith(feeWithdrawal.id);
  });

  it('回捞 is a no-op (self-heals) when the fee leg is already CLEARED (idempotent replay)', async () => {
    const { workflow, withdrawService, fundsOrders, accountingService } = buildFeeWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(feeWithdrawal);
    fundsOrders.findByParent.mockImplementation(async (_parent: any, filter: any) => {
      if (filter?.legSeq === 2) return [{ id: 'fo-fee-1', status: FundsOrderStatus.CLEARED }];
      return [];
    });

    await (workflow as any).onPayoutLegConfirmed(feeWithdrawal.id, 'fo-principal-1');

    expect(accountingService.postPendingTransfer).not.toHaveBeenCalled();
    expect(accountingService.executeTransfer).not.toHaveBeenCalled();
  });
});

describe('WithdrawWorkflowService — Task 6: onFeeLegFailed (leg rebuild + STUCK)', () => {
  it('fee leg FAILED (attempt 1, principal still in flight) → rebuilds attempt 2, audits WITHDRAW_FEE_LEG_REBUILT', async () => {
    const { workflow, withdrawService, auditLogsService, fundsOrders } = buildFeeWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(feeWithdrawal);
    fundsOrders.findById.mockResolvedValue({
      id: 'fo-fee-1',
      attempt: 1,
      fromWalletId: 'w-from',
      fromAddress: null,
      fromIban: null,
      toWalletId: 'w-to',
      toAddress: null,
      toIban: null,
    });
    fundsOrders.create.mockResolvedValue({ id: 'fo-fee-2', fundsOrderNo: 'FO-FEE-2' });

    await (workflow as any).onFeeLegFailed(feeWithdrawal.id, 'fo-fee-1', FundsOrderStatus.FAILED);

    expect(fundsOrders.create).toHaveBeenCalledWith(
      expect.objectContaining({ withdrawTransactionId: feeWithdrawal.id, legSeq: 2, attempt: 2 }),
    );
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.WITHDRAW_FEE_LEG_REBUILT }),
    );
    expect(withdrawService.markNeedsReview).not.toHaveBeenCalled();
    expect(withdrawService.updateStatus).not.toHaveBeenCalled();
  });

  it('fee leg FAILED at attempt 3 (exhausted) → needsReview + WITHDRAW_FEE_SETTLE_STUCK, stays PAYOUT_PENDING, no releaseLock', async () => {
    const { workflow, withdrawService, auditLogsService, fundsOrders, accountingService } = buildFeeWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(feeWithdrawal);
    fundsOrders.findById.mockResolvedValue({ id: 'fo-fee-3', attempt: 3 });

    await (workflow as any).onFeeLegFailed(feeWithdrawal.id, 'fo-fee-3', FundsOrderStatus.FAILED);

    expect(fundsOrders.create).not.toHaveBeenCalled();
    expect(withdrawService.markNeedsReview).toHaveBeenCalledWith(feeWithdrawal.id);
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.WITHDRAW_FEE_SETTLE_STUCK }),
    );
    // Never touches withdraw status or the P6 lock-release path.
    expect(withdrawService.updateStatus).not.toHaveBeenCalled();
    expect(accountingService.voidPendingTransferBestEffort).not.toHaveBeenCalled();
  });

  it('no-op (warn) when withdrawal is not PAYOUT_PENDING', async () => {
    const { workflow, withdrawService, fundsOrders } = buildFeeWorkflow();
    withdrawService.findOneInternal.mockResolvedValue({ ...feeWithdrawal, status: WithdrawTransactionStatus.SUCCESS });

    await (workflow as any).onFeeLegFailed(feeWithdrawal.id, 'fo-fee-1', FundsOrderStatus.FAILED);

    expect(fundsOrders.create).not.toHaveBeenCalled();
    expect(withdrawService.markNeedsReview).not.toHaveBeenCalled();
  });

  it('wired via handleFundsOrderChanged: FAILED on legSeq 2 dispatches to onFeeLegFailed (closes the zero-handler gap)', async () => {
    const { workflow, fundsOrders, auditLogsService } = buildFeeWorkflow();
    const spy = jest.spyOn(workflow as any, 'onFeeLegFailed').mockResolvedValue(undefined);

    await workflow.handleFundsOrderChanged({
      fundsOrderId: 'fo-fee-1',
      fundsOrderNo: 'FO-FEE-1',
      parent: { withdrawTransactionId: feeWithdrawal.id },
      legSeq: 2,
      attempt: 1,
      oldStatus: FundsOrderStatus.SUBMITTED,
      newStatus: FundsOrderStatus.FAILED,
    });

    expect(spy).toHaveBeenCalledWith(feeWithdrawal.id, 'fo-fee-1', FundsOrderStatus.FAILED);
  });
});

describe('WithdrawWorkflowService — Task 6: settle-failure retry (three-rung ladder rung 1)', () => {
  function primeSettleThrow(fundsOrders: any, accountingService: any) {
    fundsOrders.findByParent.mockImplementation(async (_parent: any, filter: any) => {
      if (filter?.legSeq === 1) return [{ id: 'fo-principal-1', status: FundsOrderStatus.CLEARED }];
      return [];
    });
    fundsOrders.findById.mockResolvedValue({ id: 'fo-fee-1', asset: feeWithdrawal.asset, txHash: null, referenceNo: null });
    accountingService.postPendingTransfer.mockRejectedValue(new Error('TB down'));
  }

  it('attempts 1 and 2 log + return without flagging; attempt 3 flags needsReview + STUCK', async () => {
    const { workflow, withdrawService, auditLogsService, fundsOrders, accountingService } = buildFeeWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(feeWithdrawal);
    primeSettleThrow(fundsOrders, accountingService);
    fundsOrders.findById.mockResolvedValue({
      id: 'fo-fee-1',
      status: FundsOrderStatus.CONFIRMED,
      asset: feeWithdrawal.asset,
      txHash: null,
      referenceNo: null,
    });
    withdrawService.incrementFeeSettleAttempts
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);

    await (workflow as any).onFeeLegConfirmed(feeWithdrawal.id, 'fo-fee-1');
    expect(withdrawService.markNeedsReview).not.toHaveBeenCalled();

    await (workflow as any).onFeeLegConfirmed(feeWithdrawal.id, 'fo-fee-1');
    expect(withdrawService.markNeedsReview).not.toHaveBeenCalled();

    await (workflow as any).onFeeLegConfirmed(feeWithdrawal.id, 'fo-fee-1');
    expect(withdrawService.markNeedsReview).toHaveBeenCalledWith(feeWithdrawal.id);
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.WITHDRAW_FEE_SETTLE_STUCK }),
    );
    // Never CLEARed the fee leg across any of the 3 failed attempts.
    expect(fundsOrders.advance).not.toHaveBeenCalled();
  });

  it('successful settle resets feeSettleAttempts to 0', async () => {
    const { workflow, withdrawService, fundsOrders } = buildFeeWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(feeWithdrawal);
    fundsOrders.findByParent.mockImplementation(async (_parent: any, filter: any) => {
      if (filter?.legSeq === 1) return [{ id: 'fo-principal-1', status: FundsOrderStatus.CLEARED }];
      return [];
    });
    fundsOrders.findById.mockResolvedValue({
      id: 'fo-fee-1',
      status: FundsOrderStatus.CONFIRMED,
      asset: feeWithdrawal.asset,
      txHash: null,
      referenceNo: null,
    });

    await (workflow as any).onFeeLegConfirmed(feeWithdrawal.id, 'fo-fee-1');

    expect(fundsOrders.advance).toHaveBeenCalledWith('fo-fee-1', 'CLEAR', 'SYSTEM');
    expect(withdrawService.resetFeeSettleAttempts).toHaveBeenCalledWith(feeWithdrawal.id);
  });

  it('concurrent re-entry: fee leg already CLEARED when onFeeLegConfirmed runs → idempotent skip, no settlement or counter increments', async () => {
    const { workflow, withdrawService, fundsOrders, accountingService } = buildFeeWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(feeWithdrawal);
    fundsOrders.findByParent.mockImplementation(async (_parent: any, filter: any) => {
      if (filter?.legSeq === 1) return [{ id: 'fo-principal-1', status: FundsOrderStatus.CLEARED }];
      return [];
    });
    // Concurrent racer: fee leg is already CLEARED
    fundsOrders.findById.mockResolvedValue({ id: 'fo-fee-1', status: FundsOrderStatus.CLEARED });

    await (workflow as any).onFeeLegConfirmed(feeWithdrawal.id, 'fo-fee-1');

    // Guard prevents settlement: no POST calls, no firm-fee collect, no advance.
    expect(accountingService.postPendingTransfer).not.toHaveBeenCalled();
    expect(accountingService.executeTransfer).not.toHaveBeenCalled();
    expect(fundsOrders.advance).not.toHaveBeenCalled();
    // Guard prevents false counter increments.
    expect(withdrawService.incrementFeeSettleAttempts).not.toHaveBeenCalled();
    expect(withdrawService.markNeedsReview).not.toHaveBeenCalled();
  });

  it('concurrent re-entry: fee leg already FAILED when onFeeLegConfirmed runs → idempotent skip', async () => {
    const { workflow, withdrawService, fundsOrders, accountingService } = buildFeeWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(feeWithdrawal);
    fundsOrders.findByParent.mockImplementation(async (_parent: any, filter: any) => {
      if (filter?.legSeq === 1) return [{ id: 'fo-principal-1', status: FundsOrderStatus.CLEARED }];
      return [];
    });
    // Concurrent racer: fee leg is already FAILED
    fundsOrders.findById.mockResolvedValue({ id: 'fo-fee-1', status: FundsOrderStatus.FAILED });

    await (workflow as any).onFeeLegConfirmed(feeWithdrawal.id, 'fo-fee-1');

    expect(accountingService.postPendingTransfer).not.toHaveBeenCalled();
    expect(withdrawService.incrementFeeSettleAttempts).not.toHaveBeenCalled();
  });

  it('concurrent re-entry: fee leg missing (null) when onFeeLegConfirmed runs → idempotent skip', async () => {
    const { workflow, withdrawService, fundsOrders, accountingService } = buildFeeWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(feeWithdrawal);
    fundsOrders.findByParent.mockImplementation(async (_parent: any, filter: any) => {
      if (filter?.legSeq === 1) return [{ id: 'fo-principal-1', status: FundsOrderStatus.CLEARED }];
      return [];
    });
    // Concurrent racer: fee leg vanished
    fundsOrders.findById.mockResolvedValue(null);

    await (workflow as any).onFeeLegConfirmed(feeWithdrawal.id, 'fo-fee-1');

    expect(accountingService.postPendingTransfer).not.toHaveBeenCalled();
    expect(withdrawService.incrementFeeSettleAttempts).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// Task 7: onBounce (RETURNED bounce entry) + archivePostKyt (L3 real call)
//
//   onBounce — admin-initiated: the payout already POSTed (money actually
//   left) but the bank/network bounced it back afterwards. Reverses the net
//   leg (DR CLIENT_ASSET / CR CLIENT_PAYABLE) THEN flips PAYOUT_PENDING →
//   RETURNED (先账后状态). Fee is NOT refunded. Idempotent: a second call
//   after RETURNED fails cleanly on the status guard.
//
//   archivePostKyt — L3 real Sumsub call, replacing the log-only stub:
//   guards on sumsubTxnId + txHash both present, then calls
//   sumsubTxnClient.archiveTxHash(sumsubTxnId, txHash).
// ─────────────────────────────────────────────────────────────

function buildBounceWorkflow(overrides: {
  withdrawService?: Partial<Record<string, jest.Mock>>;
  accountingService?: Partial<Record<string, jest.Mock>>;
  fundsOrders?: Partial<Record<string, jest.Mock>>;
  prisma?: any;
  sumsubTxnClient?: Partial<Record<string, jest.Mock>>;
} = {}) {
  const withdrawService = {
    findOneInternal: jest.fn(),
    getOwnerComplianceStatus: jest.fn().mockResolvedValue('ACTIVE'),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    ...overrides.withdrawService,
  };
  const auditLogsService = {
    recordSystem: jest.fn().mockResolvedValue({}),
    recordByActor: jest.fn().mockResolvedValue({}),
  };
  const accountingService = {
    executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 9n }),
    resolveTbAccountId: jest.fn().mockResolvedValue(1n),
    voidPendingTransferBestEffort: jest.fn().mockResolvedValue(true),
    ...overrides.accountingService,
  };
  const fundsOrders = {
    findByParent: jest.fn().mockResolvedValue([]),
    resolveExternalRef: jest.fn().mockReturnValue(null),
    advance: jest.fn().mockResolvedValue(undefined),
    ...overrides.fundsOrders,
  };
  const prisma = overrides.prisma ?? {
    tbTransferEvidence: {
      findMany: jest.fn().mockResolvedValue([{ eventCode: 'WITHDRAW_NET_POST' }]),
    },
  };
  const sumsubTxnClient = {
    archiveTxHash: jest.fn().mockResolvedValue(undefined),
    ...overrides.sumsubTxnClient,
  };

  const workflow = new WithdrawWorkflowService(
    prisma as any,
    {} as any, // eventEmitter
    withdrawService as any,
    {} as any, // withdrawQuoteService
    auditLogsService as any,
    accountingService as any,
    fundsOrders as any,
    {} as any, // approvalsService
    {} as any, // binanceRateProvider
    {} as any, // systemWalletResolver
    {} as any, // tbEvidenceService
    {} as any, // limitGateService
    {} as any, // limitRulesService
    sumsubTxnClient as any,
    {} as any, // applicantActions
    { assertCapability: jest.fn(), assertOffboardable: jest.fn(), resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }) } as any, // customerAccessService
    { open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST', created: true }) } as any, // customerRestrictionsService
    { evaluate: jest.fn().mockResolvedValue({ evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'WITHDRAW', verdict: 'PASS', holdReason: null, tradingTier: 'BASIC', checks: [] }) } as any, // l1Gate
  );

  return { workflow, withdrawService, auditLogsService, accountingService, fundsOrders, prisma, sumsubTxnClient };
}

const bounceWithdrawal = {
  id: 'wd-bounce-1',
  withdrawNo: 'WD-BOUNCE-1',
  status: WithdrawTransactionStatus.PAYOUT_PENDING,
  ownerType: 'CUSTOMER',
  ownerId: 'cust-bounce-1',
  traceId: 'trace-bounce-1',
  assetId: 'asset-usdt',
  netAmount: new Prisma.Decimal('95'),
  feeAmount: new Prisma.Decimal('5'),
  fromWalletId: 'wallet-from-1',
  asset: { currency: 'USDT', decimals: 8, type: 'CRYPTO' },
};

describe('WithdrawWorkflowService.onBounce (Task 7: RETURNED bounce entry)', () => {
  it('rejects when withdrawal is not PAYOUT_PENDING', async () => {
    const { workflow, withdrawService, accountingService } = buildBounceWorkflow();
    withdrawService.findOneInternal.mockResolvedValue({
      ...bounceWithdrawal,
      status: WithdrawTransactionStatus.SUCCESS,
    });

    await expect(workflow.onBounce(bounceWithdrawal.id, 'bank returned funds')).rejects.toThrow();

    expect(accountingService.executeTransfer).not.toHaveBeenCalled();
    expect(withdrawService.updateStatus).not.toHaveBeenCalled();
  });

  it('rejects with BOUNCE_REQUIRES_POSTED_PAYOUT when the net leg has not posted yet', async () => {
    const { workflow, withdrawService, accountingService, prisma } = buildBounceWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(bounceWithdrawal);
    prisma.tbTransferEvidence.findMany.mockResolvedValue([]); // no WITHDRAW_NET_POST evidence yet

    await expect(workflow.onBounce(bounceWithdrawal.id, 'bank returned funds')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BOUNCE_REQUIRES_POSTED_PAYOUT' }),
    });

    expect(accountingService.executeTransfer).not.toHaveBeenCalled();
    expect(withdrawService.updateStatus).not.toHaveBeenCalled();
  });

  it('happy path: reverses the net leg (DR CLIENT_ASSET / CR CLIENT_PAYABLE) THEN flips to RETURNED, audits reason + fee retained', async () => {
    const { workflow, withdrawService, accountingService, auditLogsService, fundsOrders } =
      buildBounceWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(bounceWithdrawal);
    fundsOrders.findByParent.mockResolvedValue([
      { id: 'fo-principal-1', txHash: '0xabc', asset: bounceWithdrawal.asset },
    ]);
    fundsOrders.resolveExternalRef.mockReturnValue('0xabc');
    accountingService.resolveTbAccountId.mockImplementation(async (params: any) =>
      params.code === TB_ACCOUNT_CODES.CLIENT_ASSET ? 111n : 222n,
    );

    const callOrder: string[] = [];
    accountingService.executeTransfer.mockImplementation(async () => {
      callOrder.push('executeTransfer');
      return { tbTransferId: 9n };
    });
    withdrawService.updateStatus.mockImplementation(async () => {
      callOrder.push('updateStatus');
    });

    const reason = 'bank returned funds — invalid IBAN';
    await workflow.onBounce(bounceWithdrawal.id, reason);

    expect(accountingService.executeTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        debitAccountId: 111n,
        creditAccountId: 222n,
        code: TB_TRANSFER_CODES.WITHDRAW_BOUNCE_REENTRY,
        evidence: expect.objectContaining({
          sourceType: 'WITHDRAWAL',
          sourceNo: bounceWithdrawal.withdrawNo,
          eventCode: 'WITHDRAW_BOUNCE_REENTRY',
          debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
          creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
          debitWalletRef: bounceWithdrawal.fromWalletId,
          creditWalletRef: bounceWithdrawal.fromWalletId,
          externalRef: '0xabc',
          isExternalCrossing: true,
          memo: expect.stringContaining(reason),
        }),
      }),
    );

    expect(withdrawService.updateStatus).toHaveBeenCalledWith(
      bounceWithdrawal.id,
      expect.objectContaining({ action: WithdrawTransactionAction.RETURN, reason }),
      expect.objectContaining({ source: 'WORKFLOW' }),
    );

    // 先账后状态: the reverse TB entry must land before the terminal status flip.
    expect(callOrder).toEqual(['executeTransfer', 'updateStatus']);

    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.WITHDRAW_BOUNCED,
        primarySubjectNo: bounceWithdrawal.withdrawNo,
        metadata: { reason },
        reason: expect.stringContaining('fee retained'),
      }),
      expect.anything(),
    );
  });

  it('double bounce: second call is rejected because the first already flipped status to RETURNED', async () => {
    const { workflow, withdrawService, accountingService } = buildBounceWorkflow();
    withdrawService.findOneInternal
      .mockResolvedValueOnce(bounceWithdrawal)
      .mockResolvedValueOnce({ ...bounceWithdrawal, status: WithdrawTransactionStatus.RETURNED });

    await workflow.onBounce(bounceWithdrawal.id, 'first bounce');
    await expect(workflow.onBounce(bounceWithdrawal.id, 'second bounce')).rejects.toThrow();

    expect(accountingService.executeTransfer).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────
// Fix Round 1 (reviewer catch): principal-POSTed does NOT imply fee-POSTed.
// Task 6's ordering guard settles the fee AFTER the principal, so "principal
// POSTed, fee still pending" is a ROUTINE window. Bouncing straight through
// used to permanently orphan the fee's TB pending lock (timeout:0, never
// expires) and falsely claim "fee retained" when the fee was never collected.
// ─────────────────────────────────────────────────────────────

const bounceWithdrawalWithFee = {
  ...bounceWithdrawal,
  tbPendingFeeId: 'ab',
  feeAmount: new Prisma.Decimal('5'),
};

function primeBounceEvidence(prisma: any, { feePosted }: { feePosted: boolean }) {
  prisma.tbTransferEvidence.findMany.mockImplementation(async ({ where }: any) => {
    if (where?.eventCode === 'WITHDRAW_NET_POST') return [{ eventCode: 'WITHDRAW_NET_POST' }];
    if (where?.eventCode === 'WITHDRAW_FEE_POST') return feePosted ? [{ eventCode: 'WITHDRAW_FEE_POST' }] : [];
    return [];
  });
}

describe('WithdrawWorkflowService.onBounce — Fix Round 1: fee disposition', () => {
  it('fee already POSTed: no void, no FAIL advance, audit says fee retained (collected)', async () => {
    const { workflow, withdrawService, accountingService, auditLogsService, fundsOrders, prisma } =
      buildBounceWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(bounceWithdrawalWithFee);
    primeBounceEvidence(prisma, { feePosted: true });
    fundsOrders.findByParent.mockImplementation(async (_parent: any, filter: any) => {
      if (filter?.legSeq === 1) return [{ id: 'fo-principal-1', txHash: '0xabc', asset: bounceWithdrawalWithFee.asset }];
      if (filter?.legSeq === 2) return [{ id: 'fo-fee-1' }];
      return [];
    });

    await workflow.onBounce(bounceWithdrawalWithFee.id, 'bank returned funds');

    expect(accountingService.voidPendingTransferBestEffort).not.toHaveBeenCalled();
    expect(fundsOrders.advance).not.toHaveBeenCalled();
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({ reason: expect.stringContaining('fee retained (collected)') }),
      expect.anything(),
    );
  });

  it('fee still PENDING (not posted): voids the fee lock + FAILs the fee funds order, audit says voided/returned', async () => {
    const { workflow, withdrawService, accountingService, auditLogsService, fundsOrders, prisma } =
      buildBounceWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(bounceWithdrawalWithFee);
    primeBounceEvidence(prisma, { feePosted: false });
    fundsOrders.findByParent.mockImplementation(async (_parent: any, filter: any) => {
      if (filter?.legSeq === 1) return [{ id: 'fo-principal-1', txHash: '0xabc', asset: bounceWithdrawalWithFee.asset }];
      if (filter?.legSeq === 2) return [{ id: 'fo-fee-1' }];
      return [];
    });
    fundsOrders.resolveExternalRef.mockReturnValue('0xabc');

    await workflow.onBounce(bounceWithdrawalWithFee.id, 'bank returned funds');

    expect(accountingService.voidPendingTransferBestEffort).toHaveBeenCalledWith(
      hexToBigint('ab'),
      expect.any(BigInt),
    );
    expect(fundsOrders.advance).toHaveBeenCalledWith('fo-fee-1', FundsOrderAction.FAIL, 'SYSTEM');
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining('uncollected fee lock voided — fee returned to customer'),
      }),
      expect.anything(),
    );
    // The status flip must still land — bounce is not blocked by fee cleanup.
    expect(withdrawService.updateStatus).toHaveBeenCalledWith(
      bounceWithdrawalWithFee.id,
      expect.objectContaining({ action: WithdrawTransactionAction.RETURN }),
      expect.anything(),
    );
  });

  it('fee void failure: logs CRITICAL but the bounce still completes (best-effort, money path not blocked)', async () => {
    const { workflow, withdrawService, accountingService, fundsOrders, prisma } = buildBounceWorkflow({
      accountingService: { voidPendingTransferBestEffort: jest.fn().mockResolvedValue(false) },
    });
    withdrawService.findOneInternal.mockResolvedValue(bounceWithdrawalWithFee);
    primeBounceEvidence(prisma, { feePosted: false });
    fundsOrders.findByParent.mockImplementation(async (_parent: any, filter: any) => {
      if (filter?.legSeq === 1) return [{ id: 'fo-principal-1', txHash: '0xabc', asset: bounceWithdrawalWithFee.asset }];
      if (filter?.legSeq === 2) return [{ id: 'fo-fee-1' }];
      return [];
    });

    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined as any);

    await workflow.onBounce(bounceWithdrawalWithFee.id, 'bank returned funds');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('CRITICAL'));
    expect(withdrawService.updateStatus).toHaveBeenCalledWith(
      bounceWithdrawalWithFee.id,
      expect.objectContaining({ action: WithdrawTransactionAction.RETURN }),
      expect.anything(),
    );

    errorSpy.mockRestore();
  });

  it('fee leg FAIL advance throws (e.g. already terminal / invalid transition): swallowed with a warn, bounce still completes', async () => {
    const { workflow, withdrawService, fundsOrders, prisma } = buildBounceWorkflow({
      fundsOrders: { advance: jest.fn().mockRejectedValue(new Error('Invalid transition: CONFIRMED --FAIL-->')) },
    });
    withdrawService.findOneInternal.mockResolvedValue(bounceWithdrawalWithFee);
    primeBounceEvidence(prisma, { feePosted: false });
    fundsOrders.findByParent.mockImplementation(async (_parent: any, filter: any) => {
      if (filter?.legSeq === 1) return [{ id: 'fo-principal-1', txHash: '0xabc', asset: bounceWithdrawalWithFee.asset }];
      if (filter?.legSeq === 2) return [{ id: 'fo-fee-1' }];
      return [];
    });

    await expect(workflow.onBounce(bounceWithdrawalWithFee.id, 'bank returned funds')).resolves.toBeUndefined();

    expect(withdrawService.updateStatus).toHaveBeenCalledWith(
      bounceWithdrawalWithFee.id,
      expect.objectContaining({ action: WithdrawTransactionAction.RETURN }),
      expect.anything(),
    );
  });

  it('zero-fee withdrawal (no tbPendingFeeId): fee-disposition block is a no-op', async () => {
    const { workflow, withdrawService, accountingService, fundsOrders, prisma } = buildBounceWorkflow();
    withdrawService.findOneInternal.mockResolvedValue(bounceWithdrawal); // no tbPendingFeeId
    primeBounceEvidence(prisma, { feePosted: false });
    fundsOrders.findByParent.mockResolvedValue([{ id: 'fo-principal-1', txHash: '0xabc', asset: bounceWithdrawal.asset }]);

    await workflow.onBounce(bounceWithdrawal.id, 'bank returned funds');

    expect(accountingService.voidPendingTransferBestEffort).not.toHaveBeenCalled();
    expect(fundsOrders.advance).not.toHaveBeenCalled();
  });
});

describe('WithdrawWorkflowService.archivePostKyt (Task 7: L3 real Sumsub archive call)', () => {
  it('calls sumsubTxnClient.archiveTxHash(sumsubTxnId, txHash) when both are present', async () => {
    const { workflow, sumsubTxnClient } = buildBounceWorkflow();

    await (workflow as any).archivePostKyt({
      id: 'wd-1',
      withdrawNo: 'WD-1',
      txHash: '0xabc',
      sumsubTxnId: 'SUMSUB-TXN-1',
    });

    expect(sumsubTxnClient.archiveTxHash).toHaveBeenCalledWith('SUMSUB-TXN-1', '0xabc');
  });

  it('skips (no call) when sumsubTxnId is missing', async () => {
    const { workflow, sumsubTxnClient } = buildBounceWorkflow();

    await (workflow as any).archivePostKyt({
      id: 'wd-1',
      withdrawNo: 'WD-1',
      txHash: '0xabc',
      sumsubTxnId: null,
    });

    expect(sumsubTxnClient.archiveTxHash).not.toHaveBeenCalled();
  });

  it('skips (no call) when txHash is missing', async () => {
    const { workflow, sumsubTxnClient } = buildBounceWorkflow();

    await (workflow as any).archivePostKyt({
      id: 'wd-1',
      withdrawNo: 'WD-1',
      txHash: null,
      sumsubTxnId: 'SUMSUB-TXN-1',
    });

    expect(sumsubTxnClient.archiveTxHash).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// Task 8: FROZEN maker-checker gates (initiate side only) —
// initiateUnfreeze / initiateRefund. Mirrors DepositWorkflowService's
// initiateSeize/initiateUnfreeze test shape: non-FROZEN → BadRequest,
// duplicate PENDING → Conflict, happy path → createAndSubmit called with
// the right actionType + objectSnapshot, no write to the withdraw row.
// ─────────────────────────────────────────────────────────────

describe('WithdrawWorkflowService.initiateUnfreeze / initiateRefund (Task 8)', () => {
  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'admin-1',
    userNo: 'A0001',
    role: 'MLRO',
    roleCodes: ['MLRO'],
  };

  const frozenWithdrawal = {
    id: 'wd-frozen-1',
    withdrawNo: 'WD-FROZEN-1',
    status: WithdrawTransactionStatus.FROZEN,
    ownerType: 'CUSTOMER',
    ownerId: 'cust-frozen-1',
    traceId: 'trace-frozen-1',
  };

  function buildFrozenWorkflow(overrides: {
    withdrawService?: Partial<Record<string, jest.Mock>>;
    approvalsService?: Partial<Record<string, jest.Mock>>;
  } = {}) {
    const withdrawService = {
      findOneInternal: jest.fn().mockResolvedValue(frozenWithdrawal),
      getOwnerComplianceStatus: jest.fn().mockResolvedValue('ACTIVE'),
      updateStatus: jest.fn(),
      ...overrides.withdrawService,
    };
    const auditLogsService = { recordByActor: jest.fn().mockResolvedValue({}) };
    const approvalsService = {
      list: jest.fn().mockResolvedValue({ total: 0 }),
      createAndSubmit: jest.fn().mockResolvedValue({ id: 'ap-1', approvalNo: 'AP-FROZEN-1' }),
      ...overrides.approvalsService,
    };

    const workflow = new WithdrawWorkflowService(
      {} as any, // prisma
      {} as any, // eventEmitter
      withdrawService as any,
      {} as any, // withdrawQuoteService
      auditLogsService as any,
      {} as any, // accountingService
      {} as any, // fundsOrders
      approvalsService as any,
      {} as any, // binanceRateProvider
      {} as any, // systemWalletResolver
      {} as any, // tbEvidenceService
      {} as any, // limitGateService
      {} as any, // limitRulesService
      {} as any, // sumsubTxnClient
      {} as any, // applicantActions
      { assertCapability: jest.fn(), assertOffboardable: jest.fn(), resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }) } as any, // customerAccessService
      { open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST', created: true }) } as any, // customerRestrictionsService
      { evaluate: jest.fn().mockResolvedValue({ evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'WITHDRAW', verdict: 'PASS', holdReason: null, tradingTier: 'BASIC', checks: [] }) } as any, // l1Gate
    );

    return { workflow, withdrawService, auditLogsService, approvalsService };
  }

  describe('initiateUnfreeze', () => {
    it('non-FROZEN withdrawal → BadRequestException, no approval case opened', async () => {
      const { workflow, approvalsService } = buildFrozenWorkflow({
        withdrawService: {
          findOneInternal: jest.fn().mockResolvedValue({
            ...frozenWithdrawal,
            status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
          }),
        },
      });

      await expect(
        workflow.initiateUnfreeze('wd-frozen-1', { orderRef: 'ORDER-1', reason: 'delisted' }, actor),
      ).rejects.toThrow('not FROZEN');
      expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    });

    it('empty orderRef → BadRequestException, no approval case opened', async () => {
      const { workflow, approvalsService } = buildFrozenWorkflow();

      await expect(
        workflow.initiateUnfreeze('wd-frozen-1', { orderRef: '  ', reason: 'delisted' }, actor),
      ).rejects.toThrow('order reference is required');
      expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    });

    it('empty reason → BadRequestException, no approval case opened', async () => {
      const { workflow, approvalsService } = buildFrozenWorkflow();

      await expect(
        workflow.initiateUnfreeze('wd-frozen-1', { orderRef: 'ORDER-1', reason: '' }, actor),
      ).rejects.toThrow('reason is required');
      expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    });

    it('duplicate open PENDING unfreeze approval → ConflictException', async () => {
      const { workflow, approvalsService } = buildFrozenWorkflow({
        approvalsService: { list: jest.fn().mockResolvedValue({ total: 1 }) },
      });

      await expect(
        workflow.initiateUnfreeze('wd-frozen-1', { orderRef: 'ORDER-1', reason: 'delisted' }, actor),
      ).rejects.toThrow('already has a pending unfreeze approval');
      expect(approvalsService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: ApprovalActionTypes.WITHDRAW_UNFREEZE,
          entityRef: 'wd-frozen-1',
          status: ApprovalStatuses.PENDING,
        }),
      );
      expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    });

    it('happy path: opens a WITHDRAW_UNFREEZE approval case with orderRef/withdrawNo in the snapshot, no write to the withdraw row', async () => {
      const { workflow, withdrawService, approvalsService, auditLogsService } = buildFrozenWorkflow();

      const result = await workflow.initiateUnfreeze(
        'wd-frozen-1',
        { orderRef: 'ORDER-REF-42', reason: 'Sanction list correction' },
        actor,
      );

      expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: ApprovalActionTypes.WITHDRAW_UNFREEZE,
          entityRef: 'wd-frozen-1',
          objectSnapshot: expect.objectContaining({
            withdrawNo: 'WD-FROZEN-1',
            ownerType: 'CUSTOMER',
            ownerId: 'cust-frozen-1',
            orderRef: 'ORDER-REF-42',
          }),
        }),
        expect.objectContaining({ reason: 'Sanction list correction' }),
        actor,
      );
      // Rule 5: initiate reads only, never writes the withdraw table.
      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordByActor).toHaveBeenCalledTimes(1);
      expect(result).toEqual(
        expect.objectContaining({ withdrawNo: 'WD-FROZEN-1', approvalNo: 'AP-FROZEN-1', status: 'PENDING_APPROVAL' }),
      );
    });
  });

  describe('initiateRefund', () => {
    it('non-FROZEN withdrawal → BadRequestException, no approval case opened', async () => {
      const { workflow, approvalsService } = buildFrozenWorkflow({
        withdrawService: {
          findOneInternal: jest.fn().mockResolvedValue({
            ...frozenWithdrawal,
            status: WithdrawTransactionStatus.MANUAL_CHECKING,
          }),
        },
      });

      await expect(
        workflow.initiateRefund('wd-frozen-1', { reason: 'sanction hit' }, actor),
      ).rejects.toThrow('not FROZEN');
      expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    });

    it('empty reason → BadRequestException, no approval case opened', async () => {
      const { workflow, approvalsService } = buildFrozenWorkflow();

      await expect(
        workflow.initiateRefund('wd-frozen-1', { reason: '   ' }, actor),
      ).rejects.toThrow('reason is required');
      expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    });

    it('duplicate open PENDING sanction-refund approval → ConflictException', async () => {
      const { workflow, approvalsService } = buildFrozenWorkflow({
        approvalsService: { list: jest.fn().mockResolvedValue({ total: 1 }) },
      });

      await expect(
        workflow.initiateRefund('wd-frozen-1', { reason: 'sanction hit' }, actor),
      ).rejects.toThrow('already has a pending sanction-refund approval');
      expect(approvalsService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: ApprovalActionTypes.WITHDRAW_SANCTION_REFUND,
          entityRef: 'wd-frozen-1',
          status: ApprovalStatuses.PENDING,
        }),
      );
      expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    });

    it('happy path: opens a WITHDRAW_SANCTION_REFUND approval case with withdrawNo in the snapshot, no write to the withdraw row', async () => {
      const { workflow, withdrawService, approvalsService, auditLogsService } = buildFrozenWorkflow();

      const result = await workflow.initiateRefund(
        'wd-frozen-1',
        { reason: 'Sanctions hit confirmed — refund to sender' },
        actor,
      );

      expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: ApprovalActionTypes.WITHDRAW_SANCTION_REFUND,
          entityRef: 'wd-frozen-1',
          objectSnapshot: expect.objectContaining({
            withdrawNo: 'WD-FROZEN-1',
            ownerType: 'CUSTOMER',
            ownerId: 'cust-frozen-1',
          }),
        }),
        expect.objectContaining({ reason: 'Sanctions hit confirmed — refund to sender' }),
        actor,
      );
      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordByActor).toHaveBeenCalledTimes(1);
      expect(result).toEqual(
        expect.objectContaining({ withdrawNo: 'WD-FROZEN-1', approvalNo: 'AP-FROZEN-1', status: 'PENDING_APPROVAL' }),
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Task 9: FROZEN maker-checker gates (execution side) —
// onUnfreezeDecided/onUnfreezeApproved/onRefundDecided/onRefundApproved.
// Mirrors DepositWorkflowService's onUnfreezeDecided/onUnfreezeApproved test
// shape: guard-before-mutate (orderRef missing throws BEFORE updateStatus),
// rescore never rethrows (I2), non-FROZEN is a no-op, DECLINED/CANCELLED/
// EXPIRED leave the row untouched.
// ─────────────────────────────────────────────────────────────

describe('WithdrawWorkflowService — Task 9: FROZEN execution side', () => {
  const frozenWithdrawal = {
    id: 'wd-frozen-9',
    withdrawNo: 'WD-FROZEN-9',
    status: WithdrawTransactionStatus.FROZEN,
    ownerType: 'CUSTOMER',
    ownerId: 'cust-frozen-9',
    traceId: 'trace-frozen-9',
    sumsubTxnId: 'sumsub-txn-9',
    netAmount: new Prisma.Decimal(90),
    feeAmount: new Prisma.Decimal(10),
    tbPendingNetId: '11',
    tbPendingFeeId: '22',
    asset: { decimals: 8 },
  };

  function buildWorkflow(overrides: {
    withdrawService?: Partial<Record<string, jest.Mock>>;
    approvalsService?: Partial<Record<string, jest.Mock>>;
    accountingService?: Partial<Record<string, jest.Mock>>;
    sumsubTxnClient?: Partial<Record<string, jest.Mock>>;
  } = {}) {
    const withdrawService = {
      findOneInternal: jest.fn().mockResolvedValue(frozenWithdrawal),
      getOwnerComplianceStatus: jest.fn().mockResolvedValue('ACTIVE'),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      ...overrides.withdrawService,
    };
    const auditLogsService = { recordSystem: jest.fn().mockResolvedValue({}) };
    const approvalsService = {
      list: jest.fn().mockResolvedValue({
        items: [{ objectSnapshot: { orderRef: 'ORDER-REF-9' } }],
        total: 1,
      }),
      ...overrides.approvalsService,
    };
    const accountingService = {
      voidPendingTransferBestEffort: jest.fn().mockResolvedValue(true),
      ...overrides.accountingService,
    };
    const sumsubTxnClient = {
      rescore: jest.fn().mockResolvedValue(undefined),
      ...overrides.sumsubTxnClient,
    };

    const workflow = new WithdrawWorkflowService(
      {} as any, // prisma
      {} as any, // eventEmitter
      withdrawService as any,
      {} as any, // withdrawQuoteService
      auditLogsService as any,
      accountingService as any,
      {} as any, // fundsOrders
      approvalsService as any,
      {} as any, // binanceRateProvider
      {} as any, // systemWalletResolver
      {} as any, // tbEvidenceService
      {} as any, // limitGateService
      {} as any, // limitRulesService
      sumsubTxnClient as any,
      {} as any, // applicantActions
      { assertCapability: jest.fn(), assertOffboardable: jest.fn(), resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }) } as any, // customerAccessService
      { open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST', created: true }) } as any, // customerRestrictionsService
      { evaluate: jest.fn().mockResolvedValue({ evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'WITHDRAW', verdict: 'PASS', holdReason: null, tradingTier: 'BASIC', checks: [] }) } as any, // l1Gate
    );

    return { workflow, withdrawService, auditLogsService, approvalsService, accountingService, sumsubTxnClient };
  }

  describe('onUnfreezeDecided / onUnfreezeApproved', () => {
    it('APPROVED + FROZEN: RESUME → COMPLIANCE_PENDING, audit contains orderRef, rescore called with sumsubTxnId', async () => {
      const { workflow, withdrawService, auditLogsService, sumsubTxnClient } = buildWorkflow();

      await workflow.onUnfreezeDecided({
        decision: 'APPROVED',
        entityRef: frozenWithdrawal.id,
        approvalNo: 'AP-UNFREEZE-1',
      });

      expect(withdrawService.updateStatus).toHaveBeenCalledWith(
        frozenWithdrawal.id,
        expect.objectContaining({ action: WithdrawTransactionAction.RESUME }),
        expect.anything(),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.WITHDRAW_UNFROZEN,
          reason: expect.stringContaining('ORDER-REF-9'),
        }),
      );
      expect(sumsubTxnClient.rescore).toHaveBeenCalledWith('sumsub-txn-9');
    });

    it('orderRef missing on the APPROVED case → throws BEFORE updateStatus', async () => {
      const { workflow, withdrawService } = buildWorkflow({
        approvalsService: {
          list: jest.fn().mockResolvedValue({ items: [{ objectSnapshot: {} }], total: 1 }),
        },
      });

      await expect(
        workflow.onUnfreezeDecided({
          decision: 'APPROVED',
          entityRef: frozenWithdrawal.id,
          approvalNo: 'AP-UNFREEZE-2',
        }),
      ).rejects.toThrow('no APPROVED');
      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
    });

    it('rescore throws → status stays committed (COMPLIANCE_PENDING), no rethrow', async () => {
      const { workflow, withdrawService, auditLogsService, sumsubTxnClient } = buildWorkflow({
        sumsubTxnClient: { rescore: jest.fn().mockRejectedValue(new Error('sumsub down')) },
      });

      await expect(
        workflow.onUnfreezeDecided({
          decision: 'APPROVED',
          entityRef: frozenWithdrawal.id,
          approvalNo: 'AP-UNFREEZE-3',
        }),
      ).resolves.not.toThrow();

      expect(withdrawService.updateStatus).toHaveBeenCalledTimes(1);
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_UNFROZEN }),
      );
      expect(sumsubTxnClient.rescore).toHaveBeenCalledWith('sumsub-txn-9');
    });

    it('empty sumsubTxnId → rescore skipped', async () => {
      const { workflow, sumsubTxnClient } = buildWorkflow({
        withdrawService: {
          findOneInternal: jest.fn().mockResolvedValue({ ...frozenWithdrawal, sumsubTxnId: null }),
          getOwnerComplianceStatus: jest.fn().mockResolvedValue('ACTIVE'),
          updateStatus: jest.fn().mockResolvedValue(undefined),
        },
      });

      await workflow.onUnfreezeDecided({
        decision: 'APPROVED',
        entityRef: frozenWithdrawal.id,
        approvalNo: 'AP-UNFREEZE-4',
      });

      expect(sumsubTxnClient.rescore).not.toHaveBeenCalled();
    });

    it('non-FROZEN withdrawal → no-op (updateStatus not called, orderRef never fetched)', async () => {
      const { workflow, withdrawService, approvalsService } = buildWorkflow({
        withdrawService: {
          findOneInternal: jest.fn().mockResolvedValue({
            ...frozenWithdrawal,
            status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
          }),
          updateStatus: jest.fn().mockResolvedValue(undefined),
        },
      });

      await workflow.onUnfreezeDecided({
        decision: 'APPROVED',
        entityRef: frozenWithdrawal.id,
        approvalNo: 'AP-UNFREEZE-5',
      });

      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      expect(approvalsService.list).not.toHaveBeenCalled();
    });

    it('DECLINED → nothing executed, row untouched', async () => {
      const { workflow, withdrawService, approvalsService } = buildWorkflow();

      await workflow.onUnfreezeDecided({
        decision: 'DECLINED',
        entityRef: frozenWithdrawal.id,
        approvalNo: 'AP-UNFREEZE-6',
      });

      expect(withdrawService.findOneInternal).not.toHaveBeenCalled();
      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      expect(approvalsService.list).not.toHaveBeenCalled();
    });
  });

  describe('onRefundDecided / onRefundApproved', () => {
    it('APPROVED + FROZEN: REJECT_REFUND → REJECTED, releaseLock called (void x2), audit written', async () => {
      const { workflow, withdrawService, accountingService, auditLogsService } = buildWorkflow();

      await workflow.onRefundDecided({
        decision: 'APPROVED',
        entityRef: frozenWithdrawal.id,
        approvalNo: 'AP-REFUND-1',
      });

      expect(withdrawService.updateStatus).toHaveBeenCalledWith(
        frozenWithdrawal.id,
        expect.objectContaining({ action: WithdrawTransactionAction.REJECT_REFUND }),
        expect.anything(),
      );
      // P6 primitive reused exactly: voids both net + fee pendings.
      expect(accountingService.voidPendingTransferBestEffort).toHaveBeenCalledTimes(2);
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_LOCK_RELEASED }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_SANCTION_REFUNDED }),
      );
    });

    it('non-FROZEN withdrawal → no-op, no releaseLock', async () => {
      const { workflow, withdrawService, accountingService } = buildWorkflow({
        withdrawService: {
          findOneInternal: jest.fn().mockResolvedValue({
            ...frozenWithdrawal,
            status: WithdrawTransactionStatus.MANUAL_CHECKING,
          }),
          updateStatus: jest.fn().mockResolvedValue(undefined),
        },
      });

      await workflow.onRefundDecided({
        decision: 'APPROVED',
        entityRef: frozenWithdrawal.id,
        approvalNo: 'AP-REFUND-2',
      });

      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      expect(accountingService.voidPendingTransferBestEffort).not.toHaveBeenCalled();
    });

    it('CANCELLED/EXPIRED/DECLINED → nothing executed, row untouched', async () => {
      const { workflow, withdrawService } = buildWorkflow();

      await workflow.onRefundDecided({
        decision: 'CANCELLED',
        entityRef: frozenWithdrawal.id,
        approvalNo: 'AP-REFUND-3',
      });

      expect(withdrawService.findOneInternal).not.toHaveBeenCalled();
      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('WithdrawWorkflowService — onLegCleared clears needsReview', () => {
    it('SUCCESS settle with needsReview=true → clearNeedsReview called', async () => {
      const successWithdrawal = {
        id: 'w-success-1',
        withdrawNo: 'WD-SUCCESS-1',
        status: WithdrawTransactionStatus.PAYOUT_PENDING,
        needsReview: true,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-123',
        asset: { type: 'CRYPTO', decimals: 8 },
        feeAmount: '10',
        traceId: 'trace-success-1',
      };

      const withdrawService = {
        findOneInternal: jest.fn().mockResolvedValue(successWithdrawal),
        getOwnerComplianceStatus: jest.fn().mockResolvedValue('ACTIVE'),
        updateStatus: jest.fn().mockResolvedValue(successWithdrawal),
        clearNeedsReview: jest.fn().mockResolvedValue({}),
      };

      const fundsOrderService = {
        findByParent: jest.fn().mockResolvedValue([
          { legSeq: 1, status: FundsOrderStatus.CLEARED, attempt: 1 },
          { legSeq: 2, status: FundsOrderStatus.CLEARED, attempt: 1 },
        ]),
      };

      const auditLogsService = {
        recordSystem: jest.fn().mockResolvedValue({}),
      };

      const accountingService = {
        assertWithdrawSettled: jest.fn().mockResolvedValue(undefined),
      };

      const prismaService = {
        tbTransferEvidence: {
          findMany: jest.fn().mockResolvedValue([
            { eventCode: 'WITHDRAW_FEE_POST' },
            { eventCode: 'WITHDRAW_FEE_FIRM' },
            { eventCode: 'WITHDRAW_PAYOUT_POST' },
          ]),
        },
      };

      const workflow = new WithdrawWorkflowService(
        prismaService as any, // prisma
        {} as any, // eventEmitter
        withdrawService as any,
        {} as any, // withdrawQuoteService
        auditLogsService as any,
        accountingService as any,
        fundsOrderService as any,
        {} as any, // approvalsService
        {} as any, // binanceRateProvider
        {} as any, // systemWalletResolver
        {} as any, // tbEvidenceService
        {} as any, // limitGateService
        {} as any, // limitRulesService
        {} as any, // sumsubTxnClient
        {} as any, // applicantActions
        { assertCapability: jest.fn(), assertOffboardable: jest.fn(), resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }) } as any, // customerAccessService
        { open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST', created: true }) } as any, // customerRestrictionsService
        { evaluate: jest.fn().mockResolvedValue({ evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'WITHDRAW', verdict: 'PASS', holdReason: null, tradingTier: 'BASIC', checks: [] }) } as any, // l1Gate
      );

      // Trigger onLegCleared indirectly via handleFundsOrderChanged (which calls onLegCleared)
      await workflow.handleFundsOrderChanged({
        fundsOrderId: 'fo-leg-2',
        fundsOrderNo: 'FO-LEG-2',
        parent: { withdrawTransactionId: 'w-success-1' },
        legSeq: 2,
        attempt: 1,
        oldStatus: FundsOrderStatus.CONFIRMED,
        newStatus: FundsOrderStatus.CLEARED,
      });

      // Verify clearNeedsReview was called
      expect(withdrawService.clearNeedsReview).toHaveBeenCalledWith('w-success-1');
    });
  });
});

// Task 7：批量冻单 —— 提现域审计已由 assertCustomerComplianceOrFreeze 内建（WITHDRAW_FROZEN），
// 这里只验证自咬（本域自己刚冻的单被自己的监听器再冻一次）降级判定。
describe('WithdrawWorkflowService — onCustomerRestrictionOpened 批量冻单自咬降级', () => {
  const baseEvent = {
    customerId: 'cust-1',
    restrictionNo: 'CR-1',
    cause: 'SANCTION',
    blocksAllCapabilities: true as const,
    traceId: 'trace-1',
  };
  const inflightWithdrawal = {
    id: 'w-inflight-1',
    withdrawNo: 'WD-INFLIGHT-1',
    ownerType: 'CUSTOMER',
    ownerId: 'cust-1',
    status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
    traceId: 'trace-w-1',
  };

  function buildWorkflow() {
    const withdrawService = {
      findNonTerminalByOwner: jest.fn().mockResolvedValue([inflightWithdrawal]),
      findOneInternal: jest.fn(),
      updateStatus: jest.fn(),
    };
    const auditLogsService = { recordSystem: jest.fn().mockResolvedValue({}) };
    const customerAccessService = {
      assertCapability: jest.fn(),
      assertOffboardable: jest.fn(),
      resolve: jest.fn().mockResolvedValue({
        lifecycle: 'ACTIVE',
        blocked: new Set(['WITHDRAW']),
        disclosedBlocked: new Set<string>(),
        disclosed: [],
        openCount: 1,
      }),
    };
    const workflow = new WithdrawWorkflowService(
      {} as any, // prisma
      {} as any, // eventEmitter
      withdrawService as any,
      {} as any, // withdrawQuoteService
      auditLogsService as any,
      {} as any, // accountingService
      {} as any, // fundsOrders
      {} as any, // approvalsService
      {} as any, // binanceRateProvider
      {} as any, // systemWalletResolver
      {} as any, // tbEvidenceService
      {} as any, // limitGateService
      {} as any, // limitRulesService
      {} as any, // sumsubTxnClient
      {} as any, // applicantActions
      customerAccessService as any,
      { open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST', created: true }) } as any, // customerRestrictionsService
      { evaluate: jest.fn().mockResolvedValue({ evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'WITHDRAW', verdict: 'PASS', holdReason: null, tradingTier: 'BASIC', checks: [] }) } as any, // l1Gate
    );
    return { workflow, withdrawService, auditLogsService };
  }

  it('冻结成功时经 assertCustomerComplianceOrFreeze 写 WITHDRAW_FROZEN 审计', async () => {
    const { workflow, withdrawService, auditLogsService } = buildWorkflow();
    withdrawService.updateStatus.mockResolvedValue(undefined);

    await workflow.onCustomerRestrictionOpened(baseEvent);

    expect(withdrawService.updateStatus).toHaveBeenCalledWith(
      inflightWithdrawal.id,
      expect.objectContaining({ action: WithdrawTransactionAction.FREEZE }),
      expect.anything(),
    );
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.WITHDRAW_FROZEN }),
    );
  });

  it('自咬：updateStatus 抛异常但复核发现单已是 FROZEN → 降级 debug，不打 warn', async () => {
    const { workflow, withdrawService } = buildWorkflow();
    withdrawService.updateStatus.mockRejectedValue(
      new Error("Invalid action 'freeze' for status 'FROZEN'"),
    );
    withdrawService.findOneInternal.mockResolvedValue({
      ...inflightWithdrawal,
      status: WithdrawTransactionStatus.FROZEN,
    });
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined as any);
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined as any);

    await workflow.onCustomerRestrictionOpened(baseEvent);

    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining(inflightWithdrawal.withdrawNo));
    // assertCustomerComplianceOrFreeze 自身在"blocked"分支入口无条件打一条 A4 warn
    // （与本次自咬判定无关的既有行为，不在本任务改动范围内）——只断言本任务新增的
    // "Failed to freeze" 误导性 warn 没有再出现。
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Failed to freeze'));

    warnSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('真失败：updateStatus 抛异常且复核显示单不是 FROZEN → 照旧打 warn', async () => {
    const { workflow, withdrawService } = buildWorkflow();
    withdrawService.updateStatus.mockRejectedValue(new Error('DB connection lost'));
    withdrawService.findOneInternal.mockResolvedValue({
      ...inflightWithdrawal,
      status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
    });
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined as any);
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined as any);

    await workflow.onCustomerRestrictionOpened(baseEvent);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to freeze'));
    expect(debugSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    debugSpy.mockRestore();
  });

  // 审计写入独立 catch 的非空性：updateStatus 成功（单确实冻上了，在
  // assertCustomerComplianceOrFreeze 内部完成），但审计写入抛异常——必须以
  // logger.error 现身，不能被 onCustomerRestrictionOpened 外层 catch 的回读判据
  // 吃成「良性自咬」（外层 catch 根本不该被触发，因为审计调用自带 .catch 不再
  // 向上抛给 assertCustomerComplianceOrFreeze 的调用方）。
  it('审计写入独立 catch：updateStatus 成功但 recordSystem 抛异常 → logger.error 现身，不判成良性自咬', async () => {
    const { workflow, withdrawService, auditLogsService } = buildWorkflow();
    withdrawService.updateStatus.mockResolvedValue(undefined);
    auditLogsService.recordSystem.mockRejectedValue(new Error('audit db unavailable'));
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined as any);
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined as any);
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined as any);

    await workflow.onCustomerRestrictionOpened(baseEvent);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Failed to write WITHDRAW_FROZEN audit for ${inflightWithdrawal.withdrawNo}`),
    );
    // 不得只打 debug（良性自咬的降级路径不该被触发——updateStatus 本身没抛）。
    expect(debugSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Failed to freeze'));

    warnSpy.mockRestore();
    debugSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
