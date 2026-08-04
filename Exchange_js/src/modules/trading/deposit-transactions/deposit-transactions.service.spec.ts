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
            sumsubWebhookEvent: {
              findMany: jest.fn().mockResolvedValue([]),
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
    sumsubTxnId: 'sumsub-txn-1',
    sumsubTxnType: 'finance',
    sumsubVerdict: 'rejected',
    sumsubScore: 92,
    sumsubScoredAt: new Date('2026-01-01T00:05:00Z'),
    sumsubTxnDetailJson: '{"verdict":"rejected"}',
    counterpartyIsVasp: true,
    travelRuleTransferId: 'tr-transfer-1',
    counterpartyVasp: 'Some VASP Inc.',
    slaDeadline: new Date('2026-01-03T00:00:00Z'),
    slaBreached: true,
    actionSubmittedAt: new Date('2026-08-01T00:00:00Z'),
  };

  const SENSITIVE_KEYS = [
    'statusHistory',
    'manualReason',
    'sumsubTxnId',
    'sumsubTxnType',
    'sumsubVerdict',
    'sumsubScore',
    'sumsubScoredAt',
    'sumsubTxnDetailJson',
    'counterpartyIsVasp',
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
        actionSubmittedAt: SENSITIVE_FULL_ROW.actionSubmittedAt,
      });
    });
  });

  // 客户面历史筛选下拉改按「渲染出的桶」而非原始 status 过滤（2026-08-04，
  // task-6 增补）：ACTION_PENDING 按「是否已提交」劈成两半，已提交的渲染成
  // PROCESSING（getDepositStatusView 的短路），必须归进 PROCESSING 桶，
  // 否则该单被冻时会从 ACTION_REQUIRED 桶里消失，客户用筛选器就能看出自己
  // 这单出事了。下面用一个最小 Prisma-where 求值器，直接拿 findAll 真正
  // 构造出的 where 片段去匹配虚构行，而不是仅断言 where 的字面结构——这样
  // 才能在「桶定义漏写一个条件」时被测试真正抓到。
  describe('findAll 客户面筛选桶 (bucket)', () => {
    type BucketRow = { status: string; actionSubmittedAt: Date | null };

    const matchesBucketWhere = (row: BucketRow, where: Record<string, any>): boolean =>
      Object.entries(where).every(([key, cond]) => {
        if (key === 'OR') {
          return (cond as any[]).some((sub) => matchesBucketWhere(row, sub));
        }
        const actual = (row as any)[key];
        if (cond && typeof cond === 'object') {
          if ('in' in cond) return (cond.in as any[]).includes(actual);
          if ('not' in cond) return actual !== cond.not;
          throw new Error(`matchesBucketWhere: unsupported operator for ${key}: ${JSON.stringify(cond)}`);
        }
        return actual === cond;
      });

    const captureWhere = async (query: any, options?: { customerScope?: boolean }) => {
      ((prisma as any).depositTransaction.findMany as jest.Mock).mockResolvedValue([]);
      ((prisma as any).depositTransaction.count as jest.Mock).mockResolvedValue(0);

      await service.findAll(query, options);

      const calls = ((prisma as any).depositTransaction.findMany as jest.Mock).mock.calls;
      const where = { ...calls[calls.length - 1][0].where };
      // limitHoldReason/ownerId 是 customerScope 的通用副产物，与桶映射逻辑
      // 无关，测行匹配前先剥掉，避免虚构行需要无谓地携带这两个字段。
      delete where.limitHoldReason;
      delete where.ownerId;
      return where;
    };

    const PAYIN_PENDING: BucketRow = { status: 'PAYIN_PENDING', actionSubmittedAt: null };
    const COMPLIANCE_PENDING: BucketRow = { status: 'COMPLIANCE_PENDING', actionSubmittedAt: null };
    const FROZEN: BucketRow = { status: 'FROZEN', actionSubmittedAt: null };
    const SEIZING: BucketRow = { status: 'SEIZING', actionSubmittedAt: null };
    const SEIZED: BucketRow = { status: 'SEIZED', actionSubmittedAt: null };
    const MANUAL_CHECKING: BucketRow = { status: 'MANUAL_CHECKING', actionSubmittedAt: null };
    const ACTION_PENDING_UNSUBMITTED: BucketRow = { status: 'ACTION_PENDING', actionSubmittedAt: null };
    const submittedAt = new Date('2026-08-01T00:00:00Z');
    const ACTION_PENDING_SUBMITTED: BucketRow = { status: 'ACTION_PENDING', actionSubmittedAt: submittedAt };
    const FROZEN_SUBMITTED: BucketRow = { status: 'FROZEN', actionSubmittedAt: submittedAt };
    const SUCCESS: BucketRow = { status: 'SUCCESS', actionSubmittedAt: null };

    it('PROCESSING 桶覆盖全部渲染成 PROCESSING 的态（含已提交的 ACTION_PENDING）', async () => {
      const where = await captureWhere({ bucket: 'PROCESSING' } as any, { customerScope: true });

      for (const row of [
        PAYIN_PENDING,
        COMPLIANCE_PENDING,
        FROZEN,
        SEIZING,
        SEIZED,
        MANUAL_CHECKING,
        ACTION_PENDING_SUBMITTED,
      ]) {
        expect(matchesBucketWhere(row, where)).toBe(true);
      }
      // 未提交的 ACTION_PENDING 渲染成 ACTION REQUIRED，不属于 PROCESSING。
      expect(matchesBucketWhere(ACTION_PENDING_UNSUBMITTED, where)).toBe(false);
    });

    it('ACTION_REQUIRED 桶只含未提交的 ACTION_PENDING', async () => {
      const where = await captureWhere({ bucket: 'ACTION_REQUIRED' } as any, { customerScope: true });

      expect(matchesBucketWhere(ACTION_PENDING_UNSUBMITTED, where)).toBe(true);
      expect(matchesBucketWhere(ACTION_PENDING_SUBMITTED, where)).toBe(false);
      expect(matchesBucketWhere(FROZEN, where)).toBe(false);
      expect(matchesBucketWhere(SUCCESS, where)).toBe(false);
    });

    it('提交过的单从 ACTION_PENDING 变 FROZEN，前后都落在 PROCESSING 桶里（筛选器不泄密）', async () => {
      const processingWhere = await captureWhere({ bucket: 'PROCESSING' } as any, { customerScope: true });
      const actionRequiredWhere = await captureWhere({ bucket: 'ACTION_REQUIRED' } as any, { customerScope: true });

      // 提交后，无论此刻状态机是仍卡在 ACTION_PENDING 还是已经被冻，都必须
      // 落在 PROCESSING 桶——与 depositStatusView 的短路（绑 actionSubmittedAt
      // 而非 status）保持一致。
      expect(matchesBucketWhere(ACTION_PENDING_SUBMITTED, processingWhere)).toBe(true);
      expect(matchesBucketWhere(FROZEN_SUBMITTED, processingWhere)).toBe(true);

      // 核心防线：提交过的单绝不能再落回 ACTION_REQUIRED 桶——否则客户在
      // "补料请求" 筛选器下仍能看到这单，从而分辨出它和别的单不一样。
      expect(matchesBucketWhere(ACTION_PENDING_SUBMITTED, actionRequiredWhere)).toBe(false);
      expect(matchesBucketWhere(FROZEN_SUBMITTED, actionRequiredWhere)).toBe(false);
    });

    it('未知桶名 → 不加 status 约束、不抛错', async () => {
      const where = await captureWhere({ bucket: 'NOT_A_REAL_BUCKET' } as any, { customerScope: true });

      expect(where.status).toBeUndefined();
      expect(where.OR).toBeUndefined();
    });

    it('admin scope 不受桶映射影响，仍按 status 参数过滤', async () => {
      const where = await captureWhere({
        status: DepositTransactionStatus.ACTION_PENDING,
        bucket: 'PROCESSING',
      } as any);

      expect(where.status).toBe(DepositTransactionStatus.ACTION_PENDING);
      expect(where.OR).toBeUndefined();
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
        actionSubmittedAt: SENSITIVE_FULL_ROW.actionSubmittedAt,
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

    it('MANUAL_CHECKING → ACTION_PENDING via action_pending (Sumsub officer 把 RED 改回等客户补料)', async () => {
      setupMock(DepositTransactionStatus.MANUAL_CHECKING);
      await service.updateStatus(mockId, { action: DepositTransactionAction.ACTION_PENDING });
      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ACTION_PENDING' }) }),
      );
    });

    it('OPERATION_PENDING → CONFISCATING via confiscate_start', async () => {
      setupMock(DepositTransactionStatus.OPERATION_PENDING);
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
      setupMock(DepositTransactionStatus.OPERATION_PENDING);
      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.CONFISCATE_START },
          { sourcePlatform: 'ADMIN_API', actor: { actorType: 'ADMIN', actorId: 'a1' } }),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'DEPOSIT_APPROVE_WORKFLOW_ONLY' }) });
    });

    it('COMPLIANCE_PENDING → OPERATION_PENDING via operation_pending', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);
      await service.updateStatus(mockId, { action: DepositTransactionAction.OPERATION_PENDING });
      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.OPERATION_PENDING }),
        }),
      );
    });

    it('OPERATION_PENDING → SUCCESS via approve (放行)', async () => {
      setupMock(DepositTransactionStatus.OPERATION_PENDING);
      await service.updateStatus(mockId, { action: DepositTransactionAction.APPROVE });
      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.SUCCESS }),
        }),
      );
    });

    it('COMPLIANCE_PENDING 不再直接 confiscate_start —— 没收入口已上移到 OPERATION_PENDING', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);
      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.CONFISCATE_START }),
      ).rejects.toThrow(/Invalid action/);
    });

    // 终审 Critical 2 回归闸:approveDeposit 的 oldStatus 白名单接受 ACTION_PENDING/
    // MANUAL_CHECKING,但金额闸下沉后调用的 operation_pending 边此前只从
    // COMPLIANCE_PENDING 出发存在——两边前置条件对不上,below-min 单从这两个状态被
    // approve 翻案时,金额闸自己在转移表这层抛 Invalid action。
    it('ACTION_PENDING → OPERATION_PENDING via operation_pending(金额闸下沉后,补料后的 below-min 单必须能落地)', async () => {
      setupMock(DepositTransactionStatus.ACTION_PENDING);
      await service.updateStatus(mockId, { action: DepositTransactionAction.OPERATION_PENDING });
      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.OPERATION_PENDING }),
        }),
      );
    });

    it('MANUAL_CHECKING → OPERATION_PENDING via operation_pending(误报翻案的 below-min 单必须能落地)', async () => {
      setupMock(DepositTransactionStatus.MANUAL_CHECKING);
      await service.updateStatus(mockId, { action: DepositTransactionAction.OPERATION_PENDING });
      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.OPERATION_PENDING }),
        }),
      );
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

    it('ACTION_PENDING → MANUAL_CHECKING via sla_breach', async () => {
      setupMock(DepositTransactionStatus.ACTION_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.SLA_BREACH,
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

    it('FROZEN rejects invalid actions (confiscate/return no longer direct from FROZEN — must resume first)', async () => {
      setupMock(DepositTransactionStatus.FROZEN);

      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.ACTION_PENDING }),
      ).rejects.toThrow(BadRequestException);
    });

    it('COMPLIANCE_PENDING → MANUAL_CHECKING via kyt_rejected', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);

      await service.updateStatus(mockId, {
        action: DepositTransactionAction.KYT_REJECTED,
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

    // 守则性测试(防转移表再次漂移):brief `doc-final/superpowers/sdd/statemachine-brief.md`
    // §二定稿的 26 条边逐条列出——多一条、少一条、边指向变了,这里都会红。同时用穷举
    // (14 状态 × 15 动作)反向断言:凡不在这 26 条边名单里的组合,一律必须抛
    // Invalid action/Cannot apply action(即没有偷偷长出的第 27 条边)。
    const EXPECTED_EDGES: Array<{
      from: DepositTransactionStatus;
      action: DepositTransactionAction;
      to: DepositTransactionStatus;
    }> = [
      { from: DepositTransactionStatus.PAYIN_PENDING, action: DepositTransactionAction.PAYIN_CONFIRMED, to: DepositTransactionStatus.COMPLIANCE_PENDING },
      { from: DepositTransactionStatus.PAYIN_PENDING, action: DepositTransactionAction.FAIL, to: DepositTransactionStatus.FAILED },

      { from: DepositTransactionStatus.COMPLIANCE_PENDING, action: DepositTransactionAction.APPROVE, to: DepositTransactionStatus.SUCCESS },
      { from: DepositTransactionStatus.COMPLIANCE_PENDING, action: DepositTransactionAction.OPERATION_PENDING, to: DepositTransactionStatus.OPERATION_PENDING },
      { from: DepositTransactionStatus.COMPLIANCE_PENDING, action: DepositTransactionAction.ACTION_PENDING, to: DepositTransactionStatus.ACTION_PENDING },
      { from: DepositTransactionStatus.COMPLIANCE_PENDING, action: DepositTransactionAction.SLA_BREACH, to: DepositTransactionStatus.MANUAL_CHECKING },
      { from: DepositTransactionStatus.COMPLIANCE_PENDING, action: DepositTransactionAction.KYT_REJECTED, to: DepositTransactionStatus.MANUAL_CHECKING },
      { from: DepositTransactionStatus.COMPLIANCE_PENDING, action: DepositTransactionAction.FREEZE, to: DepositTransactionStatus.FROZEN },

      { from: DepositTransactionStatus.ACTION_PENDING, action: DepositTransactionAction.APPROVE, to: DepositTransactionStatus.SUCCESS },
      { from: DepositTransactionStatus.ACTION_PENDING, action: DepositTransactionAction.OPERATION_PENDING, to: DepositTransactionStatus.OPERATION_PENDING },
      { from: DepositTransactionStatus.ACTION_PENDING, action: DepositTransactionAction.SLA_BREACH, to: DepositTransactionStatus.MANUAL_CHECKING },
      { from: DepositTransactionStatus.ACTION_PENDING, action: DepositTransactionAction.KYT_REJECTED, to: DepositTransactionStatus.MANUAL_CHECKING },
      { from: DepositTransactionStatus.ACTION_PENDING, action: DepositTransactionAction.FREEZE, to: DepositTransactionStatus.FROZEN },
      { from: DepositTransactionStatus.ACTION_PENDING, action: DepositTransactionAction.RESUME, to: DepositTransactionStatus.COMPLIANCE_PENDING },

      { from: DepositTransactionStatus.OPERATION_PENDING, action: DepositTransactionAction.APPROVE, to: DepositTransactionStatus.SUCCESS },
      { from: DepositTransactionStatus.OPERATION_PENDING, action: DepositTransactionAction.CONFISCATE_START, to: DepositTransactionStatus.CONFISCATING },

      { from: DepositTransactionStatus.MANUAL_CHECKING, action: DepositTransactionAction.APPROVE, to: DepositTransactionStatus.SUCCESS },
      { from: DepositTransactionStatus.MANUAL_CHECKING, action: DepositTransactionAction.OPERATION_PENDING, to: DepositTransactionStatus.OPERATION_PENDING },
      { from: DepositTransactionStatus.MANUAL_CHECKING, action: DepositTransactionAction.ACTION_PENDING, to: DepositTransactionStatus.ACTION_PENDING },
      { from: DepositTransactionStatus.MANUAL_CHECKING, action: DepositTransactionAction.FREEZE, to: DepositTransactionStatus.FROZEN },
      { from: DepositTransactionStatus.MANUAL_CHECKING, action: DepositTransactionAction.RETURN, to: DepositTransactionStatus.RETURNING },

      { from: DepositTransactionStatus.FROZEN, action: DepositTransactionAction.RESUME, to: DepositTransactionStatus.COMPLIANCE_PENDING },
      { from: DepositTransactionStatus.FROZEN, action: DepositTransactionAction.SEIZE, to: DepositTransactionStatus.SEIZING },

      { from: DepositTransactionStatus.CONFISCATING, action: DepositTransactionAction.CONFISCATE_SETTLE, to: DepositTransactionStatus.CONFISCATED },
      { from: DepositTransactionStatus.RETURNING, action: DepositTransactionAction.RETURNED_DONE, to: DepositTransactionStatus.RETURNED },
      { from: DepositTransactionStatus.SEIZING, action: DepositTransactionAction.SEIZED_DONE, to: DepositTransactionStatus.SEIZED },
    ];

    describe('state machine integrity guard (26-edge brief)', () => {
      it('brief lists exactly 26 edges', () => {
        expect(EXPECTED_EDGES).toHaveLength(26);
      });

      it.each(
        EXPECTED_EDGES.map((e) => [`${e.from} --${e.action}--> ${e.to}`, e] as const),
      )('%s', async (_label, edge) => {
        setupMock(edge.from);
        await service.updateStatus(mockId, { action: edge.action });
        expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: edge.to }),
          }),
        );
      });

      it('every (status, action) pair NOT in the 26-edge list throws (no undocumented edge exists)', async () => {
        const edgeKeys = new Set(
          EXPECTED_EDGES.map((e) => `${e.from}::${e.action}`),
        );
        const allStatuses = Object.values(DepositTransactionStatus);
        const allActions = Object.values(DepositTransactionAction);

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

    it('detected(): counterpartyIsVasp true → written through to deposit create data', async () => {
      await service.detected({
        assetId: 'a1',
        toWalletId: 'w1',
        amount: '100',
        counterpartyIsVasp: true,
      });
      expect(prisma.depositTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ counterpartyIsVasp: true }) }),
      );
    });

    it('detected(): counterpartyIsVasp false → written through as false, not coerced to true', async () => {
      await service.detected({
        assetId: 'a1',
        toWalletId: 'w1',
        amount: '100',
        counterpartyIsVasp: false,
      });
      expect(prisma.depositTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ counterpartyIsVasp: false }) }),
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
    const sumsubJson = JSON.stringify({
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
        sumsubTxnDetailJson: sumsubJson,
        fundsOrders: [],
      });
    });

    it('parses sumsubTxnDetailJson into sumsubDetail (score/matchedRules/applicantActionIds)', async () => {
      const result: any = await service.findOneForAdmin('dep-1');

      expect(result.sumsubDetail.score).toBe(87);
      expect(result.sumsubDetail.matchedRules).toEqual([
        { id: 'rule-1', name: 'High risk country', action: 'block', score: 50 },
      ]);
      expect(result.sumsubDetail.applicantActionIds).toEqual(['act-1', 'act-2']);
    });

    it('parseDetail: sumsubTxnDetailJson = "null" (valid JSON, value null) does not throw; sumsubDetail is null', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DP001',
        sumsubTxnDetailJson: 'null',
        fundsOrders: [],
      });

      const result: any = await service.findOneForAdmin('dep-1');

      expect(result.sumsubDetail).toBeNull();
    });

    it('parseDetail: non-object JSON (e.g. "123") does not throw; sumsubDetail is null', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DP001',
        sumsubTxnDetailJson: '123',
        fundsOrders: [],
      });

      const result: any = await service.findOneForAdmin('dep-1');

      expect(result.sumsubDetail).toBeNull();
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
        sumsubTxnDetailJson: jsonWithNulls,
        fundsOrders: [],
      });

      const result: any = await service.findOneForAdmin('dep-1');

      expect(result.sumsubDetail.matchedRules).toEqual([
        { id: 'A', name: 'x', action: 'reject', score: 5 },
      ]);
      expect(result.sumsubDetail.applicantActionIds).toEqual(['act-1']);
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
        sumsubTxnDetailJson: jsonWithNullTag,
        fundsOrders: [],
      });

      const result: any = await service.findOneForAdmin('dep-1');

      expect(result.sumsubDetail.tags).toEqual(['HIGH_RISK']);
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
        sumsubTxnDetailJson: jsonNoTopLevelVerdict,
        fundsOrders: [],
      });

      const result: any = await service.findOneForAdmin('dep-1');

      expect(result.sumsubDetail.verdict).toBe('reject');
    });

    // Task 7: parseDetail 新增回显官方字段 reviewStatus/reviewAnswer(来自
    // review.reviewStatus / review.reviewResult.reviewAnswer)。
    it('parseDetail: review.reviewStatus/reviewResult.reviewAnswer surfaced verbatim on sumsubDetail', async () => {
      const jsonWithReview = JSON.stringify({
        scoringResult: { action: 'reject', score: 90 },
        review: { reviewStatus: 'completed', reviewResult: { reviewAnswer: 'RED' } },
      });
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DP001',
        sumsubTxnDetailJson: jsonWithReview,
        fundsOrders: [],
      });

      const result: any = await service.findOneForAdmin('dep-1');

      expect(result.sumsubDetail.reviewStatus).toBe('completed');
      expect(result.sumsubDetail.reviewAnswer).toBe('RED');
    });

    it('latestSumsubWebhook: no lookup when sumsubTxnId is absent', async () => {
      const result: any = await service.findOneForAdmin('dep-1');

      expect(result.latestSumsubWebhook).toBeNull();
      expect((prisma as any).sumsubWebhookEvent.findMany).not.toHaveBeenCalled();
    });

    // Task 7: 一笔单只有一个 Sumsub 交易 —— 反查按 sumsubTxnId 单值匹配,不再按
    // 「泳道」拆两个 txnId 做 OR 查询,也不再从 rawPayload 里反推 lane。
    it('latestSumsubWebhook: looks up the single sumsubTxnId, returns the most recent event verbatim', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DP001',
        sumsubTxnId: 'txn-abc123',
        sumsubTxnDetailJson: sumsubJson,
        fundsOrders: [],
      });
      ((prisma as any).sumsubWebhookEvent.findMany as jest.Mock).mockResolvedValue([
        {
          eventNo: 'EVT-1',
          eventType: 'txnStatusChanged',
          status: 'PROCESSED',
          receivedAt: new Date('2026-01-01T00:00:00Z'),
          processedAt: new Date('2026-01-01T00:00:05Z'),
          lastErrorMessage: null,
          isSimulated: false,
        },
      ]);

      const result: any = await service.findOneForAdmin('dep-1');

      expect((prisma as any).sumsubWebhookEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { rawPayload: { contains: '"txn-abc123"' } },
        }),
      );
      expect(result.latestSumsubWebhook).toEqual({
        eventNo: 'EVT-1',
        eventType: 'txnStatusChanged',
        status: 'PROCESSED',
        receivedAt: new Date('2026-01-01T00:00:00Z'),
        processedAt: new Date('2026-01-01T00:00:05Z'),
        lastErrorMessage: null,
        isSimulated: false,
      });
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

  describe('applicant action 字段读写', () => {
    const DEADLINE = new Date('2026-08-11T00:00:00Z');

    it('setActionRefs 写两个 id、清提交戳、重置 SLA', async () => {
      ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue({});

      await service.setActionRefs('d-1', 'aa-1', 'EXT-1', DEADLINE);

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        data: {
          sumsubActionId: 'aa-1',
          sumsubExternalActionId: 'EXT-1',
          actionSubmittedAt: null,
          slaDeadline: DEADLINE,
          slaBreached: false,
        },
      });
    });

    it('markActionSubmitted 首次盖戳并重置 SLA（resetSla=true）', async () => {
      ((prisma as any).depositTransaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const r = await service.markActionSubmitted('d-1', DEADLINE, true);

      expect(r.changed).toBe(true);
      expect((prisma as any).depositTransaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'd-1', actionSubmittedAt: null },
          data: expect.objectContaining({ slaDeadline: DEADLINE, slaBreached: false }),
        }),
      );
    });

    it('markActionSubmitted 幂等：已有提交戳则不覆写', async () => {
      ((prisma as any).depositTransaction.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      const r = await service.markActionSubmitted('d-1', DEADLINE, true);

      expect(r.changed).toBe(false);
    });

    it('markActionSubmitted 用单条带条件的更新（无 TOCTOU 窗口）', async () => {
      ((prisma as any).depositTransaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const r = await service.markActionSubmitted('d-1', DEADLINE, true);

      expect(r.changed).toBe(true);
      expect((prisma as any).depositTransaction.updateMany).toHaveBeenCalledWith({
        where: { id: 'd-1', actionSubmittedAt: null },   // ← 条件写在 where 里，由 DB 保证互斥
        data: expect.objectContaining({ slaDeadline: DEADLINE, slaBreached: false }),
      });
      // 读-改-写的两步式已被取代，不应再有先读一次的动作
      expect((prisma as any).depositTransaction.findUnique).not.toHaveBeenCalled();
    });

    it('markActionSubmitted 并发落败方拿到 changed:false（匹配 0 行）', async () => {
      ((prisma as any).depositTransaction.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(service.markActionSubmitted('d-1', DEADLINE, true)).resolves.toEqual({ changed: false });
    });

    // 评审 Important 2：resetSla=false 时，actionSubmittedAt 仍要无条件盖上
    // （客户端"已收到"文案绑它），但 slaDeadline/slaBreached 这两个 operator
    // 可见字段必须原样保留——不能因为客户点了提交，就把 SLA 定时器已经打上的
    // 违约旗（slaBreached=true）冲掉。冲掉后 findSlaBreachCandidates 不扫
    // MANUAL_CHECKING，这条违约记录就永久消失了。
    it('markActionSubmitted resetSla=false → 只盖 actionSubmittedAt，不碰 slaDeadline/slaBreached', async () => {
      ((prisma as any).depositTransaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const r = await service.markActionSubmitted('d-1', DEADLINE, false);

      expect(r.changed).toBe(true);
      expect((prisma as any).depositTransaction.updateMany).toHaveBeenCalledWith({
        where: { id: 'd-1', actionSubmittedAt: null },
        data: { actionSubmittedAt: expect.any(Date) },
      });
    });
  });

});
