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
import { WithdrawEvents } from './constants/withdraw-events.constant';

describe('WithdrawTransactionsService', () => {
  let service: WithdrawTransactionsService;
  let prisma: any;
  let journalsService: any;
  let transactionComplianceService: any;
  let eventEmitter: any;

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
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    jest.clearAllMocks();
    mockTx.withdrawTransaction.findUnique.mockReset();
    mockTx.withdrawTransaction.update.mockReset();
    mockTx.withdrawAuditLog.create.mockReset();
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
    mockTx.withdrawTransaction.findUnique.mockResolvedValue({
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
    mockTx.withdrawTransaction.findUnique
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        id: 'wd-2',
        status: WithdrawTransactionStatus.PENDING_COMPLIANCE,
        type: 'crypto',
        travelRuleRequired: false,
        travelRuleStatus: 'NOT_REQUIRED',
        complianceStatus: 'CLEAR',
        preKytStatus: 'PASS',
        kytStatus: 'PASS',
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

  it('should not emit domain events when external tx is provided', async () => {
    mockTx.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-3',
      status: WithdrawTransactionStatus.PENDING_COMPLIANCE,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-1',
      type: 'crypto',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
      withdrawNo: 'WD0003',
      complianceStatus: 'CLEAR',
      preKytStatus: 'PASS',
      kytStatus: 'PASS',
      travelRuleRequired: false,
      travelRuleStatus: 'NOT_REQUIRED',
      statusHistory: '[]',
      approvedAt: null,
      payoutRequestedAt: null,
      completedAt: null,
    });
    mockTx.withdrawTransaction.update.mockResolvedValue({
      id: 'wd-3',
      status: WithdrawTransactionStatus.PAYOUT_PENDING,
      type: 'crypto',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
      withdrawNo: 'WD0003',
    });
    mockTx.withdrawAuditLog.create.mockResolvedValue({ id: 'audit-3' });

    const result = await service.updateStatus(
      'wd-3',
      { action: WithdrawTransactionAction.APPROVE },
      mockTx,
    );

    expect(result.status).toBe(WithdrawTransactionStatus.PAYOUT_PENDING);
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('should emit fiat approval event based on asset.type', async () => {
    mockTx.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-4',
      status: WithdrawTransactionStatus.PENDING_COMPLIANCE,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-fiat',
      amount: new Prisma.Decimal(20),
      netAmount: new Prisma.Decimal(20),
      feeAmount: new Prisma.Decimal(0),
      withdrawNo: 'WD0004',
      complianceStatus: 'CLEAR',
      preKytStatus: 'PASS',
      kytStatus: 'PASS',
      travelRuleRequired: false,
      travelRuleStatus: 'NOT_REQUIRED',
      statusHistory: '[]',
      approvedAt: null,
      payoutRequestedAt: null,
      completedAt: null,
      asset: {
        type: 'FIAT',
      },
    });
    mockTx.withdrawTransaction.update.mockResolvedValue({
      id: 'wd-4',
      status: WithdrawTransactionStatus.PAYOUT_PENDING,
    });
    mockTx.withdrawAuditLog.create.mockResolvedValue({ id: 'audit-4' });

    const result = await service.updateStatus('wd-4', {
      action: WithdrawTransactionAction.APPROVE,
    });

    expect(result.status).toBe(WithdrawTransactionStatus.PAYOUT_PENDING);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WithdrawEvents.EVT_WITHDRAWAL_APPROVED__FIAT,
      { withdrawId: 'wd-4' },
    );
  });
});
