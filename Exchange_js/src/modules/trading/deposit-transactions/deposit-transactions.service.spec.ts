import { Test, TestingModule } from '@nestjs/testing';
import { DepositTransactionsService } from './deposit-transactions.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  DepositTransactionStatus,
  DepositTransactionAction,
} from './dto/deposit-transaction.dto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { TransactionLimitRulesService } from '../../asset-treasury/transaction-limits/transaction-limit-rules.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { Prisma } from '@prisma/client';

describe('DepositTransactionsService', () => {
  let service: DepositTransactionsService;
  let prisma: PrismaService;
  let eventEmitter: EventEmitter2;
  let fundsOrderService: Record<string, jest.Mock>;
  let limitRules: Record<string, jest.Mock>;
  let approvalsService: Record<string, jest.Mock>;
  let module: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();
    fundsOrderService = {
      create: jest.fn(),
      advance: jest.fn(),
      findById: jest.fn(),
      findByParent: jest.fn().mockResolvedValue([]),
    };
    limitRules = {
      getSingleRule: jest.fn().mockResolvedValue(null),
    };
    approvalsService = {
      list: jest.fn().mockResolvedValue({ total: 0, items: [] }),
    };
    module = await Test.createTestingModule({
      providers: [
        DepositTransactionsService,
        {
          provide: PrismaService,
          useValue: {
            depositTransaction: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              create: jest.fn(),
              count: jest.fn(),
            },
            wallet: {
              findUnique: jest.fn(),
            },
            customerMain: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: FundsOrderService,
          useValue: fundsOrderService,
        },
        {
          provide: AuditLogsService,
          useValue: {
            recordSystem: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: TransactionLimitRulesService,
          useValue: limitRules,
        },
        {
          provide: ApprovalsService,
          useValue: approvalsService,
        },
      ],
    }).compile();

    service = module.get<DepositTransactionsService>(DepositTransactionsService);
    prisma = module.get<PrismaService>(PrismaService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should enrich deposit list items with ownerNo and type', async () => {
      ((prisma as any).depositTransaction.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'dep-1',
          depositNo: 'DP001',
          ownerType: 'CUSTOMER',
          ownerId: 'cust-1',
          status: DepositTransactionStatus.COMPLIANCE_PENDING,
          amount: '100.00',
          asset: { code: 'USDT', type: 'CRYPTO' },
          customer: { customerNo: 'CU001' },
        },
      ]);
      ((prisma as any).depositTransaction.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        ownerNo: 'CU001',
        type: 'crypto',
      });
    });

    it('admin list: NOT filtered (below-min visible)', async () => {
      ((prisma as any).depositTransaction.findMany as jest.Mock).mockResolvedValue([]);
      ((prisma as any).depositTransaction.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({} as any);

      const calls = ((prisma as any).depositTransaction.findMany as jest.Mock).mock.calls;
      const call = calls[calls.length - 1][0];
      expect(call.where?.limitHoldReason).toBeUndefined();
    });
  });

  // Fix 1 (final review, tipping-off): a row carrying every investigation-only
  // field a SEIZED/FROZEN/rejected deposit would have. limitHoldReason is null
  // (a seized deposit reaches SEIZED via FROZEN, never via the below-min hold
  // path) so it passes the existing customerScope filter — the whitelist is
  // the only thing standing between this row and the customer's browser.
  const SENSITIVE_FULL_ROW = {
    id: 'd-sensitive-1',
    depositNo: 'DEP-SENS-1',
    ownerId: 'cust-1',
    ownerType: 'CUSTOMER',
    status: 'SEIZED',
    amount: '500.00',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: new Date('2026-01-02T00:00:00Z'),
    txHash: '0xabc',
    referenceNo: 'REF-1',
    fromAddress: 'T_FROM',
    fromIban: null,
    asset: { currency: 'USDT', code: 'USDT', network: 'TRON', decimals: 6, type: 'CRYPTO' },
    limitHoldReason: null,
    statusHistory: JSON.stringify([
      { status: 'SEIZED', reason: 'Seizure settled — funds handed off to government custody' },
      { status: 'SEIZING', reason: 'Seizure approved (funds in transit to government custody)' },
      { status: 'FROZEN', reason: 'KYT verdict: rejected' },
    ]),
    manualReason: 'EDD_PEP',
    sumsubFinanceTxnId: 'sumsub-finance-1',
    sumsubTravelRuleTxnId: 'sumsub-tr-1',
    financeStatus: 'REJECTED',
    financeRiskScore: 92,
    financeScreeningId: 'screen-1',
    financeCheckedAt: new Date('2026-01-01T00:05:00Z'),
    travelRuleStatus: 'PASSED',
    travelRuleTransferId: 'tr-transfer-1',
    counterpartyVasp: 'Some VASP Inc.',
    slaDeadline: new Date('2026-01-03T00:00:00Z'),
    slaBreached: true,
  };

  const SENSITIVE_KEYS = [
    'statusHistory',
    'manualReason',
    'sumsubFinanceTxnId',
    'sumsubTravelRuleTxnId',
    'financeStatus',
    'financeRiskScore',
    'financeScreeningId',
    'financeCheckedAt',
    'travelRuleStatus',
    'travelRuleTransferId',
    'counterpartyVasp',
    'limitHoldReason',
    'slaDeadline',
    'slaBreached',
  ];

  describe('findAllForCustomer', () => {
    it('customer list: BELOW_MIN deposits are filtered out server-side', async () => {
      ((prisma as any).depositTransaction.findMany as jest.Mock).mockResolvedValue([]);
      ((prisma as any).depositTransaction.count as jest.Mock).mockResolvedValue(0);

      await service.findAllForCustomer('cust-1', {} as any);

      expect((prisma as any).depositTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ limitHoldReason: null }) }),
      );
    });

    it('Fix 1 (tipping-off): customer list strips statusHistory/manualReason/sumsub*/kyt*/travelRule*/limitHoldReason/sla* while keeping the fields the client actually renders', async () => {
      ((prisma as any).depositTransaction.findMany as jest.Mock).mockResolvedValue([
        SENSITIVE_FULL_ROW,
      ]);
      ((prisma as any).depositTransaction.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAllForCustomer('cust-1', {} as any);
      const item = result.items[0] as any;

      for (const key of SENSITIVE_KEYS) {
        expect(item).not.toHaveProperty(key);
      }
      expect(item).toEqual({
        id: 'd-sensitive-1',
        depositNo: 'DEP-SENS-1',
        status: 'SEIZED',
        amount: '500.00',
        createdAt: SENSITIVE_FULL_ROW.createdAt,
        completedAt: SENSITIVE_FULL_ROW.completedAt,
        txHash: '0xabc',
        referenceNo: 'REF-1',
        fromAddress: 'T_FROM',
        fromIban: null,
        asset: { currency: 'USDT', code: 'USDT', network: 'TRON', decimals: 6 },
      });
    });
  });

  describe('findOneForCustomer', () => {
    it('customer detail: BELOW_MIN deposit → NotFound (treated as non-existent)', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'd1',
        ownerId: 'cust-1',
        limitHoldReason: 'BELOW_MIN',
      });

      await expect(service.findOneForCustomer('d1', 'cust-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it("customer detail: another customer's deposit → NotFound (ownership enforced)", async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'd1',
        ownerId: 'other-cust',
        limitHoldReason: null,
      });

      await expect(service.findOneForCustomer('d1', 'cust-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('Fix 1 (tipping-off): customer detail strips statusHistory/manualReason/sumsub*/kyt*/travelRule*/limitHoldReason/sla* while keeping the fields the client actually renders', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(
        SENSITIVE_FULL_ROW,
      );

      const result = (await service.findOneForCustomer('d-sensitive-1', 'cust-1')) as any;

      for (const key of SENSITIVE_KEYS) {
        expect(result).not.toHaveProperty(key);
      }
      expect(result).toEqual({
        id: 'd-sensitive-1',
        depositNo: 'DEP-SENS-1',
        status: 'SEIZED',
        amount: '500.00',
        createdAt: SENSITIVE_FULL_ROW.createdAt,
        completedAt: SENSITIVE_FULL_ROW.completedAt,
        txHash: '0xabc',
        referenceNo: 'REF-1',
        fromAddress: 'T_FROM',
        fromIban: null,
        asset: { currency: 'USDT', code: 'USDT', network: 'TRON', decimals: 6 },
      });
    });
  });

  describe('updateStatus (State Machine)', () => {
    const mockId = 'uuid';
    const setupMock = (currentStatus: string) => {
      const mockRecord = {
        id: mockId,
        depositNo: 'DP001',
        status: currentStatus,
        ownerType: 'CUSTOMER',
        ownerId: 'U123',
        assetId: 'A123',
        amount: '100',
        payinId: 'P123',
      };
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(mockRecord);
      ((prisma as any).depositTransaction.update as jest.Mock).mockImplementation(({ data }) =>
        Promise.resolve({ ...mockRecord, ...data }),
      );
    };

    it('PAYIN_PENDING → COMPLIANCE_PENDING via payin_confirmed', async () => {
      setupMock(DepositTransactionStatus.PAYIN_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.PAYIN_CONFIRMED,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.COMPLIANCE_PENDING }),
        }),
      );
    });

    it('COMPLIANCE_PENDING → SUCCESS via approve', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.APPROVE,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.SUCCESS,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('blocks ADMIN_API from directly reaching SUCCESS (workflow-only guard)', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);

      await expect(
        service.updateStatus(
          mockId,
          { action: DepositTransactionAction.APPROVE },
          {
            sourcePlatform: 'ADMIN_API',
            actor: { actorType: 'ADMIN', actorId: 'a1' },
          },
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'DEPOSIT_APPROVE_WORKFLOW_ONLY',
        }),
      });

      expect((prisma as any).depositTransaction.update).not.toHaveBeenCalled();
    });

    it('COMPLIANCE_PENDING → CONFISCATING via confiscate_start', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);
      await service.updateStatus(mockId, { action: DepositTransactionAction.CONFISCATE_START });
      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CONFISCATING' }) }),
      );
    });
    it('CONFISCATING → CONFISCATED via confiscate_settle', async () => {
      setupMock(DepositTransactionStatus.CONFISCATING);
      await service.updateStatus(mockId, { action: DepositTransactionAction.CONFISCATE_SETTLE });
      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CONFISCATED' }) }),
      );
    });
    it('blocks ADMIN_API from directly reaching CONFISCATING (workflow-only)', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);
      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.CONFISCATE_START },
          { sourcePlatform: 'ADMIN_API', actor: { actorType: 'ADMIN', actorId: 'a1' } }),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'DEPOSIT_APPROVE_WORKFLOW_ONLY' }) });
    });

    it('COMPLIANCE_PENDING → REJECTED via reject', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.REJECT,
        reason: 'High risk detected',
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.REJECTED,
            completedAt: expect.any(Date),
          }),
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalled();
    });

    it('COMPLIANCE_PENDING → ACTION_PENDING via action_pending', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.ACTION_PENDING,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.ACTION_PENDING }),
        }),
      );
    });

    it('ACTION_PENDING → SUCCESS via approve', async () => {
      setupMock(DepositTransactionStatus.ACTION_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.APPROVE,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.SUCCESS }),
        }),
      );
    });

    it('ACTION_PENDING → COMPLIANCE_PENDING via resume', async () => {
      setupMock(DepositTransactionStatus.ACTION_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.RESUME,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.COMPLIANCE_PENDING }),
        }),
      );
    });

    it('ACTION_PENDING → EXPIRED via expire', async () => {
      setupMock(DepositTransactionStatus.ACTION_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.EXPIRE,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.EXPIRED,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('ACTION_PENDING → MANUAL_CHECKING via manual_check', async () => {
      setupMock(DepositTransactionStatus.ACTION_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.MANUAL_CHECK,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.MANUAL_CHECKING,
          }),
        }),
      );
    });

    it('FROZEN rejects approve (sanctions/MLRO freeze must not be lifted by a single-operator approve)', async () => {
      setupMock(DepositTransactionStatus.FROZEN);

      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.APPROVE }),
      ).rejects.toThrow(BadRequestException);

      expect((prisma as any).depositTransaction.update).not.toHaveBeenCalled();
    });

    it('FROZEN → CONFISCATED via confiscate', async () => {
      setupMock(DepositTransactionStatus.FROZEN);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.CONFISCATE,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.CONFISCATED,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('FROZEN rejects invalid actions', async () => {
      setupMock(DepositTransactionStatus.FROZEN);

      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.REJECT }),
      ).rejects.toThrow(BadRequestException);
    });

    it('COMPLIANCE_PENDING → MANUAL_CHECKING via manual_check', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.MANUAL_CHECK,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.MANUAL_CHECKING,
          }),
        }),
      );
    });

    it('MANUAL_CHECKING → SUCCESS via approve', async () => {
      setupMock(DepositTransactionStatus.MANUAL_CHECKING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.APPROVE,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.SUCCESS,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('MANUAL_CHECKING → FROZEN via freeze', async () => {
      setupMock(DepositTransactionStatus.MANUAL_CHECKING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.FREEZE,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.FROZEN,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('MANUAL_CHECKING → RETURNING via return', async () => {
      setupMock(DepositTransactionStatus.MANUAL_CHECKING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.RETURN,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.RETURNING,
          }),
        }),
      );
    });

    it('RETURNING → RETURNED via returned_done', async () => {
      setupMock(DepositTransactionStatus.RETURNING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.RETURNED_DONE,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.RETURNED,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('FROZEN → RETURNING via return', async () => {
      setupMock(DepositTransactionStatus.FROZEN);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.RETURN,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.RETURNING,
          }),
        }),
      );
    });

    it('FROZEN → SEIZING via seize', async () => {
      setupMock(DepositTransactionStatus.FROZEN);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.SEIZE,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.SEIZING,
          }),
        }),
      );
    });

    it('SEIZING → SEIZED via seized_done', async () => {
      setupMock(DepositTransactionStatus.SEIZING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.SEIZED_DONE,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.SEIZED,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('FROZEN → COMPLIANCE_PENDING via resume', async () => {
      setupMock(DepositTransactionStatus.FROZEN);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.RESUME,
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.COMPLIANCE_PENDING,
          }),
        }),
      );
    });

    it('PAYIN_PENDING → FAILED via fail', async () => {
      setupMock(DepositTransactionStatus.PAYIN_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.FAIL,
        reason: 'Network error',
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositTransactionStatus.FAILED,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('throws on any action for terminal FAILED', async () => {
      setupMock(DepositTransactionStatus.FAILED);

      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.APPROVE }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws on any action for terminal SUCCESS', async () => {
      setupMock(DepositTransactionStatus.SUCCESS);

      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.APPROVE }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws on any action for terminal REJECTED', async () => {
      setupMock(DepositTransactionStatus.REJECTED);

      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.FAIL }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws on any action for terminal RETURNED', async () => {
      setupMock(DepositTransactionStatus.RETURNED);

      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.APPROVE }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws on any action for terminal SEIZED', async () => {
      setupMock(DepositTransactionStatus.SEIZED);

      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.APPROVE }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid action for PAYIN_PENDING', async () => {
      setupMock(DepositTransactionStatus.PAYIN_PENDING);

      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.APPROVE }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('detected', () => {
    beforeEach(() => {
      ((prisma as any).wallet.findUnique as jest.Mock).mockResolvedValue({
        id: 'w1',
        assetId: 'a1',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        address: null,
        iban: null,
        asset: { type: 'FIAT' },
      });
      ((prisma as any).depositTransaction.create as jest.Mock).mockImplementation(
        ({ data }: any) => Promise.resolve({ id: 'dep-1', ...data }),
      );
      fundsOrderService.create.mockResolvedValue({ id: 'fo-1', fundsOrderNo: 'FO0001' });
    });

    it('detected(): amount < DEPOSIT SINGLE min → deposit born with limitHoldReason=BELOW_MIN', async () => {
      limitRules.getSingleRule.mockResolvedValue({ ruleNo: 'TLR-x', minAmount: new Prisma.Decimal('100'), maxAmount: null });
      await service.detected({ assetId: 'a1', toWalletId: 'w1', amount: '5' });
      expect(prisma.depositTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ limitHoldReason: 'BELOW_MIN' }) }),
      );
    });

    it('detected(): amount >= min → no hold flag', async () => {
      limitRules.getSingleRule.mockResolvedValue({ ruleNo: 'TLR-x', minAmount: new Prisma.Decimal('100'), maxAmount: null });
      await service.detected({ assetId: 'a1', toWalletId: 'w1', amount: '100' });
      expect(prisma.depositTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ limitHoldReason: undefined }) }),
      );
    });

    it('detected(): no DEPOSIT rule → no hold flag', async () => {
      limitRules.getSingleRule.mockResolvedValue(null);
      await service.detected({ assetId: 'a1', toWalletId: 'w1', amount: '5' });
      expect(prisma.depositTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ limitHoldReason: undefined }) }),
      );
    });
  });

  describe('Compliance Gate Methods', () => {

    it('updateSumsubVerdict sets sumsubVerdict, sumsubScore, and sumsubScoredAt', async () => {
      const mockRecord = { id: 'dep-1', sumsubVerdict: 'rejected', sumsubScore: 15, sumsubScoredAt: new Date() };
      ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue(mockRecord);

      const result = await service.updateSumsubVerdict('dep-1', 'rejected', 15);

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        data: {
          sumsubVerdict: 'rejected',
          sumsubScore: 15,
          sumsubScoredAt: expect.any(Date),
        },
      });
      expect(result.sumsubVerdict).toBe('rejected');
    });

    it('setSumsubTxn writes sumsubTxnId and sumsubTxnType (finance)', async () => {
      ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        sumsubTxnId: 'TXN-FIN-1',
        sumsubTxnType: 'finance',
      });

      await service.setSumsubTxn('dep-1', { sumsubTxnId: 'TXN-FIN-1', sumsubTxnType: 'finance' });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        data: { sumsubTxnId: 'TXN-FIN-1', sumsubTxnType: 'finance' },
      });
    });

    it('setSumsubTxn writes sumsubTxnId and sumsubTxnType (travelRule)', async () => {
      ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        sumsubTxnId: 'TXN-TR-2',
        sumsubTxnType: 'travelRule',
      });

      await service.setSumsubTxn('dep-1', { sumsubTxnId: 'TXN-TR-2', sumsubTxnType: 'travelRule' });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        data: { sumsubTxnId: 'TXN-TR-2', sumsubTxnType: 'travelRule' },
      });
    });

    it('clearLimitHold sets limitHoldReason to null', async () => {
      const mockRecord = { id: 'dep-1', limitHoldReason: null };
      ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue(mockRecord);

      const result = await service.clearLimitHold('dep-1');

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        data: { limitHoldReason: null },
      });
      expect(result.limitHoldReason).toBeNull();
    });

    it('getOwnerComplianceStatus returns customer complianceStatus', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        ownerId: 'cust-1',
      });
      ((prisma as any).customerMain.findUnique as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        complianceStatus: 'ACTIVE',
      });

      const result = await service.getOwnerComplianceStatus('dep-1');

      expect(result).toBe('ACTIVE');
      expect((prisma as any).depositTransaction.findUnique).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        select: { ownerId: true },
      });
    });

    it('getOwnerComplianceStatus throws if deposit not found', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getOwnerComplianceStatus('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('getOwnerComplianceStatus returns UNKNOWN when customer not found', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        ownerId: 'missing-cust',
      });
      ((prisma as any).customerMain.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getOwnerComplianceStatus('dep-1');

      expect(result).toBe('UNKNOWN');
    });
  });

  describe('findOneForAdmin', () => {
    const financeJson = JSON.stringify({
      verdict: 'GREEN',
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
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DP001',
        financeTxnDetailJson: financeJson,
        travelRuleTxnDetailJson: null,
        fundsOrders: [],
      });
    });

    it('parses financeTxnDetailJson into financeDetail (score/matchedRules/applicantActionIds)', async () => {
      const result: any = await service.findOneForAdmin('dep-1');

      expect(result.financeDetail.score).toBe(87);
      expect(result.financeDetail.matchedRules).toEqual([
        { id: 'rule-1', name: 'High risk country', action: 'block', score: 50 },
      ]);
      expect(result.financeDetail.applicantActionIds).toEqual(['act-1', 'act-2']);
    });

    it('parseDetail: financeTxnDetailJson = "null" (valid JSON, value null) does not throw; financeDetail is null', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DP001',
        financeTxnDetailJson: 'null',
        travelRuleTxnDetailJson: null,
        fundsOrders: [],
      });

      const result: any = await service.findOneForAdmin('dep-1');

      expect(result.financeDetail).toBeNull();
    });

    it('parseDetail: non-object JSON (e.g. "123") does not throw; financeDetail is null', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DP001',
        financeTxnDetailJson: '123',
        travelRuleTxnDetailJson: null,
        fundsOrders: [],
      });

      const result: any = await service.findOneForAdmin('dep-1');

      expect(result.financeDetail).toBeNull();
    });

    it('parseDetail: null elements in matchedRules/applicantActions are filtered out, valid entries survive', async () => {
      const jsonWithNulls = JSON.stringify({
        verdict: 'GREEN',
        scoringResult: {
          score: 87,
          matchedRules: [null, { id: 'A', name: 'x', action: 'reject', score: 5 }],
          applicantActions: [null, { applicantActionId: 'act-1' }],
        },
      });
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DP001',
        financeTxnDetailJson: jsonWithNulls,
        travelRuleTxnDetailJson: null,
        fundsOrders: [],
      });

      const result: any = await service.findOneForAdmin('dep-1');

      expect(result.financeDetail.matchedRules).toEqual([
        { id: 'A', name: 'x', action: 'reject', score: 5 },
      ]);
      expect(result.financeDetail.applicantActionIds).toEqual(['act-1']);
    });

    // 终审 Minor #2:matchedRules/applicantActions 已 .filter(Boolean),但 typedTags 的
    // .map 此前没有 —— 含 null 元素的 typedTags 数组会在 `t.label` 上炸出 TypeError。
    it('parseDetail: null elements in typedTags are filtered out, does not throw, valid tags survive', async () => {
      const jsonWithNullTag = JSON.stringify({
        verdict: 'GREEN',
        typedTags: [null, { label: 'HIGH_RISK', type: 'system' }],
      });
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DP001',
        financeTxnDetailJson: jsonWithNullTag,
        travelRuleTxnDetailJson: null,
        fundsOrders: [],
      });

      const result: any = await service.findOneForAdmin('dep-1');

      expect(result.financeDetail.tags).toEqual(['HIGH_RISK']);
    });

    // 终审 Minor #6:生产 HttpSumsubTxnClient.getTxn 的 raw(= SumsubKytTxnResponse)没有
    // 顶层 verdict 字段,只有 scoringResult.action(Sumsub 规则动作)和
    // review.reviewResult.reviewAnswer。只有 fixtures 的 buildRawDetail 才塞了顶层
    // verdict —— 生产环境下 parseDetail.verdict 恒为 null,详情页 Verdict 行空白。
    // 回退到 scoringResult.action:它就是 Sumsub 的规则裁决,语义上等价。
    it('parseDetail: raw 无顶层 verdict、有 scoringResult.action=reject → verdict 回退取 scoringResult.action', async () => {
      const jsonNoTopLevelVerdict = JSON.stringify({
        id: 'txn-prod-1',
        scoringResult: { action: 'reject', score: 90 },
      });
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DP001',
        financeTxnDetailJson: jsonNoTopLevelVerdict,
        travelRuleTxnDetailJson: null,
        fundsOrders: [],
      });

      const result: any = await service.findOneForAdmin('dep-1');

      expect(result.financeDetail.verdict).toBe('reject');
    });

    it('returns approvals as single-header-only (no steps/step), regardless of status', async () => {
      approvalsService.list.mockResolvedValue({
        total: 2,
        items: [
          {
            approvalNo: 'APR-1',
            actionType: 'DEPOSIT_CONFISCATION',
            status: 'APPROVED',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            steps: [{ id: 'step-1', decision: 'APPROVE' }],
          },
          {
            approvalNo: 'APR-2',
            actionType: 'DEPOSIT_RETURN',
            status: 'REJECTED',
            createdAt: new Date('2026-01-02T00:00:00Z'),
            step: { id: 'step-2' },
          },
        ],
      });

      const result: any = await service.findOneForAdmin('dep-1');

      expect(approvalsService.list).toHaveBeenCalledWith(
        expect.objectContaining({ entityRef: 'dep-1' }),
      );
      expect(result.approvals).toEqual([
        {
          approvalNo: 'APR-1',
          actionType: 'DEPOSIT_CONFISCATION',
          status: 'APPROVED',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          approvalNo: 'APR-2',
          actionType: 'DEPOSIT_RETURN',
          status: 'REJECTED',
          createdAt: new Date('2026-01-02T00:00:00Z'),
        },
      ]);
      for (const a of result.approvals) {
        expect(a).not.toHaveProperty('steps');
        expect(a).not.toHaveProperty('step');
      }
    });
  });

});
