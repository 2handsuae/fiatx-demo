import { Prisma } from '@prisma/client';
import { WithdrawWorkflowService, IllegalSourceWalletError } from './withdraw-workflow.service';
import {
  WithdrawTransactionAction,
  WithdrawTransactionStatus,
} from './dto/withdraw-transaction.dto';
import { AuditActions } from '../../audit-logging/constants/audit-actions.constant';
import { FundsOrderStatus } from '../../funds-orders/dto/funds-order.dto';

describe('WithdrawWorkflowService — releaseLock on approval decline', () => {
  let workflow: WithdrawWorkflowService;
  let withdrawService: any;
  let auditLogsService: any;
  let accountingService: any;

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
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue({}),
    };
    accountingService = {
      voidPendingTransferBestEffort: jest.fn().mockResolvedValue(true),
    };

    workflow = new WithdrawWorkflowService(
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
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue({}),
    };
    accountingService = {
      voidPendingTransferBestEffort: jest.fn().mockResolvedValue(true),
    };

    workflow = new WithdrawWorkflowService(
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

// Task 5 review: D1 large-value approval threshold now comes from the rule row
// (getLargeApprovalThreshold), not a dead constant. Fail-closed on a missing rule
// or a failed re-valuation — with a sane reason string (never "≥ null AED").
describe('WithdrawWorkflowService.handleWithdrawalCreated — D1 threshold source + fail-closed', () => {
  const event = {
    withdrawId: 'wd-hc-1',
    withdrawNo: 'WD7001',
    status: 'CREATED',
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
      status: WithdrawTransactionStatus.CREATED,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-hc',
      traceId: 'trace-hc',
      amount: new Prisma.Decimal('100'),
      asset: { currency: 'USDT', type: 'CRYPTO' },
    };
    const withdrawService = {
      findOneInternal: jest.fn().mockResolvedValue(row),
      saveValuationSnapshot: jest.fn().mockResolvedValue(undefined),
      linkApprovalCase: jest.fn().mockResolvedValue(undefined),
      updateStatus: jest.fn().mockResolvedValue(undefined),
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
    );
    return { workflow, withdrawService, approvalsService, binanceRateProvider, limitRulesService };
  }

  it('reads getLargeApprovalThreshold(WITHDRAWAL); a null rule routes to approval with a sane reason (no "≥ null AED")', async () => {
    const { workflow, withdrawService, approvalsService, limitRulesService } = buildWorkflow({
      threshold: null,
    });

    await workflow.handleWithdrawalCreated(event);

    expect(limitRulesService.getLargeApprovalThreshold).toHaveBeenCalledWith('WITHDRAWAL');
    // Fail-closed on the missing rule → approval, not compliance.
    expect(approvalsService.createAndSubmit).toHaveBeenCalledTimes(1);
    expect(withdrawService.updateStatus).toHaveBeenCalledWith(
      'wd-hc-1',
      expect.objectContaining({ action: WithdrawTransactionAction.REQUIRE_APPROVAL }),
      expect.anything(),
    );
    const reason = (approvalsService.createAndSubmit as jest.Mock).mock.calls[0][1].reason as string;
    expect(reason).not.toContain('null');
    expect(reason).toContain('large-value approval required');
  });

  it('fail-closes to approval when the re-valuation fails, passing the fresh failed valuation to persistence', async () => {
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
    expect(withdrawService.updateStatus).toHaveBeenCalledWith(
      'wd-hc-1',
      expect.objectContaining({ action: WithdrawTransactionAction.REQUIRE_APPROVAL }),
      expect.anything(),
    );
    const reason = (approvalsService.createAndSubmit as jest.Mock).mock.calls[0][1].reason as string;
    expect(reason).toContain('200000');
  });
});
