import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { WithdrawWorkflowOrchestrator } from './withdraw-workflow.orchestrator';
import { WithdrawTransactionsService } from '../modules/trading/withdraw-transactions/withdraw-transactions.service';
import { PayoutsService } from '../modules/asset-treasury/payouts/payouts.service';
import { JournalsService } from '../modules/accounting/journals/journals.service';
import { ClearingsService } from '../modules/clearing-settle/clearing/clearings.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { WithdrawTransactionStatus } from '../modules/trading/withdraw-transactions/dto/withdraw-transaction.dto';
import {
  PayoutStatus,
  PayoutType,
} from '../modules/asset-treasury/payouts/dto/payout.dto';

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

describe('WithdrawWorkflowOrchestrator', () => {
  let orchestrator: WithdrawWorkflowOrchestrator;
  let withdrawalService: any;
  let payoutsService: any;
  let journalsService: any;
  let clearingsService: any;
  let prisma: any;

  const mockPrisma: any = {
    $transaction: jest.fn((cb) => cb(mockPrisma)),
    withdrawAuditLog: {
      findFirst: jest.fn(),
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
  };

  const mockWithdrawalService = {
    findOne: jest.fn(),
    updateStatus: jest.fn(),
  };

  const mockPayoutsService = {
    create: jest.fn(),
    updateStatus: jest.fn(),
  };

  const mockJournalsService = {
    triggerEvent: jest.fn(),
  };

  const mockClearingsService = {
    triggerClearing: jest.fn(),
    updateStatusBySource: jest.fn(),
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
    fromWalletNo: 'WA-CBK-AED-NA',
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
        { provide: JournalsService, useValue: mockJournalsService },
        { provide: ClearingsService, useValue: mockClearingsService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    orchestrator = module.get<WithdrawWorkflowOrchestrator>(
      WithdrawWorkflowOrchestrator,
    );
    withdrawalService = module.get<WithdrawTransactionsService>(
      WithdrawTransactionsService,
    );
    payoutsService = module.get<PayoutsService>(PayoutsService);
    journalsService = module.get<JournalsService>(JournalsService);
    clearingsService = module.get<ClearingsService>(ClearingsService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should execute payout confirmed atomic path', async () => {
    mockPrisma.withdrawAuditLog.findFirst.mockResolvedValue(null);
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
    mockJournalsService.triggerEvent.mockResolvedValue({ id: 'JE_1' });
    mockPayoutsService.updateStatus.mockResolvedValue({
      id: 'PO_1',
      status: PayoutStatus.CLEAR,
    });
    mockPrisma.withdrawAuditLog.create.mockResolvedValue({ id: 'LOG_1' });

    const result = await orchestrator.onPayoutConfirmed({
      withdrawId: 'WD_1',
      payoutId: 'PO_1',
    });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(withdrawalService.updateStatus).toHaveBeenCalledWith(
      'WD_1',
      expect.objectContaining({ action: 'success' }),
      mockPrisma,
    );
    expect(payoutsService.updateStatus).toHaveBeenCalledWith(
      'PO_1',
      expect.objectContaining({ action: 'CLEAR' }),
      'SYSTEM',
      mockPrisma,
    );
    expect(result?.updated_withdrawal_status).toBe(
      WithdrawTransactionStatus.SUCCESS,
    );
    expect(result?.updated_payout_status).toBe(PayoutStatus.CLEAR);
  });

  it('should skip payout confirmed when marker exists', async () => {
    mockPrisma.withdrawAuditLog.findFirst.mockResolvedValue({
      id: 'LOG_EXIST',
    });

    const result = await orchestrator.onPayoutConfirmed({
      withdrawId: 'WD_1',
      payoutId: 'PO_1',
    });

    expect(result).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('should process approved event without second approve status transition', async () => {
    mockPrisma.withdrawAuditLog.findFirst.mockResolvedValue(null);
    mockWithdrawalService.findOne.mockResolvedValue(baseWithdrawal);
    mockPrisma.withdrawTransaction.findUnique.mockResolvedValue(baseWithdrawal);
    mockJournalsService.triggerEvent.mockResolvedValue({ id: 'JE_APR' });
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
    mockPrisma.withdrawAuditLog.create.mockResolvedValue({ id: 'LOG_APR' });

    const result = await orchestrator.onWithdrawalApprovedFiat({
      withdrawId: 'WD_1',
    });

    expect(clearingsService.triggerClearing).toHaveBeenCalled();
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
    mockPrisma.withdrawAuditLog.findFirst.mockResolvedValue(null);
    mockWithdrawalService.findOne.mockResolvedValue({
      ...baseWithdrawal,
      fromWalletId: null,
      fromWalletNo: null,
      asset: { type: 'FIAT', code: 'AED', network: null },
    });
    mockPrisma.withdrawTransaction.findUnique
      .mockResolvedValueOnce({
        ...baseWithdrawal,
        fromWalletId: null,
        fromWalletNo: null,
        asset: { type: 'FIAT', code: 'AED', network: null },
      })
      .mockResolvedValueOnce({
        ...baseWithdrawal,
        fromWalletId: 'WALLET_RESOLVED_1',
        fromWalletNo: 'WA-CBK-AED-NA',
        asset: { type: 'FIAT' },
      });
    mockPrisma.wallet.findFirst.mockResolvedValue({
      id: 'WALLET_RESOLVED_1',
      walletNo: 'WA-CBK-AED-NA',
      address: null,
      iban: 'AE00FIATX1234567890',
    });
    mockPrisma.withdrawTransaction.update
      .mockResolvedValueOnce({
        ...baseWithdrawal,
        fromWalletId: 'WALLET_RESOLVED_1',
        fromWalletNo: 'WA-CBK-AED-NA',
      })
      .mockResolvedValueOnce({
        ...baseWithdrawal,
        payoutId: 'PO_2',
        payoutNo: 'PO0002',
      });
    mockJournalsService.triggerEvent.mockResolvedValue({ id: 'JE_APR2' });
    mockPrisma.payout.findUnique.mockResolvedValue(null);
    mockPayoutsService.create.mockResolvedValue({
      id: 'PO_2',
      payoutNo: 'PO0002',
    });
    mockPrisma.withdrawAuditLog.create.mockResolvedValue({ id: 'LOG_APR2' });

    await orchestrator.onWithdrawalApprovedFiat({
      withdrawId: 'WD_1',
    });

    expect(mockPrisma.wallet.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          walletNo: 'WA-CBK-AED-NA',
          ownerType: 'CUSTOMER',
          assetId: 'AST_1',
        }),
      }),
    );
    expect(mockPrisma.withdrawTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromWalletId: 'WALLET_RESOLVED_1',
          fromWalletNo: 'WA-CBK-AED-NA',
        }),
      }),
    );
  });

  it('should use asset.type when deriving payout type suffix', async () => {
    mockPrisma.withdrawAuditLog.findFirst.mockResolvedValue(null);
    mockWithdrawalService.findOne.mockResolvedValue({
      ...baseWithdrawal,
      type: 'crypto',
      asset: { type: 'FIAT' },
    });
    mockPrisma.withdrawTransaction.findUnique.mockResolvedValue({
      ...baseWithdrawal,
      asset: { type: 'FIAT' },
    });
    mockJournalsService.triggerEvent.mockResolvedValue({ id: 'JE_ASSET' });
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
    mockPrisma.withdrawAuditLog.create.mockResolvedValue({ id: 'LOG_ASSET' });

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
    mockPrisma.withdrawAuditLog.findFirst.mockResolvedValue(null);
    mockWithdrawalService.findOne.mockResolvedValue(baseWithdrawal);
    mockWithdrawalService.updateStatus.mockResolvedValue({
      ...baseWithdrawal,
      status: WithdrawTransactionStatus.FAILED,
    });
    mockJournalsService.triggerEvent.mockResolvedValue([
      { id: 'REV_1' },
      { id: 'REV_2' },
    ]);
    mockClearingsService.updateStatusBySource.mockResolvedValue({ count: 1 });
    mockPrisma.withdrawAuditLog.create.mockResolvedValue({ id: 'LOG_FAIL' });

    const result = await orchestrator.onPayoutFailed({
      withdrawId: 'WD_1',
      payoutId: 'PO_1',
      status: PayoutStatus.FAILED,
    });

    expect(journalsService.triggerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'WITHDRAW',
        toStatus: WithdrawTransactionStatus.FAILED,
      }),
      mockPrisma,
    );
    expect(clearingsService.updateStatusBySource).toHaveBeenCalledWith(
      'WD_1',
      'CANCELLED',
      mockPrisma,
    );
    expect(result?.created_or_reversed_journal_entry_ids).toEqual([
      'REV_1',
      'REV_2',
    ]);
  });

  it('should skip repeated returned event when withdrawal is already RETURNED', async () => {
    mockPrisma.withdrawAuditLog.findFirst.mockResolvedValue(null);
    mockWithdrawalService.findOne.mockResolvedValue({
      ...baseWithdrawal,
      status: WithdrawTransactionStatus.RETURNED,
    });

    const result = await orchestrator.onPayoutReturned({
      withdrawId: 'WD_1',
      payoutId: 'PO_1',
      status: PayoutStatus.RETURNED,
    });

    expect(result).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
