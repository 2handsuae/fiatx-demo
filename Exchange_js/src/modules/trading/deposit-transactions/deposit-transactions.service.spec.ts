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
  let auditLogsService: AuditLogsService;
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
              findFirst: jest.fn(),
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
            recordByActor: jest.fn().mockResolvedValue(undefined),
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
    auditLogsService = module.get<AuditLogsService>(AuditLogsService);
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

    // 评审 Important 1(a)，安全洞：customerScope 下 status 查询参数必须被
    // 静默忽略——否则 GET /deposit-transactions/my?status=FROZEN 直接把
    // 状态过滤器交给客户操控，返回非空就等于确认自己被冻。admin 侧的
    // status 参数行为必须一字不动。
    it('customerScope 下传 status=FROZEN 不会进 where 条件', async () => {
      ((prisma as any).depositTransaction.findMany as jest.Mock).mockResolvedValue([]);
      ((prisma as any).depositTransaction.count as jest.Mock).mockResolvedValue(0);

      await service.findAll(
        { status: DepositTransactionStatus.FROZEN } as any,
        { customerScope: true },
      );

      const calls = ((prisma as any).depositTransaction.findMany as jest.Mock).mock.calls;
      const where = calls[calls.length - 1][0].where;
      expect(where.status).toBeUndefined();
    });

    it('admin scope 下传 status=FROZEN 仍然进 where 条件', async () => {
      ((prisma as any).depositTransaction.findMany as jest.Mock).mockResolvedValue([]);
      ((prisma as any).depositTransaction.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ status: DepositTransactionStatus.FROZEN } as any);

      const calls = ((prisma as any).depositTransaction.findMany as jest.Mock).mock.calls;
      const where = calls[calls.length - 1][0].where;
      expect(where.status).toBe(DepositTransactionStatus.FROZEN);
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
    // B4（第四批）：L1 快照列。业主裁定「后端不管 tipping-off，只要保证页面上没有
    // 文字漏出」—— 快照在后端**可以**带 cause/holdReason 明细（下面这份就带着
    // CAPABILITY_RESTRICTED 与逐格 detail），客户面必须一个字都拿不到。
    // `toCustomerDepositView` 是构造式白名单（不是 `...item` 再删字段），新增列
    // 天生不外泄 —— 这行 + SENSITIVE_KEYS 里的 'l1Snapshot' 就是把这件事钉死，
    // 防止有人日后把它改回展开式。
    l1Snapshot: JSON.stringify({
      evaluatedAt: '2026-01-01T00:00:00.000Z',
      domain: 'DEPOSIT',
      verdict: 'HOLD',
      holdReason: 'CAPABILITY_RESTRICTED',
      tradingTier: 'BASIC',
      checks: [
        { code: 'CUSTOMER_RESTRICTION', outcome: 'FAIL', detail: '客户被限制账摁住 DEPOSIT 能力' },
      ],
    }),
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
    'l1Snapshot',
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
        // 评审 Important 1(b)，安全洞：SENSITIVE_FULL_ROW.status 是 'SEIZED'，
        // 但客户面必须收敛成 'COMPLIANCE_PENDING'——原样输出 'SEIZED' 正是
        // 本次要修的那个安全洞，见下方专门的 status 收敛 describe 块。
        status: 'COMPLIANCE_PENDING',
        amount: '500.00',
        createdAt: SENSITIVE_FULL_ROW.createdAt,
        // 复审 Critical 1：status 被收敛掉的同时，completedAt 也必须清空成
        // null——SENSITIVE_FULL_ROW.completedAt 是非空的
        // 2026-01-02T00:00:00Z（模拟真实 SEIZED 单落库后的样子），如果这里
        // 原样透传，客户面会看到"status=COMPLIANCE_PENDING 但已完成"这个
        // 正常处理中的单不可能出现的组合，本身就是可辨识信号。见下方
        // 「completedAt 收敛 (Critical 1)」describe 块。
        completedAt: null,
        txHash: '0xabc',
        referenceNo: 'REF-1',
        fromAddress: 'T_FROM',
        fromIban: null,
        asset: { currency: 'USDT', code: 'USDT', network: 'TRON', decimals: 6 },
      });
      // 2026-08-06 减法：顶层 actionSubmittedAt 已从白名单删除（前端已无消费者）。
      // 2026-08-18 材料请求账 Task 12：`actions`（子表逐条 action 的
      // {seq,submittedAt}）随专属子表一起物理删除——上面的 toEqual 不再列出
      // 这个键就是在断言它已经不在客户面响应体里，不需要额外的 not.toHaveProperty。
    });
  });

  // 评审 Important 1(b)，安全洞：客户面响应体里的 status 必须先经收敛，
  // 不能原样透传数据库里的真实状态字符串——否则渲染层（depositStatusView.ts）
  // 把 FROZEN/SEIZED/… 都渲染成 "PROCESSING" 的功夫全部作废，客户开
  // DevTools 直接读 Network 面板就能看到真实状态。见
  // deposit-transactions.service.ts 里 toCustomerDepositView 的文档注释。
  describe('toCustomerDepositView status 收敛 (Important 1，安全洞)', () => {
    const buildCustomerRow = (status: string) => ({
      id: 'd-collapse-1',
      depositNo: 'DEP-COLLAPSE-1',
      ownerId: 'cust-1',
      status,
      amount: '10.00',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      completedAt: null,
      txHash: null,
      referenceNo: null,
      fromAddress: null,
      fromIban: null,
      asset: { currency: 'USDT', code: 'USDT', network: 'TRON', decimals: 6, type: 'CRYPTO' },
      limitHoldReason: null,
      actionSubmittedAt: null,
    });

    it.each([
      'FROZEN',
      'SEIZING',
      'SEIZED',
      'MANUAL_CHECKING',
      'CONFISCATING',
      'CONFISCATED',
      'OPERATION_PENDING',
    ])('%s → COMPLIANCE_PENDING（必须与正常处理中逐字段一致，不能原样下发）', async (rawStatus) => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(
        buildCustomerRow(rawStatus),
      );

      const result = (await service.findOneForCustomer('d-collapse-1', 'cust-1')) as any;

      expect(result.status).toBe('COMPLIANCE_PENDING');
    });

    // 复审 Important 1：收敛集从黑名单反转成白名单，这七个是白名单——只有
    // 它们原样输出，其余（含下面这组遗留/假想未来态）一律收敛。
    it.each([
      'PAYIN_PENDING',
      'COMPLIANCE_PENDING',
      'ACTION_PENDING',
      'SUCCESS',
      'FAILED',
      'RETURNING',
      'RETURNED',
    ])('%s 原样输出（白名单放行的七个态之一，客户本就该看到真实结果）', async (rawStatus) => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(
        buildCustomerRow(rawStatus),
      );

      const result = (await service.findOneForCustomer('d-collapse-1', 'cust-1')) as any;

      expect(result.status).toBe(rawStatus);
    });

    // 复审 Important 1（本轮新增）：白名单放行制下，遗留的 REJECTED/EXPIRED
    // 行（状态机收窄前的产物）、以及任何假想的未来执法态，都不在白名单里，
    // 必须一律收敛——这正是黑名单版本会漏掉的那类洞：黑名单只挡它认识的
    // 七个态，遗留态和未来新增态都不在其中，会原样下发。
    it.each([
      'REJECTED',
      'EXPIRED',
      'SOME_FUTURE_ENFORCEMENT_STATE',
    ])('%s（不在白名单里，遗留态/假想未来态）→ COMPLIANCE_PENDING', async (rawStatus) => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(
        buildCustomerRow(rawStatus),
      );

      const result = (await service.findOneForCustomer('d-collapse-1', 'cust-1')) as any;

      expect(result.status).toBe('COMPLIANCE_PENDING');
    });

    // 业主定稿（2026-08-06，减法）：此前这里有一条短路——actionSubmittedAt
    // 非空时 ACTION_PENDING 也收敛成 COMPLIANCE_PENDING，是为了追平渲染层
    // 当时的 submitted 短路（两层判据必须逐字保持同步，这套机制在最近两轮
    // 里连续制造了三个 Critical）。渲染层那条短路已被业主拆掉（见
    // depositStatusView.ts 文件头注释），这里的短路失去存在理由，一并删除：
    // toCustomerStatus 现在只接受 status 一个参数，ACTION_PENDING 不论客户
    // 交没交材料，原样下发。
    it('toCustomerStatus：ACTION_PENDING 原样输出，不再有第二参数或短路', () => {
      expect(service.toCustomerStatus('ACTION_PENDING')).toBe('ACTION_PENDING');
      expect(service.toCustomerStatus('SUCCESS')).toBe('SUCCESS');
    });

    // 新增回归（钉住新口径，防止有人手滑把短路加回来）：同一笔单，不论子表
    // 汇总出的 actionSubmittedAt（"是否已全部交齐"）是否非空，只要底层
    // status 仍是 ACTION_PENDING，客户面 status 都原样是 ACTION_PENDING——
    // 状态就是状态，不再因为一个客户看不见的字段在两种呈现之间跳变。
    it.each([null, new Date('2026-08-05T00:00:00Z')])(
      '新口径：ACTION_PENDING 原样下发，与 actionSubmittedAt 是否非空无关（actionSubmittedAt=%s）',
      async (actionSubmittedAt) => {
        ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
          ...buildCustomerRow('ACTION_PENDING'),
          actionSubmittedAt,
        });

        const result = (await service.findOneForCustomer('d-collapse-1', 'cust-1')) as any;

        expect(result.status).toBe('ACTION_PENDING');
      },
    );
  });

  // 复审 Critical 1（规则 A 的另一处漏洞）：status 被收敛掉的同时，
  // completedAt 也必须清空成 null，否则"status=COMPLIANCE_PENDING 但
  // completedAt 非空"这个正常处理中的单不可能出现的组合，本身就是一个新的
  // 可辨识信号（Deposit.tsx 还会因此多渲染一行 "Completed"）。
  describe('completedAt 收敛 (Critical 1，复审)', () => {
    const buildRow = (status: string, completedAt: Date | null) => ({
      id: 'd-completedat-1',
      depositNo: 'DEP-COMPLETEDAT-1',
      ownerId: 'cust-1',
      status,
      amount: '10.00',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      completedAt,
      txHash: null,
      referenceNo: null,
      fromAddress: null,
      fromIban: null,
      asset: { currency: 'USDT', code: 'USDT', network: 'TRON', decimals: 6, type: 'CRYPTO' },
      limitHoldReason: null,
      actionSubmittedAt: null,
    });

    it.each(['FROZEN', 'SEIZED', 'CONFISCATED'])(
      '%s（被收敛的状态）：completedAt 输出 null，即便底层行确实非空',
      async (rawStatus) => {
        ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(
          buildRow(rawStatus, new Date('2026-01-05T00:00:00Z')),
        );

        const result = (await service.findOneForCustomer(
          'd-completedat-1',
          'cust-1',
        )) as any;

        expect(result.completedAt).toBeNull();
      },
    );

    it.each(['SUCCESS', 'FAILED', 'RETURNED'])(
      '%s（正常终态，白名单内）：completedAt 照常输出，不能把正常的完成时间也吞掉',
      async (rawStatus) => {
        const completedAt = new Date('2026-01-05T00:00:00Z');
        ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(
          buildRow(rawStatus, completedAt),
        );

        const result = (await service.findOneForCustomer(
          'd-completedat-1',
          'cust-1',
        )) as any;

        expect(result.completedAt).toEqual(completedAt);
      },
    );

    // 终审 Critical（解冻后遗漏的一条弧）：`PAYIN_PENDING`/`COMPLIANCE_PENDING`/
    // `ACTION_PENDING`/`RETURNING` 都在 `CUSTOMER_STATUS_PASSTHROUGH` 白名单
    // 里、`status` 不会被收敛——但它们不是"完成态"，`completedAt` 仍必须是
    // null。这正是判据不能用 `statusWasCollapsed` 的地方：一笔真正冻结过又
    // 解冻回 `COMPLIANCE_PENDING` 的单，`status` 从未被收敛（进出都是
    // `COMPLIANCE_PENDING`），但底层行的 `completedAt` 是 `updateStatus`
    // 进 `FROZEN` 时写下、解冻时从未清除的非空时间戳；旧判据会把它原样
    // 透传出去。
    it.each(['PAYIN_PENDING', 'COMPLIANCE_PENDING', 'ACTION_PENDING', 'RETURNING'])(
      '%s（放行态但非完成态）：即便底层行 completedAt 非空（如解冻后遗留的旧时间戳），客户面仍输出 null',
      async (rawStatus) => {
        ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(
          buildRow(rawStatus, new Date('2026-01-05T00:00:00Z')),
        );

        const result = (await service.findOneForCustomer(
          'd-completedat-1',
          'cust-1',
        )) as any;

        expect(result.completedAt).toBeNull();
      },
    );

    // 本轮核心防护：同一笔单，一份走真实的 COMPLIANCE_PENDING（正常处理中），
    // 一份走真实冻结路径（service.updateStatus + FREEZE 动作——不是
    // `UPDATE ... SET status='FROZEN'` 直接改库；上一轮验收就是因为绕过了
    // updateStatus，completedAt 根本没被写，才没测出这个洞）。断言两份客户面
    // 输出**逐字段全等**，不只是比 status 一个字段——前几轮复审反复漏就是
    // 因为只盯单个字段。
    it('走真实冻结路径(updateStatus + freeze)：客户面输出与一笔正常处理中的单逐字段全等', async () => {
      const baseFields = {
        id: 'd-indist-1',
        depositNo: 'DEP-INDIST-1',
        ownerId: 'cust-1',
        ownerType: 'CUSTOMER',
        amount: '250.00',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        txHash: null,
        referenceNo: 'REF-INDIST',
        fromAddress: null,
        fromIban: 'IBAN-1',
        asset: { currency: 'EUR', code: 'EUR', network: null, decimals: 2, type: 'FIAT' },
        limitHoldReason: null,
        actionSubmittedAt: null,
        statusHistory: null,
      };

      // 甲：一笔真正在处理中的单，从未被冻。
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValueOnce({
        ...baseFields,
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        completedAt: null,
      });
      const normalView = await service.findOneForCustomer('d-indist-1', 'cust-1');

      // 乙：同一笔单的字段起点，走真实的 updateStatus(FREEZE) 冻结路径。
      const preFreezeRow = {
        ...baseFields,
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        completedAt: null,
      };
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValueOnce(
        preFreezeRow,
      );
      let persistedRow: any;
      ((prisma as any).depositTransaction.update as jest.Mock).mockImplementationOnce(
        ({ data }: any) => {
          persistedRow = { ...preFreezeRow, ...data };
          return Promise.resolve(persistedRow);
        },
      );
      await service.updateStatus('d-indist-1', {
        action: DepositTransactionAction.FREEZE,
      });

      // 冻结落库之后，客户再打开详情页——重读的是 updateStatus 真实写入的行。
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValueOnce(
        persistedRow,
      );
      const frozenView = await service.findOneForCustomer('d-indist-1', 'cust-1');

      expect(frozenView).toEqual(normalView);
    });

    // 终审 Critical：解冻之后的那条弧。同一笔单，一份从未被冻，一份走真实
    // 冻结(FREEZE)再真实解冻(RESUME)——复刻 `onUnfreezeApproved` 会调用的
    // 那条路径（`updateStatus(RESUME)`，不传 `extraData`）。断言两份客户面
    // 输出**逐字段全等**：这是"被冻过又解冻"的客户不能通过响应体看出自己
    // 被冻过的唯一保证。
    it('走真实冻结→解冻路径(updateStatus FREEZE 然后 RESUME)：客户面输出与一笔从未被冻的单逐字段全等', async () => {
      const baseFields = {
        id: 'd-unfreeze-1',
        depositNo: 'DEP-UNFREEZE-1',
        ownerId: 'cust-1',
        ownerType: 'CUSTOMER',
        amount: '250.00',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        txHash: null,
        referenceNo: 'REF-UNFREEZE',
        fromAddress: null,
        fromIban: 'IBAN-1',
        asset: { currency: 'EUR', code: 'EUR', network: null, decimals: 2, type: 'FIAT' },
        limitHoldReason: null,
        actionSubmittedAt: null,
        statusHistory: null,
      };

      // 甲：一笔真正从未被冻的处理中单。
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValueOnce({
        ...baseFields,
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        completedAt: null,
      });
      const neverFrozenView = await service.findOneForCustomer('d-unfreeze-1', 'cust-1');

      // 乙：同一笔单，先真实冻结(FREEZE)，再真实解冻(RESUME)——两次都经
      // `updateStatus`，不是直接改库。
      let currentRow: any = {
        ...baseFields,
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        completedAt: null,
      };
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValueOnce(
        currentRow,
      );
      ((prisma as any).depositTransaction.update as jest.Mock).mockImplementationOnce(
        ({ data }: any) => {
          currentRow = { ...currentRow, ...data };
          return Promise.resolve(currentRow);
        },
      );
      await service.updateStatus('d-unfreeze-1', {
        action: DepositTransactionAction.FREEZE,
      });

      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValueOnce(
        currentRow,
      );
      ((prisma as any).depositTransaction.update as jest.Mock).mockImplementationOnce(
        ({ data }: any) => {
          currentRow = { ...currentRow, ...data };
          return Promise.resolve(currentRow);
        },
      );
      await service.updateStatus('d-unfreeze-1', {
        action: DepositTransactionAction.RESUME,
      });

      // 解冻落库之后，底层行的 completedAt 仍是冻结时写下的非空时间戳——
      // RESUME 没有传 extraData 去清它，这正是本 bug 的成因。
      expect(currentRow.status).toBe(DepositTransactionStatus.COMPLIANCE_PENDING);
      expect(currentRow.completedAt).not.toBeNull();

      // 客户再打开详情页——重读的是真实写入的行。
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValueOnce(
        currentRow,
      );
      const unfrozenView = await service.findOneForCustomer('d-unfreeze-1', 'cust-1');

      expect(unfrozenView).toEqual(neverFrozenView);
    });
  });

  // 客户面历史筛选下拉改按「渲染出的桶」而非原始 status 过滤（2026-08-04，
  // task-6 增补）。业主定稿（2026-08-06，减法）：ACTION_PENDING 不再按
  // 「是否已提交」拆成两半——渲染层/接口层都已删掉 actionSubmittedAt 短路，
  // 筛选桶跟着收口：ACTION_REQUIRED 桶恒装全部 ACTION_PENDING，不再区分
  // 提交与否。下面用一个最小 Prisma-where 求值器，直接拿 findAll 真正
  // 构造出的 where 片段去匹配虚构行，而不是仅断言 where 的字面结构——这样
  // 才能在「桶定义漏写一个条件」时被测试真正抓到。
  describe('findAll 客户面筛选桶 (bucket)', () => {
    type BucketRow = { status: string };

    // 评审 Important 2：PROCESSING 桶从白名单枚举改成补集定义（NOT{OR:[...]}），
    // 求值器要能读懂 NOT，否则测不出补集语义。
    const matchesBucketWhere = (row: BucketRow, where: Record<string, any>): boolean =>
      Object.entries(where).every(([key, cond]) => {
        if (key === 'OR') {
          return (cond as any[]).some((sub) => matchesBucketWhere(row, sub));
        }
        if (key === 'NOT') {
          return !matchesBucketWhere(row, cond as Record<string, any>);
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

    const PAYIN_PENDING: BucketRow = { status: 'PAYIN_PENDING' };
    const COMPLIANCE_PENDING: BucketRow = { status: 'COMPLIANCE_PENDING' };
    const FROZEN: BucketRow = { status: 'FROZEN' };
    const SEIZING: BucketRow = { status: 'SEIZING' };
    const SEIZED: BucketRow = { status: 'SEIZED' };
    const MANUAL_CHECKING: BucketRow = { status: 'MANUAL_CHECKING' };
    const ACTION_PENDING: BucketRow = { status: 'ACTION_PENDING' };
    const SUCCESS: BucketRow = { status: 'SUCCESS' };

    it('PROCESSING 桶覆盖全部渲染成 PROCESSING 的态，不含 ACTION_PENDING', async () => {
      const where = await captureWhere({ bucket: 'PROCESSING' } as any, { customerScope: true });

      for (const row of [PAYIN_PENDING, COMPLIANCE_PENDING, FROZEN, SEIZING, SEIZED, MANUAL_CHECKING]) {
        expect(matchesBucketWhere(row, where)).toBe(true);
      }
      // ACTION_PENDING 恒渲染成 ACTION REQUIRED（不论是否已提交），2026-08-06
      // 简化后不再有"已提交的 ACTION_PENDING 算 PROCESSING"这个特例。
      expect(matchesBucketWhere(ACTION_PENDING, where)).toBe(false);
    });

    // 评审 Important 2：PROCESSING 桶此前是白名单枚举，漏了 OPERATION_PENDING
    // ——它渲染成 PROCESSING（getDepositStatusView 的 DEFAULT_VIEW 兜底），
    // 却不在任何桶里；CONFISCATING/CONFISCATED 同理。改成补集定义（不落在
    // 另外五个桶里的一切）后，这三个状态、以及任何未来新增的未映射状态，
    // 都天生落进 PROCESSING，不需要再靠人手工补一条。
    it('PROCESSING 桶是补集定义——OPERATION_PENDING/CONFISCATING/CONFISCATED/假想的未来状态都落进来', async () => {
      const where = await captureWhere({ bucket: 'PROCESSING' } as any, { customerScope: true });

      const OPERATION_PENDING: BucketRow = { status: 'OPERATION_PENDING' };
      const CONFISCATING: BucketRow = { status: 'CONFISCATING' };
      const CONFISCATED: BucketRow = { status: 'CONFISCATED' };
      // 白名单式定义永远漏不掉的类别：一个状态机里还不存在、测试写下这行时
      // 才假想出来的状态。补集定义天然接住它，不需要有人记得手工加进桶里。
      const HYPOTHETICAL_FUTURE_STATUS: BucketRow = { status: 'SOME_FUTURE_STATUS' };

      for (const row of [OPERATION_PENDING, CONFISCATING, CONFISCATED, HYPOTHETICAL_FUTURE_STATUS]) {
        expect(matchesBucketWhere(row, where)).toBe(true);
      }
    });

    it('ACTION_REQUIRED 桶装全部 ACTION_PENDING，不再区分是否已提交（2026-08-06 简化）', async () => {
      const where = await captureWhere({ bucket: 'ACTION_REQUIRED' } as any, { customerScope: true });

      expect(matchesBucketWhere(ACTION_PENDING, where)).toBe(true);
      expect(matchesBucketWhere(FROZEN, where)).toBe(false);
      expect(matchesBucketWhere(SUCCESS, where)).toBe(false);
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
        // 同上：'SEIZED' 收敛成 'COMPLIANCE_PENDING'。
        status: 'COMPLIANCE_PENDING',
        amount: '500.00',
        createdAt: SENSITIVE_FULL_ROW.createdAt,
        // 复审 Critical 1：status 被收敛的同时 completedAt 也必须清空，见
        // findAllForCustomer 那份同名断言上的注释。
        completedAt: null,
        txHash: '0xabc',
        referenceNo: 'REF-1',
        fromAddress: 'T_FROM',
        fromIban: null,
        asset: { currency: 'USDT', code: 'USDT', network: 'TRON', decimals: 6 },
      });
      // 2026-08-06 减法：顶层 actionSubmittedAt 已从白名单删除；2026-08-18
      // 材料请求账 Task 12：`actions` 同样已删除，见 findAllForCustomer 那份
      // 同名断言上的注释。
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
    // §二定稿的 26 条边 + 2026-08-13 新增 2 条 − 2026-08-22 退役 1 条 = 27 条边逐条列出
    // ——多一条、少一条、边指向变了,这里都会红。同时用穷举(14 状态 × 15 动作)反向断言:
    // 凡不在这 27 条边名单里的组合,一律必须抛 Invalid action/Cannot apply action
    // (即没有偷偷长出第 28 条边)。
    // 2026-08-13 新增两条:
    //   OPERATION_PENDING --freeze--> FROZEN            钱在暂扣里等处置,制裁命中必须冻得住
    //   CONFISCATING --confiscate_failed--> OPERATION_PENDING  A1 没收腿失败解锁后退回待处置
    // 2026-08-22 退役一条(A3,业主定稿「重试三次仍不行就原地不动+标红」):
    //   CONFISCATING --confiscate_failed--> OPERATION_PENDING  没收腿改重试三级梯,耗尽
    //   后原地留 CONFISCATING + 置 needsReview 红标,与退回/上缴弧同形状,不再退状态。
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
      { from: DepositTransactionStatus.OPERATION_PENDING, action: DepositTransactionAction.FREEZE, to: DepositTransactionStatus.FROZEN },

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

    describe('state machine integrity guard (27-edge brief)', () => {
      it('brief lists exactly 27 edges', () => {
        expect(EXPECTED_EDGES).toHaveLength(27);
      });

      it('CONFISCATING 只剩 confiscate_settle 一条出边（confiscate_failed 已退役）', () => {
        expect(() =>
          (service as any).getNextStatus(
            DepositTransactionStatus.CONFISCATING,
            'confiscate_failed' as any,
          ),
        ).toThrow(/Invalid|not allowed|无效/i);

        expect(
          (service as any).getNextStatus(
            DepositTransactionStatus.CONFISCATING,
            DepositTransactionAction.CONFISCATE_SETTLE,
          ),
        ).toBe(DepositTransactionStatus.CONFISCATED);
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

      it('every (status, action) pair NOT in the 27-edge list throws (no undocumented edge exists)', async () => {
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

    describe('SLA deadline 在状态机收口处统一设', () => {
      it('进入 COMPLIANCE_PENDING 时设 5 分钟 deadline', async () => {
        setupMock(DepositTransactionStatus.PAYIN_PENDING);
        const before = Date.now();

        const updated = await service.updateStatus(mockId, {
          action: DepositTransactionAction.PAYIN_CONFIRMED,
        });

        expect(updated.status).toBe(DepositTransactionStatus.COMPLIANCE_PENDING);
        const delta = new Date(updated.slaDeadline).getTime() - before;
        expect(delta).toBeGreaterThan(4 * 60_000);
        expect(delta).toBeLessThan(6 * 60_000);
        expect(updated.slaBreached).toBe(false);
      });

      it('进入无 SLA 的状态时把 deadline 清空', async () => {
        setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);

        const updated = await service.updateStatus(mockId, {
          action: DepositTransactionAction.APPROVE,
        });

        expect(updated.status).toBe(DepositTransactionStatus.SUCCESS);
        expect(updated.slaDeadline).toBeNull();
      });
    });
  });

  describe('setSlaDeadlineByNo (演示用「模拟超时」端点)', () => {
    it('按 depositNo 查不到单时抛 NotFoundException', async () => {
      ((prisma as any).depositTransaction.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.setSlaDeadlineByNo('DEP-MISSING', new Date(), {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('slaDeadline 为 null（不计时状态）时抛 BadRequestException，不落库不写审计', async () => {
      ((prisma as any).depositTransaction.findFirst as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        slaDeadline: null,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
      });

      await expect(
        service.setSlaDeadlineByNo('DEP0001', new Date(), {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect((prisma as any).depositTransaction.update).not.toHaveBeenCalled();
      expect((auditLogsService as any).recordByActor).not.toHaveBeenCalled();
    });

    it('单据在 SLA 计时状态时把 deadline 拨过去并写审计', async () => {
      const pastDate = new Date(Date.now() - 1000);
      ((prisma as any).depositTransaction.findFirst as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        slaDeadline: new Date(Date.now() + 5 * 60_000),
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
      });
      ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        slaDeadline: pastDate,
      });

      const result = await service.setSlaDeadlineByNo('DEP0001', pastDate, {
        actorId: 'admin-1',
        actorRole: 'OPERATOR',
      });

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        data: { slaDeadline: pastDate },
      });
      expect((auditLogsService as any).recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPOSIT_SLA_TIMEOUT_SIMULATED',
          entityType: 'DEPOSIT_TRANSACTION',
          entityId: 'dep-1',
          entityNo: 'DEP0001',
          requestId: expect.stringContaining('SLA_TIMEOUT_SIMULATED'),
        }),
        expect.objectContaining({ actorType: 'ADMIN', actorId: 'admin-1', actorRole: 'OPERATOR' }),
      );
      expect(result.slaDeadline).toEqual(pastDate);
    });

    it('同一张单连续两次模拟超时，产出不同的 requestId（幂等键不能恒定，否则第二条审计被静默丢弃）', async () => {
      const pastDate = new Date(Date.now() - 1000);
      ((prisma as any).depositTransaction.findFirst as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        slaDeadline: new Date(Date.now() + 5 * 60_000),
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
      });
      ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        slaDeadline: pastDate,
      });

      await service.setSlaDeadlineByNo('DEP0001', pastDate, { actorId: 'admin-1', actorRole: 'OPERATOR' });
      await service.setSlaDeadlineByNo('DEP0001', pastDate, { actorId: 'admin-1', actorRole: 'OPERATOR' });

      const calls = (auditLogsService as any).recordByActor.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0].requestId).not.toBe(calls[1][0].requestId);
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

    // B4（第四批）：Gate 0 的 L1 快照落库出口。workflow 禁止直接写 domain 表
    // （铁律⑤），所以落库这一下必须由本 service 提供方法 —— 与 saveTxnDetail 同形状。
    it('saveL1Snapshot writes the l1Snapshot column only (no status/hold side effects)', async () => {
      const snapshot = JSON.stringify({ domain: 'DEPOSIT', verdict: 'PASS' });
      ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        l1Snapshot: snapshot,
      });

      const result = await service.saveL1Snapshot('dep-1', snapshot);

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        data: { l1Snapshot: snapshot },
      });
      expect(result.l1Snapshot).toBe(snapshot);
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

  describe('needsReview 红标', () => {
    it('markNeedsReview 只写 needsReview 一列，不碰状态', async () => {
      const update = jest.fn().mockResolvedValue({ id: 'd1', needsReview: true });
      (prisma as any).depositTransaction = { update };

      await service.markNeedsReview('d1');

      expect(update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { needsReview: true },
      });
    });

    it('clearNeedsReview 只写 needsReview 一列', async () => {
      const update = jest.fn().mockResolvedValue({ id: 'd1', needsReview: false });
      (prisma as any).depositTransaction = { update };

      await service.clearNeedsReview('d1');

      expect(update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { needsReview: false },
      });
    });
  });

});
