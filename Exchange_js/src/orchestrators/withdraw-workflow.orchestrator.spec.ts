import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { WithdrawWorkflowOrchestrator } from './withdraw-workflow.orchestrator';
import { WithdrawTransactionsService } from '../modules/trading/withdraw-transactions/withdraw-transactions.service';
import { PayoutsService } from '../modules/asset-treasury/payouts/payouts.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { TransactionComplianceService } from '../modules/risk-engine/transaction-compliance/transaction-compliance.service';
import { WithdrawTransactionStatus } from '../modules/trading/withdraw-transactions/dto/withdraw-transaction.dto';
import {
  PayoutStatus,
  PayoutType,
} from '../modules/asset-treasury/payouts/dto/payout.dto';
import { AuditLogsService } from '../modules/audit-logging/audit-logs.service';

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

describe('WithdrawWorkflowOrchestrator', () => {
  let orchestrator: WithdrawWorkflowOrchestrator;
  let withdrawalService: any;
  let payoutsService: any;
  let transactionComplianceService: any;
  let prisma: any;

  const mockPrisma: any = {
    $transaction: jest.fn((cb) => cb(mockPrisma)),
    auditLogEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    withdrawTransaction: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    wallet: {
      findFirst: jest.fn(),
    },
    payout: {
      findUnique: jest.fn(),
    },
    journal: {
      findMany: jest.fn(),
    },
    clearing: {
      findMany: jest.fn(),
    },
  };

  const mockWithdrawalService = {
    findOne: jest.fn(),
    updateStatus: jest.fn(),
  };

  const mockPayoutsService = {
    create: jest.fn(),
    updateStatus: jest.fn(),
  };

  const mockTransactionComplianceService = {
    ensureWithdrawMainCasesOnPayoutConfirmed: jest.fn(),
  };

  const mockAuditLogsService = {
    recordSystem: jest.fn().mockResolvedValue({}),
    recordByActor: jest.fn().mockResolvedValue({}),
    hasIdempotencyKey: jest.fn().mockResolvedValue(false),
  };

  const baseWithdrawal = {
    id: 'WD_1',
    status: WithdrawTransactionStatus.PAYOUT_PENDING,
    ownerType: 'CUSTOMER',
    type: 'fiat',
    asset: { type: 'FIAT' },
    ownerId: 'CUST_1',
    assetId: 'AST_1',
    withdrawNo: 'WD0001',
    amount: new Prisma.Decimal(100),
    netAmount: new Prisma.Decimal(98),
    feeAmount: new Prisma.Decimal(2),
    toAddress: null,
    toIban: 'IBAN_1',
    toWalletId: null,
    fromWalletId: 'WALLET_SRC_1',
    fromWalletNo: 'WA2600000001',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WithdrawWorkflowOrchestrator,
        {
          provide: WithdrawTransactionsService,
          useValue: mockWithdrawalService,
        },
        { provide: PayoutsService, useValue: mockPayoutsService },
        {
          provide: TransactionComplianceService,
          useValue: mockTransactionComplianceService,
        },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    orchestrator = module.get<WithdrawWorkflowOrchestrator>(
      WithdrawWorkflowOrchestrator,
    );
    withdrawalService = module.get<WithdrawTransactionsService>(
      WithdrawTransactionsService,
    );
    payoutsService = module.get<PayoutsService>(PayoutsService);
    transactionComplianceService = module.get<TransactionComplianceService>(
      TransactionComplianceService,
    );
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should execute payout confirmed atomic path', async () => {
    mockPrisma.auditLogEvent.findUnique.mockResolvedValue(null);
    mockPrisma.payout.findUnique.mockResolvedValue({
      id: 'PO_1',
      withdrawId: 'WD_1',
      status: PayoutStatus.CONFIRMED,
    });
    mockWithdrawalService.findOne.mockResolvedValue({
      ...baseWithdrawal,
      type: 'crypto',
      asset: { type: 'CRYPTO' },
    });
    mockWithdrawalService.updateStatus.mockResolvedValue({
      ...baseWithdrawal,
      status: WithdrawTransactionStatus.SUCCESS,
      type: 'crypto',
      asset: { type: 'CRYPTO' },
    });
    mockTransactionComplianceService.ensureWithdrawMainCasesOnPayoutConfirmed.mockResolvedValue(
      {},
    );
    mockPayoutsService.updateStatus.mockResolvedValue({
      id: 'PO_1',
      status: PayoutStatus.CLEARED,
    });
    mockPrisma.auditLogEvent.create.mockResolvedValue({ id: 'LOG_1' });

    const result = await orchestrator.onPayoutConfirmed({
      withdrawId: 'WD_1',
      payoutId: 'PO_1',
    });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(withdrawalService.updateStatus).toHaveBeenCalledWith(
      'WD_1',
      expect.objectContaining({ action: 'success' }),
      expect.objectContaining({
        source: 'SYSTEM',
        actorId: 'SYSTEM',
      }),
      mockPrisma,
    );
    expect(
      transactionComplianceService.ensureWithdrawMainCasesOnPayoutConfirmed,
    ).not.toHaveBeenCalled();
    expect(payoutsService.updateStatus).toHaveBeenCalledWith(
      'PO_1',
      expect.objectContaining({ action: 'CLEAR' }),
      'SYSTEM',
      mockPrisma,
    );
    expect(result?.updated_withdrawal_status).toBe(
      WithdrawTransactionStatus.SUCCESS,
    );
    expect(result?.updated_payout_status).toBe(PayoutStatus.CLEARED);
  });

  it('should skip payout confirmed when marker exists', async () => {
    mockPrisma.payout.findUnique.mockResolvedValue({
      id: 'PO_1',
      withdrawId: 'WD_1',
      status: PayoutStatus.CONFIRMED,
    });
    mockPrisma.auditLogEvent.findUnique.mockResolvedValue({
      id: 'LOG_EXIST',
    });
    mockAuditLogsService.hasIdempotencyKey.mockResolvedValueOnce(true);

    const result = await orchestrator.onPayoutConfirmed({
      withdrawId: 'WD_1',
      payoutId: 'PO_1',
    });

    expect(result).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('should process approved event without second approve status transition', async () => {
    mockPrisma.auditLogEvent.findUnique.mockResolvedValue(null);
    mockWithdrawalService.findOne.mockResolvedValue(baseWithdrawal);
    mockPrisma.withdrawTransaction.findUnique.mockResolvedValue(baseWithdrawal);
    mockPrisma.payout.findUnique.mockResolvedValue(null);
    mockPayoutsService.create.mockResolvedValue({
      id: 'PO_2',
      payoutNo: 'PO0002',
    });
    mockPrisma.withdrawTransaction.update.mockResolvedValue({
      ...baseWithdrawal,
      payoutId: 'PO_2',
      payoutNo: 'PO0002',
    });
    mockPrisma.auditLogEvent.create.mockResolvedValue({ id: 'LOG_APR' });

    const result = await orchestrator.onWithdrawalApprovedFiat({
      withdrawId: 'WD_1',
    });

    expect(withdrawalService.updateStatus).not.toHaveBeenCalledWith(
      'WD_1',
      expect.objectContaining({ action: 'approve' }),
      expect.anything(),
    );
    expect(payoutsService.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.withdrawTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payoutId: 'PO_2',
          payoutNo: 'PO0002',
        }),
      }),
    );
    expect(result?.payout_binding_status).toBe('created');
  });

  it('should resolve source wallet before approved accounting when fromWalletId is missing', async () => {
    mockPrisma.auditLogEvent.findUnique.mockResolvedValue(null);
    mockWithdrawalService.findOne.mockResolvedValue({
      ...baseWithdrawal,
      fromWalletId: null,
      fromWalletNo: null,
      asset: { type: 'FIAT', code: 'AED', network: null, currency: 'AED' },
    });
    mockPrisma.withdrawTransaction.findUnique
      .mockResolvedValueOnce({
        ...baseWithdrawal,
        fromWalletId: null,
        fromWalletNo: null,
        asset: { type: 'FIAT', code: 'AED', network: null, currency: 'AED' },
      })
      .mockResolvedValueOnce({
        ...baseWithdrawal,
        fromWalletId: 'WALLET_RESOLVED_1',
        fromWalletNo: 'WA2600000001',
        asset: { type: 'FIAT' },
      });
    mockPrisma.wallet.findFirst.mockResolvedValue({
      id: 'WALLET_RESOLVED_1',
      walletNo: 'WA2600000001',
      address: null,
      iban: 'AE00FIATX1234567890',
    });
    mockPrisma.withdrawTransaction.update
      .mockResolvedValueOnce({
        ...baseWithdrawal,
        fromWalletId: 'WALLET_RESOLVED_1',
        fromWalletNo: 'WA2600000001',
      })
      .mockResolvedValueOnce({
        ...baseWithdrawal,
        payoutId: 'PO_2',
        payoutNo: 'PO0002',
      });
    mockPrisma.payout.findUnique.mockResolvedValue(null);
    mockPayoutsService.create.mockResolvedValue({
      id: 'PO_2',
      payoutNo: 'PO0002',
    });
    mockPrisma.auditLogEvent.create.mockResolvedValue({ id: 'LOG_APR2' });

    await orchestrator.onWithdrawalApprovedFiat({
      withdrawId: 'WD_1',
    });

    expect(mockPrisma.wallet.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          walletRole: 'C_CMA',
          ownerType: 'PLATFORM',
          assetId: 'AST_1',
        }),
      }),
    );
    expect(mockPrisma.withdrawTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromWalletId: 'WALLET_RESOLVED_1',
          fromWalletNo: 'WA2600000001',
        }),
      }),
    );
  });

  it('should use asset.type when deriving payout type suffix', async () => {
    mockPrisma.auditLogEvent.findUnique.mockResolvedValue(null);
    mockWithdrawalService.findOne.mockResolvedValue({
      ...baseWithdrawal,
      type: 'crypto',
      asset: { type: 'FIAT' },
    });
    mockPrisma.withdrawTransaction.findUnique.mockResolvedValue({
      ...baseWithdrawal,
      asset: { type: 'FIAT' },
    });
    mockPrisma.payout.findUnique.mockResolvedValue(null);
    mockPayoutsService.create.mockResolvedValue({
      id: 'PO_3',
      payoutNo: 'PO0003',
    });
    mockPrisma.withdrawTransaction.update.mockResolvedValue({
      ...baseWithdrawal,
      payoutId: 'PO_3',
      payoutNo: 'PO0003',
    });
    mockPrisma.auditLogEvent.create.mockResolvedValue({ id: 'LOG_ASSET' });

    await orchestrator.onWithdrawalApprovedFiat({
      withdrawId: 'WD_1',
    });

    expect(payoutsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: PayoutType.FIAT,
      }),
      'SYSTEM',
      mockPrisma,
    );
  });

  it('should process payout failed via config-driven triggerEvent and cancel clearing', async () => {
    mockPrisma.auditLogEvent.findUnique.mockResolvedValue(null);
    mockPrisma.payout.findUnique.mockResolvedValue({
      id: 'PO_1',
      withdrawId: 'WD_1',
      status: PayoutStatus.FAILED,
    });
    mockWithdrawalService.findOne.mockResolvedValue(baseWithdrawal);
    mockPrisma.withdrawTransaction.findUnique.mockResolvedValue(baseWithdrawal);
    mockWithdrawalService.updateStatus.mockResolvedValue({
      ...baseWithdrawal,
      status: WithdrawTransactionStatus.FAILED,
    });
    mockPrisma.auditLogEvent.create.mockResolvedValue({ id: 'LOG_FAIL' });

    const result = await orchestrator.onPayoutFailed({
      withdrawId: 'WD_1',
      payoutId: 'PO_1',
      status: PayoutStatus.FAILED,
    });

    // V2 accounting + clearing removed — no journal/clearing assertions
    expect(result?.created_or_reversed_journal_entry_ids).toEqual([]);
  });

  it('should replay compensation when marker exists but compensation artifacts are incomplete', async () => {
    mockPrisma.payout.findUnique.mockResolvedValue({
      id: 'PO_1',
      withdrawId: 'WD_1',
      status: PayoutStatus.FAILED,
    });
    mockPrisma.auditLogEvent.findUnique.mockResolvedValue({ id: 'LOG_EXIST' });
    mockAuditLogsService.hasIdempotencyKey.mockResolvedValueOnce(true);
    mockWithdrawalService.findOne.mockResolvedValue({
      ...baseWithdrawal,
      status: WithdrawTransactionStatus.FAILED,
    });
    mockPrisma.journal.findMany.mockResolvedValueOnce([
      { id: 'JO_SRC_1' },
    ]).mockResolvedValueOnce([
      { reversalOfJournalId: 'JO_SRC_1' },
    ]);
    mockPrisma.clearing.findMany.mockResolvedValue([
      { clearingStatus: 'CLEARED' },
    ]);
    mockPrisma.withdrawTransaction.findUnique.mockResolvedValue({
      ...baseWithdrawal,
      status: WithdrawTransactionStatus.FAILED,
    });
    mockPrisma.auditLogEvent.create.mockResolvedValue({ id: 'LOG_EXIST' });

    const result = await orchestrator.onPayoutFailed({
      withdrawId: 'WD_1',
      payoutId: 'PO_1',
      status: PayoutStatus.FAILED,
    });

    // V2 accounting + clearing removed — no journal/clearing assertions
    expect(result?.updated_withdrawal_status).toBe(WithdrawTransactionStatus.FAILED);
  });

  it('should re-run canonical closeout from payout detail repair endpoint flow', async () => {
    mockPrisma.payout.findUnique
      .mockResolvedValueOnce({
        id: 'PO_1',
        withdrawId: 'WD_1',
        status: PayoutStatus.CONFIRMED,
      })
      .mockResolvedValueOnce({
        id: 'PO_1',
        withdrawId: 'WD_1',
        status: PayoutStatus.CONFIRMED,
      });
    mockPrisma.auditLogEvent.findUnique.mockResolvedValue(null);
    mockWithdrawalService.findOne.mockResolvedValue({
      ...baseWithdrawal,
      status: WithdrawTransactionStatus.PAYOUT_PENDING,
    });
    mockWithdrawalService.updateStatus.mockResolvedValue({
      ...baseWithdrawal,
      status: WithdrawTransactionStatus.SUCCESS,
    });
    mockPayoutsService.updateStatus.mockResolvedValue({
      id: 'PO_1',
      status: PayoutStatus.CLEARED,
    });
    mockPrisma.auditLogEvent.create.mockResolvedValue({ id: 'LOG_REPAIR' });

    const result = await orchestrator.reCloseoutPayout('PO_1');

    expect(result.repairApplied).toBe(true);
    expect(result.updated_withdrawal_status).toBe(WithdrawTransactionStatus.SUCCESS);
    expect(result.updated_payout_status).toBe(PayoutStatus.CLEARED);
  });

  it('should return no-op result when re-closeout is repeated after success', async () => {
    mockPrisma.payout.findUnique.mockResolvedValue({
      id: 'PO_1',
      withdrawId: 'WD_1',
      status: PayoutStatus.CLEARED,
    });
    mockWithdrawalService.findOne.mockResolvedValue({
      ...baseWithdrawal,
      status: WithdrawTransactionStatus.SUCCESS,
    });

    const result = await orchestrator.reCloseoutPayout('PO_1');

    expect(result.repairApplied).toBe(false);
    expect(result.updated_withdrawal_status).toBe(WithdrawTransactionStatus.SUCCESS);
    expect(result.updated_payout_status).toBe(PayoutStatus.CLEARED);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('should re-run failed compensation from payout detail repair endpoint flow', async () => {
    mockPrisma.payout.findUnique.mockResolvedValue({
      id: 'PO_1',
      withdrawId: 'WD_1',
      status: PayoutStatus.FAILED,
    });
    mockWithdrawalService.findOne.mockResolvedValue({
      ...baseWithdrawal,
      status: WithdrawTransactionStatus.PAYOUT_PENDING,
    });
    mockPrisma.auditLogEvent.findUnique.mockResolvedValue(null);
    mockPrisma.withdrawTransaction.findUnique.mockResolvedValue({
      ...baseWithdrawal,
      status: WithdrawTransactionStatus.PAYOUT_PENDING,
    });
    mockWithdrawalService.updateStatus.mockResolvedValue({
      ...baseWithdrawal,
      status: WithdrawTransactionStatus.FAILED,
    });
    mockPrisma.auditLogEvent.create.mockResolvedValue({ id: 'LOG_RECOMP_FAIL' });

    const result = await orchestrator.reCompensatePayout('PO_1');

    expect(result.repairApplied).toBe(true);
    expect(result.updated_withdrawal_status).toBe(WithdrawTransactionStatus.FAILED);
    expect(result.updated_payout_status).toBe(PayoutStatus.FAILED);
  });

  it('should re-run returned compensation from payout detail repair endpoint flow', async () => {
    mockPrisma.payout.findUnique.mockResolvedValue({
      id: 'PO_1',
      withdrawId: 'WD_1',
      status: PayoutStatus.RETURNED,
    });
    mockWithdrawalService.findOne.mockResolvedValue({
      ...baseWithdrawal,
      status: WithdrawTransactionStatus.SUCCESS,
    });
    mockPrisma.auditLogEvent.findUnique.mockResolvedValue(null);
    mockPrisma.withdrawTransaction.findUnique.mockResolvedValue({
      ...baseWithdrawal,
      status: WithdrawTransactionStatus.SUCCESS,
    });
    mockWithdrawalService.updateStatus.mockResolvedValue({
      ...baseWithdrawal,
      status: WithdrawTransactionStatus.RETURNED,
    });
    mockPrisma.auditLogEvent.create.mockResolvedValue({ id: 'LOG_RECOMP_RET' });

    const result = await orchestrator.reCompensatePayout('PO_1');

    expect(result.repairApplied).toBe(true);
    expect(result.updated_withdrawal_status).toBe(WithdrawTransactionStatus.RETURNED);
    expect(result.updated_payout_status).toBe(PayoutStatus.RETURNED);
  });

  it('should return no-op result when re-compensate is repeated after compensation is fully settled', async () => {
    mockPrisma.payout.findUnique.mockResolvedValue({
      id: 'PO_1',
      withdrawId: 'WD_1',
      status: PayoutStatus.FAILED,
    });
    mockWithdrawalService.findOne.mockResolvedValue({
      ...baseWithdrawal,
      status: WithdrawTransactionStatus.FAILED,
    });
    mockPrisma.journal.findMany
      .mockResolvedValueOnce([{ id: 'JO_1' }, { id: 'JO_2' }])
      .mockResolvedValueOnce([
        { reversalOfJournalId: 'JO_1' },
        { reversalOfJournalId: 'JO_2' },
      ]);
    mockPrisma.clearing.findMany.mockResolvedValue([
      { clearingStatus: 'CANCELLED' },
    ]);

    const result = await orchestrator.reCompensatePayout('PO_1');

    expect(result.repairApplied).toBe(false);
    expect(result.updated_withdrawal_status).toBe(WithdrawTransactionStatus.FAILED);
    expect(result.updated_payout_status).toBe(PayoutStatus.FAILED);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('should skip repeated returned event when marker exists and compensation is already settled', async () => {
    mockPrisma.payout.findUnique.mockResolvedValue({
      id: 'PO_1',
      withdrawId: 'WD_1',
      status: PayoutStatus.RETURNED,
    });
    mockPrisma.auditLogEvent.findUnique.mockResolvedValue({
      id: 'LOG_EXIST',
    });
    mockAuditLogsService.hasIdempotencyKey.mockResolvedValueOnce(true);
    mockWithdrawalService.findOne.mockResolvedValue({
      ...baseWithdrawal,
      status: WithdrawTransactionStatus.RETURNED,
    });
    mockPrisma.journal.findMany
      .mockResolvedValueOnce([{ id: 'JO_1' }])
      .mockResolvedValueOnce([{ reversalOfJournalId: 'JO_1' }]);
    mockPrisma.clearing.findMany.mockResolvedValue([
      { clearingStatus: 'CANCELLED' },
    ]);

    const result = await orchestrator.onPayoutReturned({
      withdrawId: 'WD_1',
      payoutId: 'PO_1',
      status: PayoutStatus.RETURNED,
    });

    expect(result).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
