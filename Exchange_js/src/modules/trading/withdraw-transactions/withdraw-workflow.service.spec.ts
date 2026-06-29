import { Prisma } from '@prisma/client';
import { WithdrawWorkflowService, IllegalSourceWalletError } from './withdraw-workflow.service';
import {
  WithdrawTransactionAction,
  WithdrawTransactionStatus,
} from './dto/withdraw-transaction.dto';
import { AuditActions } from '../../audit-logging/constants/audit-actions.constant';
import { InternalFundStatus } from '../../funds-layer/dto/internal-fund.dto';
import { PayoutStatus } from '../../asset-treasury/payouts/dto/payout.dto';

describe('WithdrawWorkflowService — releaseLock on approval decline', () => {
  let workflow: WithdrawWorkflowService;
  let withdrawService: any;
  let auditLogsService: any;
  let accountingService: any;
  let fundsFlowService: any;

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
    fundsFlowService = {
      setWithdrawFeeFundStatus: jest.fn().mockResolvedValue(undefined),
    };

    workflow = new WithdrawWorkflowService(
      {} as any, // prisma
      {} as any, // eventEmitter
      withdrawService as any,
      {} as any, // withdrawQuoteService
      auditLogsService as any,
      accountingService as any,
      {} as any, // payoutsService
      {} as any, // approvalsService
      {} as any, // binanceRateProvider
      fundsFlowService as any,
      {} as any, // systemWalletResolver
      {} as any, // tbEvidenceService
    );
  });

  it('releases both pending locks, cancels the fee fund, and audits WITHDRAW_LOCK_RELEASED on decline', async () => {
    await workflow.onLargeValueApprovalDecided({
      decision: 'DECLINED',
      entityRef: declinedWithdrawal.id,
      approvalNo: 'AP-1',
      decisionReason: 'risk',
    });

    // Voids both pending transfers (net + fee).
    expect(accountingService.voidPendingTransferBestEffort).toHaveBeenCalledTimes(2);

    // Cancels the fee InternalFund.
    expect(fundsFlowService.setWithdrawFeeFundStatus).toHaveBeenCalledWith(
      declinedWithdrawal.id,
      InternalFundStatus.CANCELLED,
      expect.any(String),
    );

    // Writes the lock-released audit.
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.WITHDRAW_LOCK_RELEASED }),
    );
  });
});

describe('WithdrawWorkflowService — releaseLock on payout failure (P6)', () => {
  let workflow: WithdrawWorkflowService;
  let withdrawService: any;
  let auditLogsService: any;
  let accountingService: any;
  let fundsFlowService: any;

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
    fundsFlowService = {
      setWithdrawFeeFundStatus: jest.fn().mockResolvedValue(undefined),
    };

    workflow = new WithdrawWorkflowService(
      {} as any, // prisma
      {} as any, // eventEmitter
      withdrawService as any,
      {} as any, // withdrawQuoteService
      auditLogsService as any,
      accountingService as any,
      {} as any, // payoutsService
      {} as any, // approvalsService
      {} as any, // binanceRateProvider
      fundsFlowService as any,
      {} as any, // systemWalletResolver
      {} as any, // tbEvidenceService
    );
  });

  it('voids both pending locks, cancels the fee fund, audits release, and fails the withdrawal on EVT_PAYOUT_FAILED', async () => {
    await workflow.onPayoutFailed({
      withdrawId: payoutPendingWithdrawal.id,
      payoutId: 'po-1',
      status: PayoutStatus.FAILED,
    });

    // Transitions the withdrawal toward FAILED.
    expect(withdrawService.updateStatus).toHaveBeenCalledWith(
      payoutPendingWithdrawal.id,
      expect.objectContaining({ action: WithdrawTransactionAction.FAIL }),
      expect.anything(),
    );

    // THE P6 FIX: voids both pending transfers (net + fee).
    expect(accountingService.voidPendingTransferBestEffort).toHaveBeenCalledTimes(2);

    // Cancels the fee InternalFund.
    expect(fundsFlowService.setWithdrawFeeFundStatus).toHaveBeenCalledWith(
      payoutPendingWithdrawal.id,
      InternalFundStatus.CANCELLED,
      expect.any(String),
    );

    // Writes the lock-released audit.
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.WITHDRAW_LOCK_RELEASED }),
    );
  });
});

describe('WithdrawWorkflowService — assertWithdrawSettled (乙 SUCCESS invariant)', () => {
  let workflow: WithdrawWorkflowService;
  let prisma: any;
  let payoutsService: any;

  beforeEach(() => {
    prisma = {
      tbTransferEvidence: { findMany: jest.fn() },
    };
    payoutsService = {
      findOne: jest.fn(),
    };

    workflow = new WithdrawWorkflowService(
      prisma as any, // prisma
      {} as any, // eventEmitter
      {} as any, // withdrawService
      {} as any, // withdrawQuoteService
      {} as any, // auditLogsService
      {} as any, // accountingService
      payoutsService as any, // payoutsService
      {} as any, // approvalsService
      {} as any, // binanceRateProvider
      {} as any, // fundsFlowService
      {} as any, // systemWalletResolver
      {} as any, // tbEvidenceService
    );
  });

  const baseWithdrawal = {
    id: 'wd-settle-1',
    withdrawNo: 'WD9200',
    payoutId: 'po-settle-1',
    tbPendingNetId: '101',
  };

  it('throws when firm-fee evidence (WITHDRAW_FEE_FIRM) is missing', async () => {
    payoutsService.findOne.mockResolvedValue({ status: PayoutStatus.CONFIRMED });
    prisma.tbTransferEvidence.findMany.mockResolvedValue([
      { eventCode: 'WITHDRAW_NET_POST' },
      { eventCode: 'WITHDRAW_FEE_POST' },
    ]);

    await expect(
      (workflow as any).assertWithdrawSettled(baseWithdrawal, 100n),
    ).rejects.toThrow(/WITHDRAW_FEE_FIRM/);
  });

  it('throws when the payout is not confirmed', async () => {
    payoutsService.findOne.mockResolvedValue({ status: 'CONFIRMING' });

    await expect(
      (workflow as any).assertWithdrawSettled(baseWithdrawal, 100n),
    ).rejects.toThrow(/payout/);
  });

  it('resolves when payout is confirmed and all settlement evidence is present', async () => {
    payoutsService.findOne.mockResolvedValue({ status: PayoutStatus.CONFIRMED });
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
      {} as any, // payoutsService
      {} as any, // approvalsService
      {} as any, // binanceRateProvider
      {} as any, // fundsFlowService
      {} as any, // systemWalletResolver
      {} as any, // tbEvidenceService
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
