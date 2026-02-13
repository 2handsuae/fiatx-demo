import { Test, TestingModule } from '@nestjs/testing';

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

import { WithdrawWorkflowOrchestrator } from './withdraw-workflow.orchestrator';
import { WithdrawTransactionsService } from '../modules/trading/withdraw-transactions/withdraw-transactions.service';
import { PayoutsService } from '../modules/asset-treasury/payouts/payouts.service';
import { JournalsService } from '../modules/accounting/journals/journals.service';
import { ClearingsService } from '../modules/clearing-settle/clearing/clearings.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PayoutEvents } from '../modules/asset-treasury/payouts/constants/payout-events.constant';
import { WithdrawTransactionStatus } from '../modules/trading/withdraw-transactions/dto/withdraw-transaction.dto';
import { PayoutStatus } from '../modules/asset-treasury/payouts/dto/payout.dto';
import { Prisma } from '@prisma/client';

describe('WithdrawWorkflowOrchestrator', () => {
  let orchestrator: WithdrawWorkflowOrchestrator;
  let withdrawalService: WithdrawTransactionsService;
  let payoutsService: PayoutsService;
  let journalsService: JournalsService;
  let prisma: PrismaService;

  const mockPrisma: any = {
    $transaction: jest.fn((cb) => cb(mockPrisma)),
    withdrawAuditLog: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockWithdrawalService = {
    findOne: jest.fn(),
    updateStatus: jest.fn(),
  };

  const mockPayoutsService = {
    updateStatus: jest.fn(),
  };

  const mockJournalsService = {
    triggerEvent: jest.fn(),
  };

  const mockClearingsService = {
    triggerClearing: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WithdrawWorkflowOrchestrator,
        { provide: WithdrawTransactionsService, useValue: mockWithdrawalService },
        { provide: PayoutsService, useValue: mockPayoutsService },
        { provide: JournalsService, useValue: mockJournalsService },
        { provide: ClearingsService, useValue: mockClearingsService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    orchestrator = module.get<WithdrawWorkflowOrchestrator>(WithdrawWorkflowOrchestrator);
    withdrawalService = module.get<WithdrawTransactionsService>(WithdrawTransactionsService);
    payoutsService = module.get<PayoutsService>(PayoutsService);
    journalsService = module.get<JournalsService>(JournalsService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('onPayoutConfirmed (Atomic Success Path)', () => {
    it('should execute the atomic success path correctly', async () => {
      const withdrawId = 'WDR-123';
      const payoutId = 'PO-456';
      const mockWithdrawal = {
        id: withdrawId,
        status: WithdrawTransactionStatus.PAYOUT_PENDING,
        ownerType: 'CUSTOMER',
        type: 'crypto',
        amount: new Prisma.Decimal(100),
        netAmount: new Prisma.Decimal(99),
        feeAmount: new Prisma.Decimal(1),
      };

      mockPrisma.withdrawAuditLog.findFirst.mockResolvedValue(null); // Idempotency check pass
      mockWithdrawalService.findOne.mockResolvedValue(mockWithdrawal);
      mockWithdrawalService.updateStatus.mockResolvedValue({ ...mockWithdrawal, status: WithdrawTransactionStatus.SUCCESS });
      mockJournalsService.triggerEvent.mockResolvedValue({ id: 'JE-789' });
      mockPayoutsService.updateStatus.mockResolvedValue({ id: payoutId, status: PayoutStatus.CLEAR });
      mockPrisma.withdrawAuditLog.create.mockResolvedValue({ id: 'LOG-999' });

      const result = await orchestrator.onPayoutConfirmed({ withdrawId, payoutId });

      // Verify sequence and transaction usage
      expect(prisma.$transaction).toHaveBeenCalled();
      
      // 1. Withdrawal updated to SUCCESS
      expect(mockWithdrawalService.updateStatus).toHaveBeenCalledWith(
        withdrawId,
        expect.objectContaining({ action: 'success' }),
        mockPrisma
      );

      // 2. Accounting triggered for SUCCESS
      expect(mockJournalsService.triggerEvent).toHaveBeenCalledWith(
        expect.objectContaining({ toStatus: WithdrawTransactionStatus.SUCCESS }),
        mockPrisma
      );

      // 3. Payout updated to CLEAR
      expect(mockPayoutsService.updateStatus).toHaveBeenCalledWith(
        payoutId,
        expect.objectContaining({ action: 'CLEAR' }),
        'SYSTEM',
        mockPrisma
      );

      // 4. Final log created
      expect(mockPrisma.withdrawAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            newStatus: WithdrawTransactionStatus.SUCCESS,
            reason: expect.stringContaining('SUCCESS_PATH_ATOMIC'),
          }),
        })
      );

      expect(result?.updated_withdrawal_status).toBe(WithdrawTransactionStatus.SUCCESS);
      expect(result?.updated_payout_status).toBe(PayoutStatus.CLEAR);
    });

    it('should be idempotent and skip if already processed', async () => {
      const withdrawId = 'WDR-123';
      const payoutId = 'PO-456';

      mockPrisma.withdrawAuditLog.findFirst.mockResolvedValue({ id: 'LOG-EXISTING' });

      const result = await orchestrator.onPayoutConfirmed({ withdrawId, payoutId });

      expect(result).toBeNull();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should skip if withdrawal is not in PAYOUT_PENDING', async () => {
      const withdrawId = 'WDR-123';
      const payoutId = 'PO-456';
      const mockWithdrawal = {
        id: withdrawId,
        status: WithdrawTransactionStatus.CREATED,
      };

      mockPrisma.withdrawAuditLog.findFirst.mockResolvedValue(null);
      mockWithdrawalService.findOne.mockResolvedValue(mockWithdrawal);

      const result = await orchestrator.onPayoutConfirmed({ withdrawId, payoutId });

      expect(result).toBeNull();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
