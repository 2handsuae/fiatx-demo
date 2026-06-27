import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { WithdrawWorkflowService } from './withdraw-workflow.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  WithdrawTransactionAction,
  WithdrawTransactionStatus,
} from './dto/withdraw-transaction.dto';
import { WithdrawQuoteService } from '../withdrawal-fee-level/withdraw-quote.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { InternalTransferService } from '../../funds-layer/domain/internal-transfer.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';

describe('WithdrawTransactionsService', () => {
  let service: WithdrawTransactionsService;
  // create+lock was relocated into WithdrawWorkflowService.createWithdrawal; the
  // create tests below drive it through the workflow (real domain delegate +
  // shared mocks), while updateStatus/findAll/findOne stay on the domain service.
  let workflow: WithdrawWorkflowService;
  let prisma: any;
  let eventEmitter: any;
  let withdrawQuoteService: any;
  let accountingService: any;
  let auditLogsService: any;
  let module: TestingModule;

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
    module = await Test.createTestingModule({
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
          provide: WithdrawQuoteService,
          useValue: {
            getActiveQuoteOrThrow: jest.fn(),
            consumeQuote: jest.fn(),
            cancelQuote: jest.fn(),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            recordByActor: jest.fn().mockResolvedValue({}),
            recordSystem: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: AccountingService,
          useValue: {
            resolveTbAccountId: jest.fn().mockResolvedValue(BigInt(1)),
            executePendingTransfer: jest.fn().mockResolvedValue({ tbTransferId: BigInt(1) }),
            executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: BigInt(2) }),
            voidPendingTransferBestEffort: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: InternalTransferService,
          useValue: {
            findFundsOrderBySource: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<WithdrawTransactionsService>(WithdrawTransactionsService);
    prisma = module.get<PrismaService>(PrismaService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
    withdrawQuoteService = module.get<WithdrawQuoteService>(WithdrawQuoteService);
    accountingService = module.get<AccountingService>(AccountingService);
    auditLogsService = module.get<AuditLogsService>(AuditLogsService);

    // The create+lock orchestration moved into the workflow. Wire it with the
    // real domain service (for insertRecord/setPendingIds → tx.withdrawTransaction)
    // plus the same shared mocks; downstream deps are inert stubs (createWithdrawal
    // does not touch them).
    workflow = new WithdrawWorkflowService(
      prisma,
      eventEmitter as any,
      service,
      withdrawQuoteService as any,
      auditLogsService as any,
      accountingService as any,
      {} as any, // payoutsService
      {} as any, // approvalsService
      {} as any, // binanceRateProvider
      {} as any, // fundsFlowService
      {} as any, // systemWalletResolver
      {} as any, // tbEvidenceService
    );

    jest.clearAllMocks();
    mockTx.withdrawTransaction.findUnique.mockReset();
    mockTx.withdrawTransaction.update.mockReset();
    mockTx.auditLogEvent.findUnique.mockReset();
    mockTx.auditLogEvent.create.mockReset();
    mockTx.auditLogEvent.findUnique.mockResolvedValue(null);
    prisma.auditLogEvent.findMany.mockResolvedValue([]);
    withdrawQuoteService.getActiveQuoteOrThrow.mockResolvedValue({
      id: 'wq-1',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(100),
      totalsJson: JSON.stringify({}),
    });
    withdrawQuoteService.consumeQuote.mockResolvedValue({
      id: 'wq-1',
      status: 'USED',
    });
  });

  // V2 balance check removed — migrated to TigerBeetle
  // Balance guard test removed; re-add when TigerBeetle adapter is wired

  it('should create withdraw in PENDING_COMPLIANCE with CRYPTO compliance statuses', async () => {
    prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', type: 'CRYPTO' });
    prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001', onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE' });
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

    await workflow.createWithdrawal(
      {
        assetId: 'asset-1',
        amount: 100,
        quoteId: 'wq-1',
      } as any,
      'user-1',
    );

    expect(mockTx.withdrawTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WithdrawTransactionStatus.CREATED,
          preKytStatus: 'PENDING',
          kytStatus: '',
          travelRuleStatus: 'PENDING',
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

  it('should create FIAT withdraw with empty compliance statuses', async () => {
    prisma.asset.findUnique.mockResolvedValue({ id: 'asset-fiat-1', type: 'FIAT' });
    prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001', onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE' });
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

    withdrawQuoteService.getActiveQuoteOrThrow.mockResolvedValue({
      id: 'wq-2',
      assetId: 'asset-fiat-1',
      amount: new Prisma.Decimal(100),
      totalsJson: JSON.stringify({}),
    });
    withdrawQuoteService.consumeQuote.mockResolvedValue({
      id: 'wq-2',
      status: 'USED',
    });

    await workflow.createWithdrawal(
      {
        assetId: 'asset-fiat-1',
        amount: 100,
        quoteId: 'wq-2',
      } as any,
      'user-1',
    );

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
    prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001', onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE' });

    await expect(
      workflow.createWithdrawal(
        {
          assetId: 'asset-1',
          amount: 100,
        } as any,
        'user-1',
      ),
    ).rejects.toThrow('quoteId is required for withdrawal');
  });

  // Legacy extreme volatility check removed — no longer applies.

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

    expect(result.status).toBe(WithdrawTransactionStatus.PENDING_COMPLIANCE);
  });

  it('should transition crypto approval via external tx', async () => {
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
  });

  it('should transition fiat approval based on asset.type', async () => {
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
        result: 'SUCCESS',
      },
    ]);

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
    // raw statuses preserved from DB
    expect(result.preKytStatus).toBe('PASS');
    expect(result.kytStatus).toBe('PENDING');
    expect(result.travelRuleStatus).toBe('ACCEPTED');
  });

  it('findOne attaches fundsOrders from the 资金单 lookup (sourceType WITHDRAW)', async () => {
    const internalTransferService = module.get<InternalTransferService>(InternalTransferService);
    prisma.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-funds-1',
      withdrawNo: 'WD9001',
      status: WithdrawTransactionStatus.SUCCESS,
      asset: { type: 'CRYPTO' },
      customer: null,
      payout: null,
    });
    prisma.auditLogEvent.findMany.mockResolvedValue([]);
    (internalTransferService.findFundsOrderBySource as jest.Mock).mockResolvedValue([
      { id: 'itx-1', internalTxNo: 'ITX-001', type: 'WITHDRAW', status: 'SUCCESS', legs: [] },
    ]);

    const result = await service.findOne('wd-funds-1');

    expect(internalTransferService.findFundsOrderBySource).toHaveBeenCalledWith(
      'WITHDRAW',
      'wd-funds-1',
    );
    expect(result.fundsOrders).toHaveLength(1);
    expect(result.fundsOrders[0].internalTxNo).toBe('ITX-001');
  });

  describe('approval-gate transitions', () => {
    const baseItem = {
      id: 'w1',
      withdrawNo: 'WD-1',
      ownerType: 'CUSTOMER',
      ownerId: 'c1',
      asset: { type: 'CRYPTO' },
      statusHistory: '[]',
      approvedAt: null,
      payoutRequestedAt: null,
      completedAt: null,
    };

    function arrangeItem(status: WithdrawTransactionStatus) {
      mockTx.withdrawTransaction.findUnique.mockResolvedValue({ ...baseItem, status });
      mockTx.withdrawTransaction.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...baseItem, status: data.status }),
      );
    }

    it('CREATED → REQUIRE_APPROVAL → PENDING_APPROVAL', async () => {
      arrangeItem(WithdrawTransactionStatus.CREATED);
      const res = await service.updateStatus('w1', { action: WithdrawTransactionAction.REQUIRE_APPROVAL }, { source: 'WORKFLOW' });
      expect(res.status).toBe(WithdrawTransactionStatus.PENDING_APPROVAL);
    });

    it('PENDING_APPROVAL → GATE_APPROVE → PENDING_COMPLIANCE', async () => {
      arrangeItem(WithdrawTransactionStatus.PENDING_APPROVAL);
      const res = await service.updateStatus('w1', { action: WithdrawTransactionAction.GATE_APPROVE }, { source: 'WORKFLOW' });
      expect(res.status).toBe(WithdrawTransactionStatus.PENDING_COMPLIANCE);
    });

    it('PENDING_APPROVAL → REJECT → REJECTED', async () => {
      arrangeItem(WithdrawTransactionStatus.PENDING_APPROVAL);
      const res = await service.updateStatus('w1', { action: WithdrawTransactionAction.REJECT }, { source: 'WORKFLOW' });
      expect(res.status).toBe(WithdrawTransactionStatus.REJECTED);
    });

    it('rejects GATE_APPROVE from CREATED', async () => {
      arrangeItem(WithdrawTransactionStatus.CREATED);
      await expect(
        service.updateStatus('w1', { action: WithdrawTransactionAction.GATE_APPROVE }, { source: 'WORKFLOW' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  it('should transition to FAILED when payout fails', async () => {
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
  });

  describe('real-time 1:1 TB accounting on create()', () => {
    function arrangeCreateAsset(assetType: string) {
      prisma.asset.findUnique.mockResolvedValue({
        id: 'asset-tb-1',
        type: assetType,
        currency: 'AED',
        decimals: 8,
      });
      prisma.customerMain.findUnique.mockResolvedValue({
        customerNo: 'C100',
        onboardingStatus: 'APPROVED',
        adminStatus: 'ACTIVE',
      });
      mockTx.withdrawTransaction.create.mockResolvedValue({
        id: 'wd-tb-1',
        ownerType: 'CUSTOMER',
        ownerId: 'user-tb',
        assetId: 'asset-tb-1',
        amount: new Prisma.Decimal(110),
        netAmount: new Prisma.Decimal(100),
        feeAmount: new Prisma.Decimal(10),
        withdrawNo: 'WD9001',
        fromWalletId: null,
        fromWalletNo: null,
        toWalletId: null,
        toWalletNo: null,
        traceId: 'trace-tb-1',
      });
      mockTx.withdrawTransaction.update.mockResolvedValue({});
      mockTx.auditLogEvent.create.mockResolvedValue({ id: 'audit-tb' });
      withdrawQuoteService.getActiveQuoteOrThrow.mockResolvedValue({
        id: 'wq-tb',
        assetId: 'asset-tb-1',
        amount: new Prisma.Decimal(110),
        totalsJson: JSON.stringify({ AED: '10' }),
      });
      withdrawQuoteService.consumeQuote.mockResolvedValue({ id: 'wq-tb', status: 'USED' });
    }

    it('net pending uses CLIENT_ASSET as credit target with WITHDRAW_NET_PENDING code (crypto)', async () => {
      arrangeCreateAsset('CRYPTO');
      const accountingService = module.get<AccountingService>(AccountingService);

      await workflow.createWithdrawal({ assetId: 'asset-tb-1', amount: 110, quoteId: 'wq-tb' } as any, 'user-tb');

      const calls = (accountingService.executePendingTransfer as jest.Mock).mock.calls;
      const netCall = calls.find((c: any[]) => c[0].evidence.eventCode === 'WITHDRAW_LOCK_NET');
      expect(netCall).toBeDefined();
      expect(netCall[0].code).toBe(TB_TRANSFER_CODES.WITHDRAW_NET_PENDING);
      expect(netCall[0].evidence.creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]);
    });

    it('fee pending uses CLIENT_ASSET as credit target with WITHDRAW_FEE_PENDING code (crypto)', async () => {
      arrangeCreateAsset('CRYPTO');
      const accountingService = module.get<AccountingService>(AccountingService);

      await workflow.createWithdrawal({ assetId: 'asset-tb-1', amount: 110, quoteId: 'wq-tb' } as any, 'user-tb');

      const calls = (accountingService.executePendingTransfer as jest.Mock).mock.calls;
      const feeCall = calls.find((c: any[]) => c[0].evidence.eventCode === 'WITHDRAW_LOCK_FEE');
      expect(feeCall).toBeDefined();
      expect(feeCall[0].code).toBe(TB_TRANSFER_CODES.WITHDRAW_FEE_PENDING);
      expect(feeCall[0].evidence.creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]);
    });

    it('net and fee pending both use CLIENT_ASSET (fiat — no branch)', async () => {
      arrangeCreateAsset('FIAT');
      const accountingService = module.get<AccountingService>(AccountingService);

      await workflow.createWithdrawal({ assetId: 'asset-tb-1', amount: 110, quoteId: 'wq-tb' } as any, 'user-tb');

      const calls = (accountingService.executePendingTransfer as jest.Mock).mock.calls;
      for (const call of calls) {
        expect(call[0].evidence.creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]);
      }
    });
  });
});
