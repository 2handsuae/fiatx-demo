import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { ApprovalsService } from '../../governance/approvals/approvals.service';

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
  let approvalsService: Record<string, jest.Mock>;
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
    approvalsService = {
      list: jest.fn().mockResolvedValue({ total: 0, items: [] }),
    };
    module = await Test.createTestingModule({
      providers: [
        WithdrawTransactionsService,
        {
          provide: ApprovalsService,
          useValue: approvalsService,
        },
        {
          provide: PrismaService,
      useValue: {
        $transaction: jest.fn((cb: any) => cb(mockTx)),
        asset: { findUnique: jest.fn() },
        customerMain: { findUnique: jest.fn() },
        withdrawTransaction: { findUnique: jest.fn() },
        withdrawalAddress: { findFirst: jest.fn() },
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
      {} as any, // fundsOrders
      {} as any, // approvalsService
      {} as any, // binanceRateProvider
      {} as any, // systemWalletResolver
      {} as any, // tbEvidenceService
      { evaluate: jest.fn(() => Promise.resolve({ grossAedValue: null, aedRate: null, rateFetchedAt: null, rateFetchFailed: false })) } as any, // limitGateService
      {} as any, // limitRulesService
      {} as any, // sumsubTxnClient
      {} as any, // applicantActions
      { assertCapability: jest.fn(), assertOffboardable: jest.fn(), resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }) } as any, // customerAccessService
      { open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST', created: true }) } as any, // customerRestrictionsService
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

  it('should create withdraw in COMPLIANCE_PENDING (CRYPTO)', async () => {
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
          status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
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

  it('should create FIAT withdraw in COMPLIANCE_PENDING', async () => {
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
          status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
        }),
      }),
    );
  });

  // ── Task 3: address-registration guard + VASP derivation (RED → GREEN) ──
  //
  // createWithdrawal must check the customer's registered withdrawal address
  // BEFORE inserting the row: crypto withdrawals look up toAddress, fiat
  // withdrawals look up toIban. A miss (unregistered / not ACTIVE) throws
  // WITHDRAWAL_ADDRESS_NOT_REGISTERED; a hit derives counterpartyIsVasp from
  // the registered address's addressType (crypto only — fiat always null).
  describe('address-registration guard + VASP derivation', () => {
    it('throws WITHDRAWAL_ADDRESS_NOT_REGISTERED when the crypto toAddress is not registered/ACTIVE', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', type: 'CRYPTO' });
      prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001', onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE' });
      prisma.withdrawalAddress.findFirst.mockResolvedValue(null);

      await expect(
        workflow.createWithdrawal(
          {
            assetId: 'asset-1',
            amount: 100,
            toAddress: '0xUNREGISTERED',
            quoteId: 'wq-1',
          } as any,
          'user-1',
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'WITHDRAWAL_ADDRESS_NOT_REGISTERED' }),
      });

      expect(prisma.withdrawalAddress.findFirst).toHaveBeenCalledWith({
        where: { customerId: 'user-1', address: '0xUNREGISTERED', status: 'ACTIVE' },
      });
      // Never reaches insert when the guard rejects.
      expect(mockTx.withdrawTransaction.create).not.toHaveBeenCalled();
    });

    it('crypto: a registered VASP address derives counterpartyIsVasp=true on the inserted record', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', type: 'CRYPTO' });
      prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001', onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE' });
      prisma.withdrawalAddress.findFirst.mockResolvedValue({ addressType: 'VASP' });
      mockTx.withdrawTransaction.create.mockResolvedValue({
        id: 'wd-vasp-1',
        ownerType: 'CUSTOMER',
        ownerId: 'user-1',
        assetId: 'asset-1',
        amount: new Prisma.Decimal(100),
        netAmount: new Prisma.Decimal(100),
        feeAmount: new Prisma.Decimal(0),
        withdrawNo: 'WD-VASP-1',
        fromWalletId: null,
        fromWalletNo: null,
        toWalletId: null,
        toWalletNo: null,
      });

      await workflow.createWithdrawal(
        {
          assetId: 'asset-1',
          amount: 100,
          toAddress: '0xVASPADDR',
          quoteId: 'wq-1',
        } as any,
        'user-1',
      );

      expect(mockTx.withdrawTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ counterpartyIsVasp: true }),
        }),
      );
    });

    it('fiat: a registered BANK address passes the guard with counterpartyIsVasp left null', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-fiat-1', type: 'FIAT' });
      prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001', onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE' });
      prisma.withdrawalAddress.findFirst.mockResolvedValue({ addressType: 'BANK' });
      mockTx.withdrawTransaction.create.mockResolvedValue({
        id: 'wd-bank-1',
        ownerType: 'CUSTOMER',
        ownerId: 'user-1',
        assetId: 'asset-fiat-1',
        amount: new Prisma.Decimal(100),
        netAmount: new Prisma.Decimal(100),
        feeAmount: new Prisma.Decimal(0),
        withdrawNo: 'WD-BANK-1',
        fromWalletId: null,
        fromWalletNo: null,
        toWalletId: null,
        toWalletNo: null,
      });
      withdrawQuoteService.getActiveQuoteOrThrow.mockResolvedValue({
        id: 'wq-2',
        assetId: 'asset-fiat-1',
        amount: new Prisma.Decimal(100),
        totalsJson: JSON.stringify({}),
      });
      withdrawQuoteService.consumeQuote.mockResolvedValue({ id: 'wq-2', status: 'USED' });

      await workflow.createWithdrawal(
        {
          assetId: 'asset-fiat-1',
          amount: 100,
          toIban: 'AE070331234567890123456',
          quoteId: 'wq-2',
        } as any,
        'user-1',
      );

      expect(prisma.withdrawalAddress.findFirst).toHaveBeenCalledWith({
        where: { customerId: 'user-1', iban: 'AE070331234567890123456', status: 'ACTIVE', addressType: 'BANK' },
      });
      expect(mockTx.withdrawTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ counterpartyIsVasp: true }),
        }),
      );
    });
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
      status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
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
      // All three terminal actions (success/fail/return) now share the same single
      // source edge in the 20-edge table: PAYOUT_PENDING. (The old SUCCESS→RETURNED
      // "logging" edge was removed — SUCCESS is now a true zero-out-edge terminal.)
      status: WithdrawTransactionStatus.PAYOUT_PENDING,
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

  // NOTE: the CREATED --check--> PENDING_COMPLIANCE edge this test covered was
  // deleted by the 10-state/20-edge rewrite (Task 1) — CHECK is no longer a valid
  // action and CREATED is no longer a valid status. Removed rather than renamed;
  // the birth-state transition is now covered by the guard-rail edge tests below.

  it('should transition crypto approval via external tx', async () => {
    mockTx.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-3',
      status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
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
      status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
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
        status: WithdrawTransactionStatus.MANUAL_CHECKING,
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
      sumsubTxnId: 'txn-1',
      sumsubVerdict: 'approved',
      counterpartyIsVasp: true,
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
    // raw sumsub fields preserved from DB
    expect(result.sumsubTxnId).toBe('txn-1');
    expect(result.sumsubVerdict).toBe('approved');
    expect(result.counterpartyIsVasp).toBe(true);
  });

  // Task 10: admin detail enrichment — mirrors
  // DepositTransactionsService#findOneForAdmin's parseDetail null-defense +
  // verdict fallback + approvals[] reverse lookup.
  describe('findOneForAdmin', () => {
    const sumsubJson = JSON.stringify({
      scoringResult: {
        score: 87,
        matchedRules: [
          { id: 'rule-1', name: 'High risk country', action: 'block', score: 50 },
        ],
        applicantActions: [
          { applicantActionId: 'act-1' },
          { applicantActionId: 'act-2' },
        ],
      },
    });

    beforeEach(() => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({
        id: 'wd-1',
        withdrawNo: 'WD001',
        sumsubTxnDetailJson: sumsubJson,
        asset: { type: 'CRYPTO', code: 'BTC', network: 'BITCOIN' },
        customer: null,
        fundsOrders: [],
      });
      prisma.auditLogEvent.findMany.mockResolvedValue([]);
    });

    it('parses sumsubTxnDetailJson into sumsubDetail (score/matchedRules/applicantActionIds)', async () => {
      const result: any = await service.findOneForAdmin('wd-1');

      expect(result.sumsubDetail.score).toBe(87);
      expect(result.sumsubDetail.matchedRules).toEqual([
        { id: 'rule-1', name: 'High risk country', action: 'block', score: 50 },
      ]);
      expect(result.sumsubDetail.applicantActionIds).toEqual(['act-1', 'act-2']);
    });

    it('parseDetail: sumsubTxnDetailJson = "null" (valid JSON, value null) does not throw; sumsubDetail is null', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({
        id: 'wd-1',
        withdrawNo: 'WD001',
        sumsubTxnDetailJson: 'null',
        asset: { type: 'CRYPTO', code: 'BTC', network: 'BITCOIN' },
        customer: null,
        fundsOrders: [],
      });

      const result: any = await service.findOneForAdmin('wd-1');

      expect(result.sumsubDetail).toBeNull();
    });

    it('parseDetail: null elements in matchedRules/applicantActions/typedTags are filtered out', async () => {
      const jsonWithNulls = JSON.stringify({
        scoringResult: {
          score: 87,
          matchedRules: [null, { id: 'A', name: 'x', action: 'reject', score: 5 }],
          applicantActions: [null, { applicantActionId: 'act-1' }],
        },
        typedTags: [null, { label: 'FROZEN_BY_MLRO', type: 'userDefined' }],
      });
      prisma.withdrawTransaction.findUnique.mockResolvedValue({
        id: 'wd-1',
        withdrawNo: 'WD001',
        sumsubTxnDetailJson: jsonWithNulls,
        asset: { type: 'CRYPTO', code: 'BTC', network: 'BITCOIN' },
        customer: null,
        fundsOrders: [],
      });

      const result: any = await service.findOneForAdmin('wd-1');

      expect(result.sumsubDetail.matchedRules).toEqual([
        { id: 'A', name: 'x', action: 'reject', score: 5 },
      ]);
      expect(result.sumsubDetail.applicantActionIds).toEqual(['act-1']);
      expect(result.sumsubDetail.tags).toEqual(['FROZEN_BY_MLRO']);
    });

    it('parseDetail: raw 无顶层 verdict、有 scoringResult.action=reject → verdict 回退取 scoringResult.action', async () => {
      const jsonNoTopLevelVerdict = JSON.stringify({
        scoringResult: { action: 'reject', score: 90 },
      });
      prisma.withdrawTransaction.findUnique.mockResolvedValue({
        id: 'wd-1',
        withdrawNo: 'WD001',
        sumsubTxnDetailJson: jsonNoTopLevelVerdict,
        asset: { type: 'CRYPTO', code: 'BTC', network: 'BITCOIN' },
        customer: null,
        fundsOrders: [],
      });

      const result: any = await service.findOneForAdmin('wd-1');

      expect(result.sumsubDetail.verdict).toBe('reject');
    });

    it('returns approvals as single-header-only (no steps/step), regardless of status', async () => {
      approvalsService.list.mockResolvedValue({
        total: 2,
        items: [
          {
            approvalNo: 'APR-1',
            actionType: 'WITHDRAW_UNFREEZE',
            status: 'APPROVED',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            steps: [{ id: 'step-1', decision: 'APPROVE' }],
          },
        ],
      });

      const result: any = await service.findOneForAdmin('wd-1');

      expect(approvalsService.list).toHaveBeenCalledWith(
        expect.objectContaining({ entityRef: 'wd-1' }),
      );
      expect(result.approvals).toEqual([
        {
          approvalNo: 'APR-1',
          actionType: 'WITHDRAW_UNFREEZE',
          status: 'APPROVED',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);
    });
  });

  // Task 11: customer-facing field whitelist (tipping-off guard). Mirrors
  // DepositTransactionsService's SENSITIVE_FULL_ROW/SENSITIVE_KEYS leak-prevention
  // spec — a mock row carrying every investigation-only column a
  // FROZEN/MANUAL_CHECKING withdrawal would have, asserting none of it survives
  // toCustomerWithdrawView's whitelist projection.
  describe('findAllForCustomer / findOneForCustomer — tipping-off whitelist', () => {
    const SENSITIVE_FULL_ROW = {
      id: 'w-sensitive-1',
      withdrawNo: 'WDR-SENS-1',
      ownerId: 'cust-1',
      ownerType: 'CUSTOMER',
      status: 'FROZEN',
      amount: '500.00',
      feeAmount: '5.00',
      netAmount: '495.00',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      completedAt: null,
      txHash: '0xabc',
      referenceNo: 'REF-1',
      toAddress: 'T_TO',
      toIban: null,
      asset: { currency: 'USDT', code: 'USDT', network: 'TRON', decimals: 6, type: 'CRYPTO' },
      statusHistory: JSON.stringify([
        { status: 'FROZEN', reason: 'Sanction match — sending unfreeze/refund to MLRO for review' },
      ]),
      manualReason: 'EDD_PEP',
      sumsubTxnId: 'sumsub-txn-1',
      sumsubTxnType: 'travelRule',
      sumsubVerdict: 'rejected',
      sumsubScore: 92,
      sumsubTxnDetailJson: '{"verdict":"rejected"}',
      counterpartyIsVasp: true,
      slaDeadline: new Date('2026-01-03T00:00:00Z'),
      slaBreached: true,
      needsReview: true,
      feeSettleAttempts: 2,
      tbPendingNetId: 'tb-net-1',
      tbPendingFeeId: 'tb-fee-1',
      grossAedValue: '1837.50',
      approvalCaseId: 'case-1',
      approvalNo: 'APR-1',
      traceId: 'WITHDRAW:w-sensitive-1',
    };

    const SENSITIVE_KEYS = [
      'statusHistory',
      'manualReason',
      'sumsubTxnId',
      'sumsubTxnType',
      'sumsubVerdict',
      'sumsubScore',
      'sumsubTxnDetailJson',
      'counterpartyIsVasp',
      'slaDeadline',
      'slaBreached',
      'needsReview',
      'feeSettleAttempts',
      'tbPendingNetId',
      'tbPendingFeeId',
      'grossAedValue',
      'approvalCaseId',
      'approvalNo',
      'traceId',
    ];

    const EXPECTED_VIEW = {
      id: 'w-sensitive-1',
      withdrawNo: 'WDR-SENS-1',
      status: 'FROZEN',
      amount: '500.00',
      feeAmount: '5.00',
      netAmount: '495.00',
      createdAt: SENSITIVE_FULL_ROW.createdAt,
      completedAt: null,
      txHash: '0xabc',
      referenceNo: 'REF-1',
      toAddress: 'T_TO',
      toIban: null,
      asset: { currency: 'USDT', code: 'USDT', network: 'TRON', decimals: 6 },
      // Task 3 (action-embed) 开的 `actions` 口子已在 2026-08-18 材料请求账
      // Task 12 随专属子表一起物理删除，见 toCustomerWithdrawView 的文档注释——
      // 不再列出这个键就是在断言它已经不在客户面响应体里。
    };

    describe('findAllForCustomer', () => {
      it('scopes the list query to the caller (ownerId)', async () => {
        prisma.withdrawTransaction.findMany = jest.fn().mockResolvedValue([]);
        prisma.withdrawTransaction.count = jest.fn().mockResolvedValue(0);

        await service.findAllForCustomer('cust-1', {} as any);

        expect(prisma.withdrawTransaction.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ ownerId: 'cust-1' }) }),
        );
      });

      it('strips statusHistory/manualReason/sumsub*/sla*/needsReview/feeSettleAttempts/tbPending*/grossAedValue/approvalCaseId+No/traceId while keeping the fields the client actually renders', async () => {
        prisma.withdrawTransaction.findMany = jest.fn().mockResolvedValue([SENSITIVE_FULL_ROW]);
        prisma.withdrawTransaction.count = jest.fn().mockResolvedValue(1);

        const result = await service.findAllForCustomer('cust-1', {} as any);
        const item = result.items[0] as any;

        for (const key of SENSITIVE_KEYS) {
          expect(item).not.toHaveProperty(key);
        }
        expect(item).toEqual(EXPECTED_VIEW);
      });

    });

    describe('findOneForCustomer', () => {
      it("another customer's withdrawal → ForbiddenException (ownership enforced)", async () => {
        prisma.withdrawTransaction.findUnique.mockResolvedValue({
          id: 'w1',
          ownerId: 'other-cust',
        });

        await expect(service.findOneForCustomer('w1', 'cust-1')).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('strips statusHistory/manualReason/sumsub*/sla*/needsReview/feeSettleAttempts/tbPending*/grossAedValue/approvalCaseId+No/traceId while keeping the fields the client actually renders', async () => {
        prisma.withdrawTransaction.findUnique.mockResolvedValue(SENSITIVE_FULL_ROW);

        const result = (await service.findOneForCustomer('w-sensitive-1', 'cust-1')) as any;

        for (const key of SENSITIVE_KEYS) {
          expect(result).not.toHaveProperty(key);
        }
        expect(result).toEqual(EXPECTED_VIEW);
      });
    });

    describe('findOneForCustomerByWithdrawNo', () => {
      it('IDOR miss（单号存在但不属于该客户）→ 与「单子不存在」完全相同的 404', async () => {
        prisma.withdrawTransaction.findFirst = jest.fn().mockResolvedValue(null);

        await expect(
          service.findOneForCustomerByWithdrawNo('WDR-NOPE', 'cust-1'),
        ).rejects.toThrow('Withdraw transaction not found');
      });

      it('命中 → 走 findOneForCustomer 同一套白名单', async () => {
        prisma.withdrawTransaction.findFirst = jest
          .fn()
          .mockResolvedValue({ id: 'w-sensitive-1' });
        prisma.withdrawTransaction.findUnique.mockResolvedValue(SENSITIVE_FULL_ROW);

        const result = (await service.findOneForCustomerByWithdrawNo(
          'WDR-SENS-1',
          'cust-1',
        )) as any;

        expect(prisma.withdrawTransaction.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { withdrawNo: 'WDR-SENS-1', ownerId: 'cust-1' },
          }),
        );
        for (const key of SENSITIVE_KEYS) {
          expect(result).not.toHaveProperty(key);
        }
        expect(result).toEqual(EXPECTED_VIEW);
      });
    });
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

    // NOTE: the CREATED --require_approval--> PENDING_APPROVAL edge this covered
    // was deleted by the 10-state/20-edge rewrite (Task 1) — PENDING_APPROVAL has
    // no incoming edges in the transitions table (REQUIRE_APPROVAL has no edge at
    // all), and is reached only via the sanctioned birth-routing write covered by
    // the `landOnPendingApproval` describe block below (Task 2). Removed rather
    // than renamed.

    it('PENDING_APPROVAL → GATE_APPROVE → COMPLIANCE_PENDING', async () => {
      arrangeItem(WithdrawTransactionStatus.PENDING_APPROVAL);
      const res = await service.updateStatus('w1', { action: WithdrawTransactionAction.GATE_APPROVE }, { source: 'WORKFLOW' });
      expect(res.status).toBe(WithdrawTransactionStatus.COMPLIANCE_PENDING);
    });

    it('PENDING_APPROVAL → REJECT → REJECTED', async () => {
      arrangeItem(WithdrawTransactionStatus.PENDING_APPROVAL);
      const res = await service.updateStatus('w1', { action: WithdrawTransactionAction.REJECT }, { source: 'WORKFLOW' });
      expect(res.status).toBe(WithdrawTransactionStatus.REJECTED);
    });

    // NOTE: 'rejects GATE_APPROVE from CREATED' removed (CREATED no longer exists);
    // the exhaustive negative sweep in the guard-rail describe block below now
    // covers every undocumented (status, action) pair, including this one.
  });

  // Task 2 ("出生即着陆"): landOnPendingApproval is the ONE sanctioned COMPLIANCE_PENDING
  // → PENDING_APPROVAL write that bypasses updateStatus/transitions entirely — the
  // 20-edge table deliberately has no edge for it. Called only by
  // WithdrawWorkflowService.openApprovalGate() after the approval case is linked.
  describe('landOnPendingApproval — sanctioned birth-routing write (bypasses transitions)', () => {
    it('writes status PENDING_APPROVAL directly via prisma.update and appends statusHistory', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({
        statusHistory: JSON.stringify([
          { status: WithdrawTransactionStatus.COMPLIANCE_PENDING, note: 'Withdrawal created — awaiting approval-gate valuation' },
        ]),
      });
      prisma.withdrawTransaction.update = jest.fn().mockResolvedValue({
        id: 'wd-birth-route-1',
        status: WithdrawTransactionStatus.PENDING_APPROVAL,
      });

      const result = await service.landOnPendingApproval('wd-birth-route-1');

      expect(prisma.withdrawTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wd-birth-route-1' },
          data: expect.objectContaining({
            status: WithdrawTransactionStatus.PENDING_APPROVAL,
          }),
        }),
      );
      const writtenHistory = JSON.parse(
        (prisma.withdrawTransaction.update as jest.Mock).mock.calls[0][0].data.statusHistory,
      );
      expect(writtenHistory).toHaveLength(2);
      expect(writtenHistory[1]).toMatchObject({ status: WithdrawTransactionStatus.PENDING_APPROVAL });
      expect(result.status).toBe(WithdrawTransactionStatus.PENDING_APPROVAL);
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

  // Task 5 review FIX 1: a FAILED re-valuation must not clobber a good AED
  // birth-value to null (that would zero the row's contribution to the B
  // cumulative window and let a sibling withdrawal slip past the AED cap).
  describe('saveValuationSnapshot — B-sum no-clobber guard', () => {
    beforeEach(() => {
      prisma.withdrawTransaction.update = jest.fn().mockResolvedValue({});
    });

    it('preserves the birth-value: a failed re-valuation does NOT overwrite an existing non-null grossAedValue', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({
        grossAedValue: new Prisma.Decimal('367000'),
      });

      await service.saveValuationSnapshot('wd-birth', {
        grossAedValue: null,
        aedRate: null,
        rateFetchedAt: null,
        rateFetchFailed: true,
      });

      // No write — the good birth snapshot is left intact.
      expect(prisma.withdrawTransaction.update).not.toHaveBeenCalled();
    });

    it('ADMIN path (no birth-value): a failed re-valuation still writes the failed snapshot', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({ grossAedValue: null });

      await service.saveValuationSnapshot('wd-admin', {
        grossAedValue: null,
        aedRate: null,
        rateFetchedAt: null,
        rateFetchFailed: true,
      });

      expect(prisma.withdrawTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wd-admin' },
          data: expect.objectContaining({ grossAedValue: null, rateFetchFailed: true }),
        }),
      );
    });

    it('a successful re-valuation overwrites with the fresher value (no guard, no read)', async () => {
      const fresh = new Prisma.Decimal('999999');

      await service.saveValuationSnapshot('wd-fresh', {
        grossAedValue: fresh,
        aedRate: new Prisma.Decimal('3.67'),
        rateFetchedAt: new Date(),
        rateFetchFailed: false,
      });

      expect(prisma.withdrawTransaction.findUnique).not.toHaveBeenCalled();
      expect(prisma.withdrawTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ grossAedValue: fresh, rateFetchFailed: false }),
        }),
      );
    });
  });

  // 守则性测试(防转移表再次漂移):brief `.superpowers/sdd/task-1-brief.md` Step 1 定稿的
  // 21 条边逐条列出(20 + 2026-08-13 新增 PENDING_APPROVAL --freeze--> FROZEN)——多一条、少一条、边指向变了,这里都会红。同时用穷举(10 状态 ×
  // 13 动作)反向断言:凡不在这 20 条边名单里的组合,一律必须抛 Invalid action(即没有
  // 偷偷长出的第 22 条边)。照抄充值 deposit-transactions.service.spec.ts 的写法。
  describe('state machine integrity guard (21-edge spec)', () => {
    const mockId = 'wd-edge-1';

    function setupMock(status: WithdrawTransactionStatus) {
      mockTx.withdrawTransaction.findUnique.mockResolvedValue({
        id: mockId,
        withdrawNo: 'WD-EDGE',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-edge',
        assetId: 'asset-edge',
        status,
        statusHistory: '[]',
        approvedAt: null,
        payoutRequestedAt: null,
        completedAt: null,
        asset: { type: 'CRYPTO' },
      });
      mockTx.withdrawTransaction.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: mockId, status: data.status }),
      );
    }

    const EDGES: Array<
      [WithdrawTransactionStatus, WithdrawTransactionAction, WithdrawTransactionStatus]
    > = [
      [WithdrawTransactionStatus.PENDING_APPROVAL, WithdrawTransactionAction.GATE_APPROVE, WithdrawTransactionStatus.COMPLIANCE_PENDING],
      [WithdrawTransactionStatus.PENDING_APPROVAL, WithdrawTransactionAction.REJECT, WithdrawTransactionStatus.REJECTED],
      // 2026-08-13 新增:大额审批可挂数天,期间客户被冻(材料到期定时任务自动触发)必须冻得住
      [WithdrawTransactionStatus.PENDING_APPROVAL, WithdrawTransactionAction.FREEZE, WithdrawTransactionStatus.FROZEN],

      [WithdrawTransactionStatus.COMPLIANCE_PENDING, WithdrawTransactionAction.APPROVE, WithdrawTransactionStatus.PAYOUT_PENDING],
      [WithdrawTransactionStatus.COMPLIANCE_PENDING, WithdrawTransactionAction.ACTION_PENDING, WithdrawTransactionStatus.ACTION_PENDING],
      [WithdrawTransactionStatus.COMPLIANCE_PENDING, WithdrawTransactionAction.KYT_REJECTED, WithdrawTransactionStatus.MANUAL_CHECKING],
      [WithdrawTransactionStatus.COMPLIANCE_PENDING, WithdrawTransactionAction.SLA_BREACH, WithdrawTransactionStatus.MANUAL_CHECKING],
      [WithdrawTransactionStatus.COMPLIANCE_PENDING, WithdrawTransactionAction.FREEZE, WithdrawTransactionStatus.FROZEN],

      [WithdrawTransactionStatus.ACTION_PENDING, WithdrawTransactionAction.APPROVE, WithdrawTransactionStatus.PAYOUT_PENDING],
      [WithdrawTransactionStatus.ACTION_PENDING, WithdrawTransactionAction.KYT_REJECTED, WithdrawTransactionStatus.MANUAL_CHECKING],
      [WithdrawTransactionStatus.ACTION_PENDING, WithdrawTransactionAction.FREEZE, WithdrawTransactionStatus.FROZEN],
      [WithdrawTransactionStatus.ACTION_PENDING, WithdrawTransactionAction.SLA_BREACH, WithdrawTransactionStatus.MANUAL_CHECKING],

      [WithdrawTransactionStatus.MANUAL_CHECKING, WithdrawTransactionAction.APPROVE, WithdrawTransactionStatus.PAYOUT_PENDING],
      [WithdrawTransactionStatus.MANUAL_CHECKING, WithdrawTransactionAction.ACTION_PENDING, WithdrawTransactionStatus.ACTION_PENDING],
      [WithdrawTransactionStatus.MANUAL_CHECKING, WithdrawTransactionAction.FREEZE, WithdrawTransactionStatus.FROZEN],
      [WithdrawTransactionStatus.MANUAL_CHECKING, WithdrawTransactionAction.REJECT_REFUND, WithdrawTransactionStatus.REJECTED],

      [WithdrawTransactionStatus.FROZEN, WithdrawTransactionAction.RESUME, WithdrawTransactionStatus.COMPLIANCE_PENDING],
      [WithdrawTransactionStatus.FROZEN, WithdrawTransactionAction.REJECT_REFUND, WithdrawTransactionStatus.REJECTED],

      [WithdrawTransactionStatus.PAYOUT_PENDING, WithdrawTransactionAction.SUCCESS, WithdrawTransactionStatus.SUCCESS],
      [WithdrawTransactionStatus.PAYOUT_PENDING, WithdrawTransactionAction.FAIL, WithdrawTransactionStatus.FAILED],
      [WithdrawTransactionStatus.PAYOUT_PENDING, WithdrawTransactionAction.RETURN, WithdrawTransactionStatus.RETURNED],
    ];

    it('brief lists exactly the 21 spec edges', () => {
      expect(EDGES).toHaveLength(21);
    });

    it.each(
      EDGES.map(([from, action, to]) => [`${from} --${action}--> ${to}`, from, action, to] as const),
    )('%s', async (_label, from, action, to) => {
      setupMock(from);
      const result = await service.updateStatus(mockId, { action });
      expect(result.status).toBe(to);
    });

    it('rejects every (status,action) pair NOT in the 21-edge list (no undocumented edge exists)', async () => {
      const edgeKeys = new Set(EDGES.map(([from, action]) => `${from}::${action}`));
      const allStatuses = Object.values(WithdrawTransactionStatus);
      const allActions = Object.values(WithdrawTransactionAction);

      for (const status of allStatuses) {
        for (const action of allActions) {
          if (edgeKeys.has(`${status}::${action}`)) continue;
          setupMock(status);
          await expect(
            service.updateStatus(mockId, { action }),
          ).rejects.toThrow(BadRequestException);
        }
      }
    });
  });
});
