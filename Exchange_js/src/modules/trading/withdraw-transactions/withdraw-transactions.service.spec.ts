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
import { PricingCenterService } from '../pricing-center/pricing-center.service';

describe('WithdrawTransactionsService', () => {
  let service: WithdrawTransactionsService;
  let prisma: any;
  let journalsService: any;
  let transactionComplianceService: any;
  let eventEmitter: any;
  let pricingCenterService: any;

  const mockTx: any = {
    withdrawTransaction: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    auditLogEvent: {
      findUnique: jest.fn(),
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
        auditLogEvent: {
          findUnique: jest.fn(),
          create: jest.fn(),
          findMany: jest.fn(),
        },
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
            ensureWithdrawPreKytCaseOnCreate: jest.fn(),
            initializeWithdrawFinalDecisionRecord: jest.fn(),
            getTransactionCaseAggregate: jest.fn(),
            normalizeKytLifecycleStatus: jest.fn((status?: string | null, options?: { allowEmpty?: boolean }) => {
              const normalized = String(status || '').trim().toUpperCase();
              if (!normalized) return options?.allowEmpty ? '' : 'CREATED';
              if (normalized === 'CREATED') return 'CREATED';
              if (['RECEIVED', 'SENT', 'PENDING'].includes(normalized)) return 'RECEIVED';
              return 'FINAL';
            }),
            normalizeTravelRuleLifecycleStatus: jest.fn((
              status?: string | null,
              required?: boolean,
              options?: { allowEmpty?: boolean },
            ) => {
              const normalized = String(status || '').trim().toUpperCase();
              if (!normalized) return options?.allowEmpty ? '' : required ? 'CREATED' : '';
              if (normalized === 'CREATED') return 'CREATED';
              if (['RECEIVED', 'SENT', 'PENDING'].includes(normalized)) return 'RECEIVED';
              return 'FINAL';
            }),
          },
        },
        {
          provide: PricingCenterService,
          useValue: {
            resolveOwnerNo: jest.fn(),
            assertWithdrawExtremeVolatilityNotBlocked: jest.fn(),
            getActiveWithdrawQuoteOrThrow: jest.fn(),
            consumeWithdrawQuoteForWithdraw: jest.fn(),
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
    pricingCenterService = module.get<PricingCenterService>(PricingCenterService);

    jest.clearAllMocks();
    mockTx.withdrawTransaction.findUnique.mockReset();
    mockTx.withdrawTransaction.update.mockReset();
    mockTx.auditLogEvent.findUnique.mockReset();
    mockTx.auditLogEvent.create.mockReset();
    mockTx.auditLogEvent.findUnique.mockResolvedValue(null);
    prisma.auditLogEvent.findMany.mockResolvedValue([]);
    transactionComplianceService.getTransactionCaseAggregate.mockResolvedValue({
      preKytCase: null,
      mainKytCase: null,
      travelRuleCase: null,
      derivedComplianceStatus: 'PENDING',
    });
    transactionComplianceService.initializeWithdrawFinalDecisionRecord.mockResolvedValue(
      {},
    );
    pricingCenterService.resolveOwnerNo.mockResolvedValue('C001');
    pricingCenterService.assertWithdrawExtremeVolatilityNotBlocked.mockResolvedValue(
      undefined,
    );
    pricingCenterService.getActiveWithdrawQuoteOrThrow.mockResolvedValue({
      id: 'wq-1',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(100),
      totalsJson: JSON.stringify({}),
    });
    pricingCenterService.consumeWithdrawQuoteForWithdraw.mockResolvedValue({
      id: 'wq-1',
      status: 'USED',
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

  it('should create withdraw in PENDING_COMPLIANCE and initialize final review on create', async () => {
    prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', type: 'CRYPTO' });
    prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001' });
    journalsService.getCustomerLiabilityBalance.mockResolvedValue({
      availableBalance: new Prisma.Decimal(1000),
    });
    mockTx.withdrawTransaction.create.mockResolvedValue({
      id: 'wd-create-1',
      ownerType: 'CUSTOMER',
      ownerId: 'user-1',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(100),
      netAmount: new Prisma.Decimal(100),
      feeAmount: new Prisma.Decimal(0),
      withdrawNo: 'WD1001',
      fromWalletId: null,
      fromWalletNo: null,
      toWalletId: null,
      toWalletNo: null,
    });
    mockTx.auditLogEvent.create.mockResolvedValue({ id: 'audit-create-1' });
    journalsService.createJournal.mockResolvedValue({ id: 'je-create-1' });
    transactionComplianceService.ensureWithdrawPreKytCaseOnCreate.mockResolvedValue(
      {},
    );

    await service.create(
      {
        assetId: 'asset-1',
        amount: 100,
        quoteId: 'wq-1',
      } as any,
      'user-1',
    );

    expect(
      transactionComplianceService.ensureWithdrawPreKytCaseOnCreate,
    ).toHaveBeenCalledWith('wd-create-1');
    expect(
      transactionComplianceService.initializeWithdrawFinalDecisionRecord,
    ).toHaveBeenCalledWith('wd-create-1');
    expect(mockTx.withdrawTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WithdrawTransactionStatus.PENDING_COMPLIANCE,
          preKytStatus: 'FINAL',
          kytStatus: '',
          travelRuleStatus: 'FINAL',
          complianceStatus: 'PENDING',
        }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        maxWait: 5000,
        timeout: 20000,
      }),
    );
  });

  it('should initialize only final review semantics on fiat create without response snapshots', async () => {
    prisma.asset.findUnique.mockResolvedValue({ id: 'asset-fiat-1', type: 'FIAT' });
    prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001' });
    journalsService.getCustomerLiabilityBalance.mockResolvedValue({
      availableBalance: new Prisma.Decimal(1000),
    });
    mockTx.withdrawTransaction.create.mockResolvedValue({
      id: 'wd-create-2',
      ownerType: 'CUSTOMER',
      ownerId: 'user-1',
      assetId: 'asset-fiat-1',
      amount: new Prisma.Decimal(100),
      netAmount: new Prisma.Decimal(100),
      feeAmount: new Prisma.Decimal(0),
      withdrawNo: 'WD1002',
      fromWalletId: null,
      fromWalletNo: null,
      toWalletId: null,
      toWalletNo: null,
    });
    mockTx.auditLogEvent.create.mockResolvedValue({ id: 'audit-create-2' });
    journalsService.createJournal.mockResolvedValue({ id: 'je-create-2' });
    transactionComplianceService.ensureWithdrawPreKytCaseOnCreate.mockResolvedValue(
      null,
    );

    pricingCenterService.getActiveWithdrawQuoteOrThrow.mockResolvedValue({
      id: 'wq-2',
      assetId: 'asset-fiat-1',
      amount: new Prisma.Decimal(100),
      totalsJson: JSON.stringify({}),
    });
    pricingCenterService.consumeWithdrawQuoteForWithdraw.mockResolvedValue({
      id: 'wq-2',
      status: 'USED',
    });

    await service.create(
      {
        assetId: 'asset-fiat-1',
        amount: 100,
        quoteId: 'wq-2',
      } as any,
      'user-1',
    );

    expect(
      transactionComplianceService.ensureWithdrawPreKytCaseOnCreate,
    ).toHaveBeenCalledWith('wd-create-2');
    expect(
      transactionComplianceService.initializeWithdrawFinalDecisionRecord,
    ).toHaveBeenCalledWith('wd-create-2');
    expect(mockTx.withdrawTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          preKytStatus: '',
          kytStatus: '',
          travelRuleRequired: false,
          travelRuleStatus: '',
        }),
      }),
    );
  });

  it('should reject create when quoteId is missing', async () => {
    prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', type: 'CRYPTO' });
    journalsService.getCustomerLiabilityBalance.mockResolvedValue({
      availableBalance: new Prisma.Decimal(1000),
    });

    await expect(
      service.create(
        {
          assetId: 'asset-1',
          amount: 100,
        } as any,
        'user-1',
      ),
    ).rejects.toThrow('quoteId is required for withdrawal');
  });

  it('should block create when extreme volatility restriction is enabled', async () => {
    prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', type: 'CRYPTO' });
    pricingCenterService.assertWithdrawExtremeVolatilityNotBlocked.mockRejectedValue(
      new BadRequestException({
        code: 'WITHDRAW_EXTREME_VOLATILITY_BLOCKED',
      }),
    );

    await expect(
      service.create(
        {
          assetId: 'asset-1',
          amount: 100,
          quoteId: 'wq-1',
        } as any,
        'user-1',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'WITHDRAW_EXTREME_VOLATILITY_BLOCKED',
      }),
    });

    expect(mockTx.withdrawTransaction.create).not.toHaveBeenCalled();
    expect(pricingCenterService.getActiveWithdrawQuoteOrThrow).not.toHaveBeenCalled();
  });

  it('should block admin approve because payout progression is workflow-driven', async () => {
    mockTx.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-1',
      status: 'PENDING_COMPLIANCE',
      statusHistory: '[]',
      asset: {
        type: 'CRYPTO',
      },
    });

    await expect(
      service.updateStatus(
        'wd-1',
        {
          action: WithdrawTransactionAction.APPROVE,
        },
        {
          source: 'ADMIN_API',
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorRole: 'ADMIN',
          sourcePlatform: 'ADMIN_API',
        },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'WITHDRAW_APPROVE_WORKFLOW_ONLY',
      }),
    });
  });

  it.each([
    WithdrawTransactionAction.SUCCESS,
    WithdrawTransactionAction.FAIL,
    WithdrawTransactionAction.RETURN,
  ])('should block admin direct terminal action %s', async (action) => {
    mockTx.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-terminal-1',
      status:
        action === WithdrawTransactionAction.RETURN
          ? WithdrawTransactionStatus.SUCCESS
          : WithdrawTransactionStatus.PAYOUT_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(50),
      netAmount: new Prisma.Decimal(50),
      feeAmount: new Prisma.Decimal(0),
      withdrawNo: 'WDTERM1',
      statusHistory: '[]',
      approvedAt: new Date(),
      payoutRequestedAt: new Date(),
      completedAt: null,
      asset: {
        type: 'CRYPTO',
      },
    });

    await expect(
      service.updateStatus(
        'wd-terminal-1',
        { action },
        {
          source: 'ADMIN_API',
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorRole: 'ADMIN',
          sourcePlatform: 'ADMIN_API',
        },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'WITHDRAW_TERMINAL_ACTION_SYSTEM_ONLY',
      }),
    });
  });

  it('should not auto-create compliance case when moving to PENDING_COMPLIANCE', async () => {
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
        statusHistory: '[]',
        auditLogs: [],
        payout: null,
        customer: null,
        asset: {
          type: 'CRYPTO',
        },
      })
      .mockResolvedValueOnce(null);

    mockTx.withdrawTransaction.update.mockResolvedValue({
      id: 'wd-2',
      status: WithdrawTransactionStatus.PENDING_COMPLIANCE,
      type: 'crypto',
      asset: {
        type: 'CRYPTO',
      },
    });
    mockTx.auditLogEvent.create.mockResolvedValue({ id: 'audit-2' });

    const result = await service.updateStatus('wd-2', {
      action: WithdrawTransactionAction.CHECK,
    });

    expect(
      transactionComplianceService.ensureWithdrawPreKytCaseOnCreate,
    ).not.toHaveBeenCalled();
    expect(result.status).toBe(WithdrawTransactionStatus.PENDING_COMPLIANCE);
  });

  it('should emit domain events when external tx is provided', async () => {
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
      statusHistory: '[]',
      approvedAt: null,
      payoutRequestedAt: null,
      completedAt: null,
      asset: {
        type: 'CRYPTO',
      },
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
    mockTx.auditLogEvent.create.mockResolvedValue({ id: 'audit-3' });

    const result = await service.updateStatus(
      'wd-3',
      { action: WithdrawTransactionAction.APPROVE },
      {
        source: 'WORKFLOW',
        actorType: 'SYSTEM',
        actorId: 'workflow-1',
        actorRole: 'SYSTEM',
        sourcePlatform: 'SYSTEM',
      },
      mockTx,
    );

    expect(result.status).toBe(WithdrawTransactionStatus.PAYOUT_PENDING);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WithdrawEvents.EVT_WITHDRAWAL_APPROVED__CRYPTO,
      { withdrawId: 'wd-3' },
    );
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
    mockTx.auditLogEvent.create.mockResolvedValue({ id: 'audit-4' });

    const result = await service.updateStatus(
      'wd-4',
      {
        action: WithdrawTransactionAction.APPROVE,
      },
      {
        source: 'WORKFLOW',
        actorType: 'SYSTEM',
        actorId: 'workflow-1',
        actorRole: 'SYSTEM',
        sourcePlatform: 'SYSTEM',
      },
    );

    expect(result.status).toBe(WithdrawTransactionStatus.PAYOUT_PENDING);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WithdrawEvents.EVT_WITHDRAWAL_APPROVED__FIAT,
      { withdrawId: 'wd-4' },
    );
  });

  it('should return derivedComplianceStatus in list payload', async () => {
    prisma.withdrawTransaction.findMany = jest.fn().mockResolvedValue([
      {
        id: 'wd-list-1',
        withdrawNo: 'WDLIST1',
        status: WithdrawTransactionStatus.UNDER_REVIEW,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        asset: { type: 'CRYPTO', code: 'BTC', network: 'BITCOIN' },
        customer: null,
      },
    ]);
    prisma.withdrawTransaction.count = jest.fn().mockResolvedValue(1);

    const result = await service.findAll({});

    expect(result.items[0]).toMatchObject({
      id: 'wd-list-1',
      derivedComplianceStatus: 'HOLD',
    });
  });

  it('should return canonical audit logs in findOne payload', async () => {
    prisma.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-detail-1',
      withdrawNo: 'WDDET1',
      status: WithdrawTransactionStatus.SUCCESS,
      preKytStatus: 'PASS',
      kytStatus: 'PENDING',
      travelRuleRequired: true,
      travelRuleStatus: 'ACCEPTED',
      asset: { type: 'CRYPTO', code: 'BTC', network: 'BITCOIN' },
      customer: null,
      payout: null,
    });
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'audit-1',
        action: 'WITHDRAW_PAYOUT_PENDING_TO_SUCCESS',
        statusFrom: 'PAYOUT_PENDING',
        statusTo: 'SUCCESS',
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        reason: 'closeout',
        occurredAt: '2026-03-28T10:00:00.000Z',
        module: 'orchestrators/withdraw-workflow',
        result: 'SUCCESS',
      },
    ]);
    transactionComplianceService.getTransactionCaseAggregate.mockResolvedValue({
      preKytCase: null,
      mainKytCase: null,
      travelRuleCase: null,
      derivedComplianceStatus: 'CLEAR',
    });

    const result = await service.findOne('wd-detail-1');

    expect(result.auditLogs).toEqual([
      expect.objectContaining({
        id: 'audit-1',
        action: 'WITHDRAW_PAYOUT_PENDING_TO_SUCCESS',
        oldStatus: 'PAYOUT_PENDING',
        newStatus: 'SUCCESS',
        operatorId: 'SYSTEM',
      }),
    ]);
    expect(result.derivedComplianceStatus).toBe('CLEAR');
    expect(result.preKytStatus).toBe('FINAL');
    expect(result.kytStatus).toBe('RECEIVED');
    expect(result.travelRuleStatus).toBe('FINAL');
  });

  it('should emit unified failed event when payout fails', async () => {
    mockTx.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-5',
      status: WithdrawTransactionStatus.PAYOUT_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-fiat',
      amount: new Prisma.Decimal(30),
      netAmount: new Prisma.Decimal(30),
      feeAmount: new Prisma.Decimal(0),
      withdrawNo: 'WD0005',
      statusHistory: '[]',
      approvedAt: new Date(),
      payoutRequestedAt: new Date(),
      completedAt: null,
      asset: {
        type: 'FIAT',
      },
    });
    mockTx.withdrawTransaction.update.mockResolvedValue({
      id: 'wd-5',
      status: WithdrawTransactionStatus.FAILED,
    });
    mockTx.auditLogEvent.create.mockResolvedValue({ id: 'audit-5' });

    const result = await service.updateStatus('wd-5', {
      action: WithdrawTransactionAction.FAIL,
    });

    expect(result.status).toBe(WithdrawTransactionStatus.FAILED);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WithdrawEvents.EVT_WITHDRAWAL_FAILED,
      { withdrawId: 'wd-5' },
    );
  });
});
