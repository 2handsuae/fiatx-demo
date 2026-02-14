import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { JournalsService } from '../../accounting/journals/journals.service';
import {
  WithdrawTransactionAction,
  WithdrawTransactionStatus,
} from './dto/withdraw-transaction.dto';
import { TransactionComplianceService } from '../../risk-engine/transaction-compliance/transaction-compliance.service';

describe('WithdrawTransactionsService', () => {
  let service: WithdrawTransactionsService;
  let prisma: any;
  let journalsService: any;
  let transactionComplianceService: any;

  const mockTx: any = {
    withdrawTransaction: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    withdrawAuditLog: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WithdrawTransactionsService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn((cb: any) => cb(mockTx)),
            asset: { findUnique: jest.fn() },
            customerMain: { findUnique: jest.fn() },
            withdrawTransaction: { findUnique: jest.fn() },
          },
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
        {
          provide: JournalsService,
          useValue: {
            getCustomerLiabilityBalance: jest.fn(),
            createJournal: jest.fn(),
          },
        },
        {
          provide: TransactionComplianceService,
          useValue: {
            ensureWithdrawComplianceCases: jest.fn(),
            getCaseSummaries: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WithdrawTransactionsService>(WithdrawTransactionsService);
    prisma = module.get<PrismaService>(PrismaService);
    journalsService = module.get<JournalsService>(JournalsService);
    transactionComplianceService = module.get<TransactionComplianceService>(
      TransactionComplianceService,
    );

    jest.clearAllMocks();
    transactionComplianceService.getCaseSummaries.mockResolvedValue({
      kytCase: null,
      travelRuleCase: null,
    });
  });

  it('should block create when available balance is insufficient', async () => {
    prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', type: 'CRYPTO' });
    prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001' });
    journalsService.getCustomerLiabilityBalance.mockResolvedValue({
      availableBalance: new Prisma.Decimal(10),
    });

    await expect(
      service.create(
        {
          assetId: 'asset-1',
          amount: 100,
        } as any,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(mockTx.withdrawTransaction.create).not.toHaveBeenCalled();
  });

  it('should block approve when compliance is not cleared', async () => {
    prisma.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-1',
      status: 'PENDING_COMPLIANCE',
      complianceStatus: 'PENDING',
      preKytStatus: 'PENDING',
      kytStatus: 'PENDING',
      travelRuleRequired: false,
      travelRuleStatus: 'NOT_REQUIRED',
      statusHistory: '[]',
    });

    await expect(
      service.updateStatus('wd-1', {
        action: WithdrawTransactionAction.APPROVE,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should trigger compliance case setup when moving to PENDING_COMPLIANCE', async () => {
    prisma.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-2',
      status: WithdrawTransactionStatus.CREATED,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-1',
      type: 'crypto',
      amount: new Prisma.Decimal(100),
      netAmount: new Prisma.Decimal(100),
      feeAmount: new Prisma.Decimal(0),
      withdrawNo: 'WD0002',
      travelRuleRequired: false,
      statusHistory: '[]',
      auditLogs: [],
      payout: null,
      customer: null,
      asset: null,
    });

    mockTx.withdrawTransaction.update.mockResolvedValue({
      id: 'wd-2',
      status: WithdrawTransactionStatus.PENDING_COMPLIANCE,
      type: 'crypto',
      travelRuleRequired: false,
      travelRuleStatus: 'NOT_REQUIRED',
      complianceStatus: 'CLEAR',
      preKytStatus: 'PASS',
      kytStatus: 'PASS',
    });
    mockTx.withdrawAuditLog.create.mockResolvedValue({ id: 'audit-2' });
    mockTx.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-2',
      status: WithdrawTransactionStatus.PENDING_COMPLIANCE,
      type: 'crypto',
      travelRuleRequired: false,
      travelRuleStatus: 'NOT_REQUIRED',
      complianceStatus: 'CLEAR',
      preKytStatus: 'PASS',
      kytStatus: 'PASS',
    });
    transactionComplianceService.ensureWithdrawComplianceCases.mockResolvedValue(
      {},
    );

    const result = await service.updateStatus('wd-2', {
      action: WithdrawTransactionAction.CHECK,
    });

    expect(
      transactionComplianceService.ensureWithdrawComplianceCases,
    ).toHaveBeenCalledWith('wd-2', mockTx);
    expect(result.status).toBe(WithdrawTransactionStatus.PENDING_COMPLIANCE);
  });
});
