import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SwapTransactionsService,
  SWAP_TERMINAL_STATUSES,
  SWAP_FREEZE_SCAN_EXCLUDED,
} from './swap-transactions.service';
import { SwapTransactionStatus, SwapTransactionAction } from './dto/swap-transaction.dto';

describe('SwapTransactionsService', () => {
  let service: SwapTransactionsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      swapTransaction: {
        findUnique: jest.fn(),
      },
      fundsOrder: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    service = new SwapTransactionsService(
      prisma as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      { recordByActor: jest.fn() } as any,
      { resolve: jest.fn().mockResolvedValue({ blocked: new Set() }) } as any,
    );
  });

  it('should return swap detail without including legacy auditLogs relation', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue({
      id: 'swap-1',
      swapNo: 'SWP0001',
      statusHistory: '[]',
    });

    const result = await service.findOne('swap-1');

    expect(prisma.swapTransaction.findUnique).toHaveBeenCalledWith({
      where: { id: 'swap-1' },
      include: {
        fromAsset: true,
        toAsset: true,
        // 第四批：限制账真数据（此前详情页读 CustomerMain 上一个不存在的
        // 列 `restrictions`，侧栏恒显示 None）。一行一个 scope，只取 OPEN。
        customer: {
          include: {
            restrictionRows: {
              where: { status: 'OPEN' },
              select: { restrictionNo: true, cause: true, scope: true, visibility: true },
            },
          },
        },
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'swap-1',
        swapNo: 'SWP0001',
        statusHistory: '[]',
      }),
    );
  });

  it('should throw when swap detail is missing', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('findOne returns internalFunds (legs ordered by legSeq then attempt) and no legacy fundsOrders', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue({
      id: 'swap-2',
      swapNo: 'SWP0002',
    });
    prisma.fundsOrder.findMany.mockResolvedValue([
      { id: 'leg-0', legSeq: 0, attempt: 1, status: 'CLEAR' },
      { id: 'leg-1', legSeq: 1, attempt: 1, status: 'PENDING' },
    ]);

    const result = await service.findOne('swap-2');

    expect(prisma.fundsOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { swapTransactionId: 'swap-2' },
        orderBy: [{ legSeq: 'asc' }, { attempt: 'asc' }],
      }),
    );
    expect(result.fundsOrders).toBeUndefined();
    expect(Array.isArray(result.internalFunds)).toBe(true);
    expect(result.internalFunds).toHaveLength(2);
    expect(result.internalFunds[0].id).toBe('leg-0');
  });
});

describe('markStatus transitions', () => {
  let service: SwapTransactionsService;

  beforeEach(() => {
    service = new SwapTransactionsService({} as any, {} as any, {} as any, { emit: jest.fn() } as any, { recordByActor: jest.fn() } as any, { resolve: jest.fn().mockResolvedValue({ blocked: new Set() }) } as any);
  });

  it('COMPLIANCE_PENDING + kyt_approved → PROCESSING', async () => {
    const swap = { id: 's1', status: 'COMPLIANCE_PENDING' };
    const tx = {
      swapTransaction: {
        findUnique: jest.fn().mockResolvedValue(swap),
        update: jest.fn().mockResolvedValue({ ...swap, status: 'PROCESSING' }),
      },
    } as any;
    const next = await service.markStatus('s1', SwapTransactionAction.KYT_APPROVED, tx);
    expect(next).toBe('PROCESSING');
  });

  it('COMPLIANCE_PENDING + kyt_rejected → REJECTED', async () => {
    const tx = {
      swapTransaction: {
        findUnique: jest.fn().mockResolvedValue({ id: 's1', status: 'COMPLIANCE_PENDING' }),
        update: jest.fn().mockResolvedValue({ id: 's1', status: 'REJECTED' }),
      },
    } as any;
    expect(await service.markStatus('s1', SwapTransactionAction.KYT_REJECTED, tx)).toBe('REJECTED');
  });

  it('终态不可推进：REJECTED + kyt_approved 抛错', async () => {
    const tx = {
      swapTransaction: { findUnique: jest.fn().mockResolvedValue({ id: 's1', status: 'REJECTED' }) },
    } as any;
    await expect(service.markStatus('s1', SwapTransactionAction.KYT_APPROVED, tx))
      .rejects.toThrow(/Invalid transition/);
  });

  it('非法跳步：COMPLIANCE_PENDING + success 抛错', async () => {
    const tx = {
      swapTransaction: { findUnique: jest.fn().mockResolvedValue({ id: 's1', status: 'COMPLIANCE_PENDING' }) },
    } as any;
    await expect(service.markStatus('s1', SwapTransactionAction.SUCCESS, tx))
      .rejects.toThrow(/Invalid transition/);
  });

  it('COMPLIANCE_PENDING + kyt_approved → PROCESSING 时清空 slaDeadline（PROCESSING 无 SLA 配置）', async () => {
    const swap = { id: 's1', status: 'COMPLIANCE_PENDING' };
    const tx = {
      swapTransaction: {
        findUnique: jest.fn().mockResolvedValue(swap),
        update: jest.fn().mockResolvedValue({ ...swap, status: 'PROCESSING' }),
      },
    } as any;
    await service.markStatus('s1', SwapTransactionAction.KYT_APPROVED, tx);
    expect(tx.swapTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slaDeadline: null, slaBreached: false }),
      }),
    );
  });

  it('markStatus stamps opts.operator into statusHistory (defaults SYSTEM)', async () => {
    const swap = { id: 's1', status: 'COMPLIANCE_PENDING' };
    const tx = {
      swapTransaction: {
        findUnique: jest.fn().mockResolvedValue(swap),
        update: jest.fn().mockResolvedValue({ ...swap, status: 'PROCESSING' }),
      },
    } as any;

    await service.markStatus('s1', SwapTransactionAction.KYT_APPROVED, tx, { operator: 'SLA_SWEEP' });
    const taggedHistory = JSON.parse(tx.swapTransaction.update.mock.calls[0][0].data.statusHistory);
    expect(taggedHistory[taggedHistory.length - 1].operator).toBe('SLA_SWEEP');

    await service.markStatus('s1', SwapTransactionAction.KYT_APPROVED, tx);
    const defaultHistory = JSON.parse(tx.swapTransaction.update.mock.calls[1][0].data.statusHistory);
    expect(defaultHistory[defaultHistory.length - 1].operator).toBe('SYSTEM');
  });
});

describe('SLA deadline 在状态机收口处统一设', () => {
  let service: SwapTransactionsService;

  beforeEach(() => {
    service = new SwapTransactionsService({} as any, {} as any, {} as any, { emit: jest.fn() } as any, { recordByActor: jest.fn() } as any, { resolve: jest.fn().mockResolvedValue({ blocked: new Set() }) } as any);
  });

  it('建单进入 COMPLIANCE_PENDING 时设 5 分钟 deadline', async () => {
    const before = Date.now();
    const tx = {
      swapTransaction: {
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'swap-new', ...data }),
        ),
      },
    } as any;

    const created = await service.create(
      {
        swapNo: 'SWP-SLA-1',
        quoteId: 'q1',
        quoteNo: 'Q1',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        ownerNo: 'C1',
        fromAssetId: 'a1',
        fromAssetCode: 'USDT',
        fromAmount: new Prisma.Decimal('100'),
        toAssetId: 'a2',
        toAssetCode: 'AED',
        toAmount: new Prisma.Decimal('367'),
        netToAmount: new Prisma.Decimal('365'),
        feeAmount: new Prisma.Decimal('2'),
        feeCurrency: 'AED',
        feeBreakdown: null,
        spreadAmount: new Prisma.Decimal('0'),
        exchangeRate: new Prisma.Decimal('3.67'),
        traceId: 't1',
        status: SwapTransactionStatus.COMPLIANCE_PENDING,
      },
      tx,
    );

    expect(created.status).toBe(SwapTransactionStatus.COMPLIANCE_PENDING);
    expect(created.slaDeadline).not.toBeNull();
    const delta = new Date(created.slaDeadline as Date).getTime() - before;
    expect(delta).toBeGreaterThan(4 * 60_000);
    expect(delta).toBeLessThan(6 * 60_000);
    expect(created.slaBreached).toBe(false);
  });
});

// Finding 1 (Critical, task-10 review): the customer-facing read paths must
// return an allow-listed view, not the raw findOne row — the raw row carries
// compliance-investigation fields (matched Sumsub rule names, reject reason,
// the full Sumsub payload, verdict/action, txn ids) that would tip off a
// customer under sanctions investigation. Mirrors
// withdraw-transactions.service.spec.ts's toCustomerWithdrawView coverage.
describe('customer-facing tipping-off whitelist (findOneForCustomer / findOneForCustomerBySwapNo / findAllForCustomer)', () => {
  let service: SwapTransactionsService;
  let prisma: any;

  const fullRow = {
    id: 'swap-c1',
    swapNo: 'SWP0100',
    quoteId: 'quote-1',
    quoteNo: 'QT001',
    quoteSnapshotRef: 'quote-1',
    ownerType: 'CUSTOMER',
    ownerId: 'cust-1',
    ownerNo: 'C0001',
    status: 'COMPLIANCE_PENDING',
    currentStage: 'SELL',
    needsReview: true,
    fromAssetId: 'asset-from',
    fromAssetCode: 'USDT',
    fromAmount: '100',
    toAssetId: 'asset-to',
    toAssetCode: 'AED',
    toAmount: '367',
    netToAmount: '365',
    feeAmount: '2',
    feeCurrency: 'AED',
    feeBreakdown: '[]',
    exchangeRate: '3.67',
    failureReason: null,
    statusHistory: '[]',
    sumsubTxnIdOut: 'txn-out-1',
    sumsubTxnIdIn: 'txn-in-1',
    complianceVerdict: 'GREEN',
    complianceAction: 'allow',
    complianceRuleNames: 'High risk country,Sanctions match',
    sumsubDetailJson: JSON.stringify({ scoringResult: { action: 'allow' } }),
    rejectReason: 'KYT_REJECTED',
    spreadAmount: '1.5',
    grossAedValue: '367',
    tbFromTransferId: 'tb-1',
    tbToTransferId: 'tb-2',
    tbFeeTransferId: 'tb-3',
    tbSpreadTransferId: 'tb-4',
    traceId: 'trace-1',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    completedAt: null,
    fromAsset: { id: 'asset-from', currency: 'USDT', code: 'USDT', type: 'CRYPTO', network: 'TRON', decimals: 6 },
    toAsset: { id: 'asset-to', currency: 'AED', code: 'AED', type: 'FIAT', network: null, decimals: 2 },
    customer: { id: 'cust-1', customerNo: 'C0001', sumsubApplicantId: 'applicant-1' },
  };

  beforeEach(() => {
    prisma = {
      swapTransaction: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      fundsOrder: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new SwapTransactionsService(prisma as any, {} as any, {} as any, { emit: jest.fn() } as any, { recordByActor: jest.fn() } as any, { resolve: jest.fn().mockResolvedValue({ blocked: new Set() }) } as any);
  });

  describe('findOneForCustomer', () => {
    it('strips every compliance/investigation field and keeps only what the customer legitimately needs', async () => {
      prisma.swapTransaction.findUnique.mockResolvedValue(fullRow);

      const result: any = await service.findOneForCustomer('swap-c1', 'cust-1');

      // Must never reach the customer (Finding 1's named fields).
      expect(result.complianceRuleNames).toBeUndefined();
      expect(result.rejectReason).toBeUndefined();
      expect(result.sumsubDetailJson).toBeUndefined();
      expect(result.complianceVerdict).toBeUndefined();
      expect(result.complianceAction).toBeUndefined();
      expect(result.sumsubTxnIdOut).toBeUndefined();
      expect(result.sumsubTxnIdIn).toBeUndefined();

      // Other internal-only fields that must also not leak.
      expect(result.traceId).toBeUndefined();
      expect(result.ownerId).toBeUndefined();
      expect(result.ownerNo).toBeUndefined();
      expect(result.statusHistory).toBeUndefined();
      expect(result.internalFunds).toBeUndefined();
      expect(result.customer).toBeUndefined();
      expect(result.needsReview).toBeUndefined();
      expect(result.currentStage).toBeUndefined();

      // What the customer legitimately needs: amounts, assets, status, swapNo, timestamps.
      expect(result).toEqual({
        id: 'swap-c1',
        swapNo: 'SWP0100',
        status: 'COMPLIANCE_PENDING',
        fromAmount: '100',
        toAmount: '367',
        netToAmount: '365',
        feeAmount: '2',
        feeCurrency: 'AED',
        exchangeRate: '3.67',
        createdAt: fullRow.createdAt,
        completedAt: null,
        fromAsset: { currency: 'USDT', code: 'USDT', network: 'TRON', decimals: 6 },
        toAsset: { currency: 'AED', code: 'AED', network: null, decimals: 2 },
        // Task 4：详情增强新增字段（feeBreakdown 为 '[]' → 三键空/null 兜底；
        // statusHistory 为 '[]' → timeline 只剩出生一条）。
        quoteNo: 'QT001',
        feeLines: [],
        marketRate: null,
        spreadPercent: null,
        timeline: [{ status: 'COMPLIANCE_PENDING', at: fullRow.createdAt.toISOString() }],
        // 丙波二 T4：非 SUCCESS 单恒 null（确认单只给收敛态 SUCCESS）。
        confirmation: null,
      });
    });

    it('throws ForbiddenException when the swap belongs to a different customer (IDOR guard)', async () => {
      prisma.swapTransaction.findUnique.mockResolvedValue(fullRow);

      await expect(
        service.findOneForCustomer('swap-c1', 'someone-else'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException when the swap does not exist', async () => {
      prisma.swapTransaction.findUnique.mockResolvedValue(null);

      await expect(
        service.findOneForCustomer('missing', 'cust-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findAllForCustomer', () => {
    it('scopes the query to the caller and strips compliance fields from every item', async () => {
      prisma.swapTransaction.findMany.mockResolvedValue([fullRow]);
      prisma.swapTransaction.count.mockResolvedValue(1);

      const result: any = await service.findAllForCustomer('cust-1', {} as any);

      expect(prisma.swapTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ ownerId: 'cust-1', ownerType: 'CUSTOMER' }),
        }),
      );
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].complianceRuleNames).toBeUndefined();
      expect(result.items[0].sumsubDetailJson).toBeUndefined();
      expect(result.items[0].rejectReason).toBeUndefined();
      expect(result.items[0].swapNo).toBe('SWP0100');
    });

    it('a caller-supplied ownerId/ownerType in the query cannot override the caller identity (IDOR guard)', async () => {
      prisma.swapTransaction.findMany.mockResolvedValue([]);
      prisma.swapTransaction.count.mockResolvedValue(0);

      await service.findAllForCustomer('cust-1', {
        ownerId: 'someone-else',
        ownerType: 'LP',
      } as any);

      expect(prisma.swapTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ ownerId: 'cust-1', ownerType: 'CUSTOMER' }),
        }),
      );
    });
  });

  // D4 修复轮（审查 I-4）：详情独立页那条新路径此前零测试。要防的回归很具体
  // ——有人把 findOneForCustomerBySwapNo 的 where 里 ownerId 拿掉（理由现成：
  // 「反正 findOneForCustomer 里还有一层 owner 校验」），越权立刻从 404 静默
  // 降级成 403「Not your swap transaction」：单号存不存在被答了出去，存在性
  // 泄漏当场重开，而 tsc 绿、jest 绿、grep 绿、页面照常渲染，没有任何闸门会响。
  // 两条与 withdraw-transactions.service.spec.ts 的同名用例同构。
  describe('findOneForCustomerBySwapNo', () => {
    // findFirst 用一张假表模拟真实过滤语义（而不是恒定返回值）——where 少一个
    // 条件命中的行就会变多，删 ownerId 这种变异才会真的把用例打红。
    const seedFindFirst = () => {
      prisma.swapTransaction.findFirst = jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(
            Object.entries(where).every(([k, v]) => (fullRow as any)[k] === v)
              ? { id: fullRow.id }
              : null,
          ),
        );
      prisma.swapTransaction.findUnique.mockResolvedValue(fullRow);
    };

    it('IDOR miss（单号真实存在但不属于该客户）→ 与「单子不存在」完全相同的 404，不是 403', async () => {
      seedFindFirst();

      await expect(
        service.findOneForCustomerBySwapNo('SWP0100', 'someone-else'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('命中 → where 同时锁 swapNo + ownerId，且走 findOneForCustomer 同一套白名单', async () => {
      seedFindFirst();

      const result: any = await service.findOneForCustomerBySwapNo('SWP0100', 'cust-1');

      expect(prisma.swapTransaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { swapNo: 'SWP0100', ownerId: 'cust-1' },
        }),
      );
      expect(result.complianceRuleNames).toBeUndefined();
      expect(result.rejectReason).toBeUndefined();
      expect(result.sumsubDetailJson).toBeUndefined();
      expect(result.statusHistory).toBeUndefined();
      expect(result.needsReview).toBeUndefined();
      expect(result.swapNo).toBe('SWP0100');
    });
  });
});

// Task 10: 兑换客户面三层防线。Task 8 给 SwapTransactionStatus 加了 FROZEN
// （零出边终态，客户本人命中制裁）之后，客户面此前"没有一层防线"的三个洞
// 同时打开：响应体原样透传 status、筛选面 ?status=FROZEN 无门可挡、未来新增
// 状态无收敛机制。三层都要堵，逐条覆盖。
describe('Task 10: 客户面三层防线', () => {
  let service: SwapTransactionsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      swapTransaction: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      fundsOrder: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new SwapTransactionsService(prisma as any, {} as any, {} as any, { emit: jest.fn() } as any, { recordByActor: jest.fn() } as any, { resolve: jest.fn().mockResolvedValue({ blocked: new Set() }) } as any);
  });

  describe('响应体：FROZEN 收敛成 COMPLIANCE_PENDING（不原样透传）', () => {
    // 2026-09-14 裁定翻案：FROZEN 从零出边终态改成押锁不放的中间态，客户面
    // 收敛目标从 REJECTED 改成 COMPLIANCE_PENDING —— 与充值/提现一致
    // （"状态跟钱走"：钱押着就显示处理中），不再谎报"已拒绝"。
    it('toCustomerSwapStatus(FROZEN) === COMPLIANCE_PENDING', () => {
      expect(service.toCustomerSwapStatus('FROZEN')).toBe('COMPLIANCE_PENDING');
    });

    it('findOneForCustomer 对一笔 FROZEN 单返回 status: COMPLIANCE_PENDING，客户视图里看不到 FROZEN 字面量', async () => {
      prisma.swapTransaction.findUnique.mockResolvedValue({
        id: 'swap-frozen-1',
        swapNo: 'SWP0999',
        status: 'FROZEN',
        ownerId: 'cust-1',
        createdAt: new Date('2026-09-15T00:00:00.000Z'),
      });

      const result: any = await service.findOneForCustomer('swap-frozen-1', 'cust-1');

      expect(result.status).toBe('COMPLIANCE_PENDING');
      expect(result.status).not.toBe('FROZEN');
    });

    it('白名单内的四个正常态原样透传，不被误收敛', () => {
      expect(service.toCustomerSwapStatus('COMPLIANCE_PENDING')).toBe('COMPLIANCE_PENDING');
      expect(service.toCustomerSwapStatus('PROCESSING')).toBe('PROCESSING');
      expect(service.toCustomerSwapStatus('SUCCESS')).toBe('SUCCESS');
      expect(service.toCustomerSwapStatus('REJECTED')).toBe('REJECTED');
    });
  });

  describe('白名单兜底：未列入白名单的状态（含未来新增）一律收敛成 COMPLIANCE_PENDING', () => {
    it('一个假造的未来执法态字符串被收敛成 COMPLIANCE_PENDING，而不是原样透传', () => {
      expect(service.toCustomerSwapStatus('SOME_FUTURE_ENFORCEMENT_STATE')).toBe(
        'COMPLIANCE_PENDING',
      );
    });
  });

  describe('筛选面：customerScope 下 status 查询参数按客户可见值展开成原始状态集合过滤', () => {
    it('客户传 COMPLIANCE_PENDING → where.status.in 同时含 COMPLIANCE_PENDING 与 FROZEN（两者客户可见值都是 COMPLIANCE_PENDING；2026-09-14 裁定翻案后 FROZEN 离开了 REJECTED 桶）', async () => {
      await service.findAllForCustomer('cust-1', { status: 'COMPLIANCE_PENDING' } as any);

      const where = prisma.swapTransaction.findMany.mock.calls[0][0].where;
      expect(where.status.in.slice().sort()).toEqual(['COMPLIANCE_PENDING', 'FROZEN']);
      // 展开集合里每一个原始状态，客户可见值都必须真的等于客户传入的
      // COMPLIANCE_PENDING —— 不是巧合命中，是收敛函数本身保证的。
      for (const raw of where.status.in) {
        expect(service.toCustomerSwapStatus(raw)).toBe('COMPLIANCE_PENDING');
      }
    });

    it('客户传 SUCCESS → where.status.in 只含 SUCCESS，不含其它', async () => {
      await service.findAllForCustomer('cust-1', { status: 'SUCCESS' } as any);

      const where = prisma.swapTransaction.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({ in: ['SUCCESS'] });
    });

    it('客户传 FROZEN → 展开集合恒为空，where.status.in 为 []（精确零命中，非全量、非报错）', async () => {
      await expect(
        service.findAllForCustomer('cust-1', { status: 'FROZEN' } as any),
      ).resolves.toBeDefined();

      const where = prisma.swapTransaction.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({ in: [] });
      // 不是「status 键被删掉退化成全量」——键必须在，且集合必须是空数组。
      expect(where).toHaveProperty('status');
    });

    it('防漂移：展开集合必须是从 toCustomerSwapStatus 派生的——FROZEN 与 COMPLIANCE_PENDING 恒落同一个桶（不再是 REJECTED 桶）', () => {
      const compliancePendingBucket = Object.values(SwapTransactionStatus).filter(
        (raw) => service.toCustomerSwapStatus(raw) === 'COMPLIANCE_PENDING',
      );
      expect(compliancePendingBucket).toEqual(expect.arrayContaining(['COMPLIANCE_PENDING', 'FROZEN']));

      // 非空性护栏：若把展开逻辑换回「原始值精确匹配」（不展开），这条断言必须翻红——
      // 见任务报告里贴的红/绿输出，这里只钉住不变量本身。
      const naiveExactMatchOnly = ['COMPLIANCE_PENDING'];
      expect(naiveExactMatchOnly).not.toEqual(expect.arrayContaining(['FROZEN']));

      // FROZEN 已经离开 REJECTED 桶——这是本轮翻案的核心断言，钉死不让它漂回去。
      const rejectedBucket = Object.values(SwapTransactionStatus).filter(
        (raw) => service.toCustomerSwapStatus(raw) === 'REJECTED',
      );
      expect(rejectedBucket).not.toEqual(expect.arrayContaining(['FROZEN']));
    });
  });

  // 2026-09-14：completedAt 白名单（镜像 withdraw-transactions.service.ts:51/448）。
  // FROZEN 单钱押着、处置还没定，即便行上带了脏 completedAt（不该有，但防御一下
  // 万一），客户视图也必须强制 null —— 否则客户能从"有没有完成时间"反推自己
  // 被冻结（tipping-off）。SUCCESS/REJECTED 是真终态，completedAt 照常透传。
  describe('客户视图 completedAt 白名单：只有 SUCCESS/REJECTED 落地态才透传 completedAt', () => {
    it('FROZEN 行带脏 completedAt → 客户视图强制 null；SUCCESS/REJECTED 正常透传', () => {
      const frozenAt = new Date('2026-01-01T00:00:00Z');
      const successAt = new Date('2026-01-02T00:00:00Z');
      const rejectedAt = new Date('2026-01-03T00:00:00Z');

      const createdAt = new Date('2025-12-31T00:00:00Z');
      const frozenView: any = service.toCustomerSwapView({
        id: 'swap-x', swapNo: 'SWP0300', status: 'FROZEN', completedAt: frozenAt, createdAt,
      });
      const successView: any = service.toCustomerSwapView({
        id: 'swap-y', swapNo: 'SWP0301', status: 'SUCCESS', completedAt: successAt, createdAt,
      });
      const rejectedView: any = service.toCustomerSwapView({
        id: 'swap-z', swapNo: 'SWP0302', status: 'REJECTED', completedAt: rejectedAt, createdAt,
      });

      expect(frozenView.completedAt).toBeNull();
      expect(successView.completedAt).toBe(successAt);
      expect(rejectedView.completedAt).toBe(rejectedAt);
    });
  });

  // D10（波五 T7）附带断言：L1 快照带具体因由+便签号后,管理台②格明文变多了
  // （SANCTION/ADMIN_SUSPENSION + restrictionNo）,客户面必须仍然一个字都拿不到——
  // toCustomerSwapView 是构造式白名单（不是 `...item` 再删字段）,新增列天生不
  // 外泄,这条测试把它钉死。镜像 deposit-transactions.service.spec.ts 的
  // SENSITIVE_FULL_ROW/SENSITIVE_KEYS 写法。
  describe('客户视图零暴露：toCustomerSwapView 不透出 l1Snapshot 等执法态字段（D10 附带断言）', () => {
    it('FROZEN 行带完整执法态字段（含 SANCTION 细节的 l1Snapshot）→ 客户视图只剩白名单字段', () => {
      const sensitiveRow: any = {
        id: 'swap-sens-1',
        swapNo: 'SWP-SENS-1',
        status: 'FROZEN',
        fromAmount: '100',
        toAmount: '365',
        netToAmount: '360',
        feeAmount: '5',
        feeCurrency: 'AED',
        exchangeRate: '3.6725',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        completedAt: null,
        fromAsset: { currency: 'USDT', code: 'USDT', network: 'TRON', decimals: 6 },
        toAsset: { currency: 'AED', code: 'AED', network: null, decimals: 2 },
        // 执法态字段——白名单外，绝不能漏出客户视图
        statusHistory: '[]',
        needsReview: true,
        currentStage: 'MLRO_REVIEW',
        traceId: 'trace-1',
        ownerId: 'cust-1',
        ownerNo: 'CU0001',
        quoteSnapshotRef: 'quote-1',
        tbFromTransferId: 'tb-1',
        tbToTransferId: 'tb-2',
        tbFeeTransferId: 'tb-3',
        tbSpreadTransferId: 'tb-4',
        grossAedValue: '365.00',
        failureReason: null,
        rejectReason: null,
        sumsubTxnIdOut: 'txn-out-1',
        sumsubTxnIdIn: 'txn-in-1',
        sumsubDetailJson: '{}',
        // D10：便签因由+号码明文写在这里——客户视图连这个字段本身都不能有
        l1Snapshot: JSON.stringify({
          evaluatedAt: '2026-01-01T00:00:00.000Z',
          domain: 'SWAP',
          verdict: 'BLOCK',
          holdReason: null,
          tradingTier: 'BASIC',
          checks: [
            {
              code: 'CUSTOMER_RESTRICTION',
              outcome: 'FAIL',
              detail: 'Customer restriction holds down SWAP — SANCTION (RST2601010001)',
            },
          ],
        }),
      };

      const view: any = service.toCustomerSwapView(sensitiveRow);

      expect(view).toEqual({
        id: 'swap-sens-1',
        swapNo: 'SWP-SENS-1',
        status: 'COMPLIANCE_PENDING', // FROZEN 不在白名单,收敛
        fromAmount: '100',
        toAmount: '365',
        netToAmount: '360',
        feeAmount: '5',
        feeCurrency: 'AED',
        exchangeRate: '3.6725',
        createdAt: sensitiveRow.createdAt,
        completedAt: null,
        fromAsset: { currency: 'USDT', code: 'USDT', network: 'TRON', decimals: 6 },
        toAsset: { currency: 'AED', code: 'AED', network: null, decimals: 2 },
        // Task 4：新增字段——quoteNo/feeBreakdown 未设 → 三键空/null 兜底；
        // timeline 只剩收敛后的出生一条（FROZEN → COMPLIANCE_PENDING）。
        quoteNo: null,
        feeLines: [],
        marketRate: null,
        spreadPercent: null,
        timeline: [{ status: 'COMPLIANCE_PENDING', at: sensitiveRow.createdAt.toISOString() }],
      });
      // 逐字符串扫描兜底：序列化结果里不能出现任何执法态词汇或 l1 字样的痕迹
      const serialized = JSON.stringify(view);
      expect(serialized).not.toMatch(/l1|CUSTOMER_RESTRICTION|SANCTION|needsReview|statusHistory|traceId/i);
    });
  });

  describe('admin 不受影响：非 customerScope 下 status 参数照常按原始值精确过滤', () => {
    it('admin 侧 findAll 传 status 时 where.status 照常写入原始值（非 { in: [...] } 展开形式）', async () => {
      await service.findAll({ status: 'FROZEN' } as any);

      expect(prisma.swapTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'FROZEN' }) }),
      );
    });

    it('admin 侧传 REJECTED 只精确匹配 REJECTED，不含 FROZEN', async () => {
      await service.findAll({ status: 'REJECTED' } as any);

      const where = prisma.swapTransaction.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('REJECTED');
    });
  });
});

// Finding 2 (Important, task-10 review): findOneForAdmin shipped with no
// spec coverage. Mirrors withdraw-transactions.service.spec.ts's
// describe('findOneForAdmin', ...) block (well-formed payload,
// malformed-JSON fallback, empty/absent complianceRuleNames).
describe('findOneForAdmin', () => {
  let service: SwapTransactionsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      swapTransaction: { findUnique: jest.fn() },
      fundsOrder: { findMany: jest.fn().mockResolvedValue([]) },
      // 第四批：admin 投影补材料请求活行（侧栏那格此前读一个不存在的列，恒 `—`）
      materialRequest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new SwapTransactionsService(prisma as any, {} as any, {} as any, { emit: jest.fn() } as any, { recordByActor: jest.fn() } as any, { resolve: jest.fn().mockResolvedValue({ blocked: new Set() }) } as any);
  });

  it('well-formed official-shape payload: parseDetail 输出提现同源形状（parity 2026-08-14）', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue({
      id: 'swap-a1',
      swapNo: 'SWP0200',
      sumsubTxnIdOut: 'txn-out-1',
      sumsubTxnIdIn: 'txn-in-1',
      complianceVerdict: 'rejected',
      complianceAction: 'reject',
      complianceRuleNames: 'High risk country,Sanctions match',
      rejectReason: 'KYT_REJECTED',
      sumsubDetailJson: JSON.stringify({
        review: { reviewStatus: 'completed', reviewResult: { reviewAnswer: 'RED' } },
        scoringResult: {
          action: 'reject',
          score: 90,
          matchedRules: [{ id: 'r1', name: 'High risk country', action: 'reject', score: 90 }],
          applicantActions: [{ applicantActionId: 'aa-1', externalActionId: 'ext-1' }],
        },
        typedTags: [{ label: 'SANCTION', type: 'userDefined' }],
      }),
    });

    const result: any = await service.findOneForAdmin('swap-a1');

    // toEqual 全量快照：任何字段的增删都会失败——契约漂移即红。
    expect(result.sumsubDetail).toEqual({
      verdict: 'reject',
      reviewStatus: 'completed',
      reviewAnswer: 'RED',
      score: 90,
      matchedRules: [{ id: 'r1', name: 'High risk country', action: 'reject', score: 90 }],
      applicantActionIds: ['aa-1'],
      tags: ['SANCTION'],
      raw: expect.objectContaining({ scoringResult: expect.anything() }),
      // swap 补充：双腿 txnId（提现单腿没有）
      txnIdOut: 'txn-out-1',
      txnIdIn: 'txn-in-1',
    });
    // 行级裸列仍在顶层（References 卡消费）
    expect(result.rejectReason).toBe('KYT_REJECTED');
    expect(result.complianceVerdict).toBe('rejected');
  });

  it('malformed sumsubDetailJson → sumsubDetail 为 null 而非抛错', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue({
      id: 'swap-a2',
      swapNo: 'SWP0201',
      sumsubTxnIdOut: null,
      sumsubTxnIdIn: null,
      complianceVerdict: null,
      complianceAction: null,
      complianceRuleNames: null,
      rejectReason: null,
      sumsubDetailJson: '{not valid json',
    });

    const result: any = await service.findOneForAdmin('swap-a2');

    expect(result.sumsubDetail).toBeNull();
  });

  it('无 sumsubDetailJson（如 TIMEOUT 单）→ sumsubDetail 为 null', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue({
      id: 'swap-a3',
      swapNo: 'SWP0202',
      sumsubTxnIdOut: null,
      sumsubTxnIdIn: null,
      complianceVerdict: null,
      complianceAction: null,
      complianceRuleNames: null,
      rejectReason: 'TIMEOUT',
      sumsubDetailJson: null,
    });

    const result: any = await service.findOneForAdmin('swap-a3');

    expect(result.sumsubDetail).toBeNull();
    expect(result.rejectReason).toBe('TIMEOUT');
  });

  // 第四批：详情页侧栏/References 卡的 `Material Requests` 那格。此前它读
  // CustomerMain 上一个不存在的 pending-action 指针列，恒显示 `—`。
  it('materialRequests 只带本单的活行（按 SWAP + swapNo + 活状态过滤）', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue({
      id: 'swap-a5',
      swapNo: 'SWP0203',
      sumsubDetailJson: null,
    });
    prisma.materialRequest.findMany.mockResolvedValue([
      { requestNo: 'MRQ0001', materialType: 'PROOF_OF_ADDRESS', status: 'PENDING_SUBMISSION' },
    ]);

    const result: any = await service.findOneForAdmin('swap-a5');

    expect(prisma.materialRequest.findMany).toHaveBeenCalledWith({
      where: {
        orderDomain: 'SWAP',
        orderRef: 'SWP0203',
        // 活行 = 客户还欠着材料；终态行（APPROVED/REJECTED/CANCELLED）不算
        status: { in: ['PENDING_SUBMISSION', 'SUBMITTED'] },
      },
      select: { requestNo: true, materialType: true, status: true },
    });
    expect(result.materialRequests).toHaveLength(1);
    expect(result.materialRequests[0].requestNo).toBe('MRQ0001');
  });

  it('saveSumsubVerdict 写在传入的 tx client 上（原子性另一半，配 workflow 层的同 tx 断言）', async () => {
    const tx: any = { swapTransaction: { update: jest.fn().mockResolvedValue({}) } };
    const scoredAt = new Date('2026-08-14T08:00:00Z');

    await service.saveSumsubVerdict(
      'swap-a4',
      { verdict: 'approved', score: 12, scoredAt, detailJson: '{"a":1}' },
      tx,
    );

    expect(tx.swapTransaction.update).toHaveBeenCalledWith({
      where: { id: 'swap-a4' },
      data: {
        complianceVerdict: 'approved',
        sumsubScore: 12,
        sumsubScoredAt: scoredAt,
        sumsubDetailJson: '{"a":1}',
      },
    });
    // 顶层 prisma 上绝不落
    expect(prisma.swapTransaction.findUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.anything() }),
    );
  });

  it('saveSumsubVerdict 省略 detailJson 时不覆写既有报文（undefined = Prisma 跳过该字段）', async () => {
    const tx: any = { swapTransaction: { update: jest.fn().mockResolvedValue({}) } };

    await service.saveSumsubVerdict(
      'swap-a5',
      { verdict: 'rejected', score: null, scoredAt: new Date() },
      tx,
    );

    const data = tx.swapTransaction.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('sumsubDetailJson');
    expect(data.sumsubScore).toBeNull();
  });
});

// Task 8: FROZEN 终态基础设施 —— 两个状态集合对 FROZEN 的归属故意相反
// （见 swap-transactions.service.ts 里两份 Set 上方的注释），本组测试锁死这一点。
describe('兑换状态机 · FROZEN', () => {
  it('FROZEN 与 FREEZE 已定义', () => {
    expect(SwapTransactionStatus.FROZEN).toBe('FROZEN');
    expect(SwapTransactionAction.FREEZE).toBe('freeze');
  });

  it('FROZEN 不进 SWAP_TERMINAL_STATUSES —— 进了会自动作废客户在途的材料请求（tipping-off）', () => {
    expect(SWAP_TERMINAL_STATUSES.has('FROZEN')).toBe(false);
  });

  it('FROZEN 进 SWAP_FREEZE_SCAN_EXCLUDED —— 已经冻了的单不再被冻结广播扫出来', () => {
    expect(SWAP_FREEZE_SCAN_EXCLUDED.has('FROZEN')).toBe(true);
    expect(SWAP_FREEZE_SCAN_EXCLUDED.has('SUCCESS')).toBe(true);
    expect(SWAP_FREEZE_SCAN_EXCLUDED.has('COMPLIANCE_PENDING')).toBe(false);
  });
});

describe('markStatus · FROZEN 迁移边', () => {
  let service: SwapTransactionsService;

  beforeEach(() => {
    service = new SwapTransactionsService({} as any, {} as any, {} as any, { emit: jest.fn() } as any, { recordByActor: jest.fn() } as any, { resolve: jest.fn().mockResolvedValue({ blocked: new Set() }) } as any);
  });

  it('COMPLIANCE_PENDING + freeze → FROZEN（唯一合法入边）', async () => {
    const tx = {
      swapTransaction: {
        findUnique: jest.fn().mockResolvedValue({ id: 's1', status: 'COMPLIANCE_PENDING' }),
        update: jest.fn().mockResolvedValue({ id: 's1', status: 'FROZEN' }),
      },
    } as any;
    expect(await service.markStatus('s1', SwapTransactionAction.FREEZE, tx)).toBe('FROZEN');
  });

  // 2026-09-14 裁定翻案：FROZEN 不再是零出边终态，改成押锁不放的中间态——
  // 唯一两条合法出边 RESUME（回 COMPLIANCE_PENDING，解冻续审）/ REJECT_REFUND
  // （落地终态 REJECTED，拒退）。审批消费方是 Task 3 的事，这里只钉状态机边。
  it('FROZEN 仅 RESUME/REJECT_REFUND 两条合法出边，其余动作抛 Invalid transition', async () => {
    const makeTx = () => ({
      swapTransaction: {
        findUnique: jest.fn().mockResolvedValue({ id: 's1', status: 'FROZEN' }),
        update: jest.fn().mockResolvedValue({ id: 's1' }),
      },
    }) as any;

    // 两条合法出边：落地目标与迁移表 FROZEN 行逐字一致。
    expect(await service.markStatus('s1', SwapTransactionAction.RESUME, makeTx()))
      .toBe('COMPLIANCE_PENDING');
    expect(await service.markStatus('s1', SwapTransactionAction.REJECT_REFUND, makeTx()))
      .toBe('REJECTED');

    // 其余动作仍非法——FROZEN 不会退化回真·零出边，也不会开放成任意跃迁。
    const txNoUpdate = {
      swapTransaction: { findUnique: jest.fn().mockResolvedValue({ id: 's1', status: 'FROZEN' }) },
    } as any;
    await expect(service.markStatus('s1', SwapTransactionAction.KYT_APPROVED, txNoUpdate))
      .rejects.toThrow(/Invalid transition/);
    await expect(service.markStatus('s1', SwapTransactionAction.KYT_REJECTED, txNoUpdate))
      .rejects.toThrow(/Invalid transition/);
    await expect(service.markStatus('s1', SwapTransactionAction.SUCCESS, txNoUpdate))
      .rejects.toThrow(/Invalid transition/);
    await expect(service.markStatus('s1', SwapTransactionAction.FREEZE, txNoUpdate))
      .rejects.toThrow(/Invalid transition/);
  });

  it('PROCESSING 阶段没有 freeze 出边（腿已开跑，冻结会留半截账）', async () => {
    const tx = {
      swapTransaction: { findUnique: jest.fn().mockResolvedValue({ id: 's1', status: 'PROCESSING' }) },
    } as any;
    await expect(service.markStatus('s1', SwapTransactionAction.FREEZE, tx))
      .rejects.toThrow(/Invalid transition/);
  });

  // Task 9 审查者点名：completedAt 只在 next===SUCCESS 时写。REJECTED 单和
  // FROZEN 单的 completedAt 都必须是 null/undefined、逐字相同——这是客户视图
  // 收敛(Task 10)之后两者不可分辨的隐含前提。显式断言，防止将来有人顺手在
  // markStatus 的 completedAt 三元表达式里给 FROZEN 加一支，开出 tipping-off
  // 推断信道（客户能从"有没有完成时间"反推自己是否被制裁冻结）。
  it('completedAt 保持 null —— FROZEN 不是 SUCCESS，不写完成时间（tipping-off 防线）', async () => {
    const update = jest.fn().mockResolvedValue({ id: 's1', status: 'FROZEN' });
    const tx = {
      swapTransaction: {
        findUnique: jest.fn().mockResolvedValue({ id: 's1', status: 'COMPLIANCE_PENDING' }),
        update,
      },
    } as any;

    await service.markStatus('s1', SwapTransactionAction.FREEZE, tx, { rejectReason: 'SANCTION_APPLICANT' });

    expect(update).toHaveBeenCalledTimes(1);
    const updateArg = update.mock.calls[0][0];
    expect(updateArg.data.completedAt).toBeUndefined();
    expect(updateArg.data.status).toBe('FROZEN');
    expect(updateArg.data.rejectReason).toBe('SANCTION_APPLICANT');
  });
});

describe('setSlaDeadlineByNo (演示用「模拟超时」端点)', () => {
  let service: SwapTransactionsService;
  let prisma: any;
  let auditLogsService: any;

  beforeEach(() => {
    prisma = {
      swapTransaction: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    auditLogsService = { recordByActor: jest.fn().mockResolvedValue(undefined) };
    service = new SwapTransactionsService(
      prisma as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      auditLogsService as any,
      { resolve: jest.fn().mockResolvedValue({ blocked: new Set() }) } as any,
    );
  });

  it('按 swapNo 查不到单时抛 NotFoundException', async () => {
    prisma.swapTransaction.findFirst.mockResolvedValue(null);

    await expect(
      service.setSlaDeadlineByNo('SWP-MISSING', new Date(), {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('slaDeadline 为 null（不计时状态）时抛 BadRequestException，不落库不写审计', async () => {
    prisma.swapTransaction.findFirst.mockResolvedValue({
      id: 'swp-1',
      slaDeadline: null,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
    });

    await expect(
      service.setSlaDeadlineByNo('SWP0001', new Date(), {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.swapTransaction.update).not.toHaveBeenCalled();
    expect(auditLogsService.recordByActor).not.toHaveBeenCalled();
  });

  it('单据在 SLA 计时状态时把 deadline 拨过去并写审计', async () => {
    const pastDate = new Date(Date.now() - 1000);
    prisma.swapTransaction.findFirst.mockResolvedValue({
      id: 'swp-1',
      slaDeadline: new Date(Date.now() + 5 * 60_000),
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
    });
    prisma.swapTransaction.update.mockResolvedValue({ id: 'swp-1', slaDeadline: pastDate });

    const result = await service.setSlaDeadlineByNo('SWP0001', pastDate, {
      actorId: 'admin-1',
      actorRole: 'OPERATOR',
    });

    expect(prisma.swapTransaction.update).toHaveBeenCalledWith({
      where: { id: 'swp-1' },
      data: { slaDeadline: pastDate },
    });
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SWAP_SLA_TIMEOUT_SIMULATED',
        primarySubjectType: 'SWAP_TRANSACTION',
        primarySubjectNo: 'SWP0001',
        requestId: expect.stringContaining('SLA_TIMEOUT_SIMULATED'),
      }),
      expect.objectContaining({ actorType: 'ADMIN', actorNo: 'admin-1', actorRolesAtTime: ['OPERATOR'] }),
    );
    expect(result.slaDeadline).toEqual(pastDate);
  });

  it('同一张单连续两次模拟超时，产出不同的 requestId（幂等键不能恒定，否则第二条审计被静默丢弃）', async () => {
    const pastDate = new Date(Date.now() - 1000);
    prisma.swapTransaction.findFirst.mockResolvedValue({
      id: 'swp-1',
      slaDeadline: new Date(Date.now() + 5 * 60_000),
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
    });
    prisma.swapTransaction.update.mockResolvedValue({ id: 'swp-1', slaDeadline: pastDate });

    await service.setSlaDeadlineByNo('SWP0001', pastDate, { actorId: 'admin-1', actorRole: 'OPERATOR' });
    await service.setSlaDeadlineByNo('SWP0001', pastDate, { actorId: 'admin-1', actorRole: 'OPERATOR' });

    const calls = auditLogsService.recordByActor.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].requestId).not.toBe(calls[1][0].requestId);
  });
});

// E1（2026-09-12 业主定案）：管理台标「人被冻」——findAll 读时派生 ownerRestricted，
// 不落库（「被冻」是客户属性不是单属性）。blocked 含 SILENT，只许 admin 面出现；
// customerScope 一律不带（漏给客户即 tipping-off）。
describe('findAll — E1 ownerRestricted derivation (admin vs customerScope)', () => {
  let service: SwapTransactionsService;
  let customerAccessService: any;

  beforeEach(() => {
    customerAccessService = { resolve: jest.fn().mockResolvedValue({ blocked: new Set() }) };
    service = new SwapTransactionsService(
      {} as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      { recordByActor: jest.fn() } as any,
      customerAccessService as any,
    );
  });

  it('admin findAll derives ownerRestricted; customerScope path never carries it', async () => {
    // 派生是就地改写 items 里的行对象（读时派生、不落库）。用 mockImplementation
    // 而不是 mockResolvedValue 常量数组，保证 admin 调用与 customerScope 调用
    // 各拿一份全新的行对象——否则两次调用会共享同一批对象引用，第一次调用
    // 写下的 ownerRestricted 会“泄漏”进第二次调用，把测试的假阴性误判成
    // 实现缺陷（真正的生产路径里每次请求都是全新的 Prisma 查询结果，不会
    // 共享对象引用，这纯粹是本测试双次复用同一个 mock 返回值的假象）。
    const findMany = jest.fn().mockImplementation(() =>
      Promise.resolve([{ id: 's1', ownerId: 'o1' }, { id: 's2', ownerId: 'o2' }]),
    );
    const count = jest.fn().mockResolvedValue(2);
    (service as any).prisma = { swapTransaction: { findMany, count } };
    customerAccessService.resolve.mockImplementation(async (oid: string) => ({
      blocked: new Set(oid === 'o1' ? ['SWAP'] : []),
    }));
    const adminOut = await service.findAll({} as any);
    expect(adminOut.items.map((i: any) => i.ownerRestricted)).toEqual([true, false]);
    const customerOut = await service.findAll({} as any, { customerScope: true });
    expect(customerOut.items[0].ownerRestricted).toBeUndefined();
  });
});

// 战役丙波二 T4：客户详情响应附 confirmation 子对象（白名单显式映射）。
// prisma mock 行为化——findUnique 按 where.swapNo 过滤（不匹配即 null），不无视 where 假绿。
describe('findOneForCustomer · confirmation 子对象（丙波二 T4）', () => {
  let service: SwapTransactionsService;
  let prisma: any;

  const CONFIRMATION_KEYS = [
    'confirmationNo', 'quoteNo', 'fromAmount', 'fromAssetCode', 'toAmount', 'toAssetCode', 'netToAmount',
    'feeAmount', 'feeCurrency', 'feeLines', 'exchangeRate', 'marketRate', 'rateSource', 'fetchedAt',
    'spreadPercent', 'spreadAmount', 'tradedAt', 'settledAt', 'issuedAt',
  ];

  const swapRow = (over: any = {}) => ({
    id: 'swap-c4',
    swapNo: 'SWP0400',
    quoteNo: 'SQT0400',
    ownerId: 'cust-1',
    ownerNo: 'C0001',
    status: 'SUCCESS',
    fromAmount: '100',
    toAmount: '99.4',
    netToAmount: '97.65',
    feeAmount: '1.75',
    feeCurrency: 'USDT',
    feeBreakdown: '[]',
    exchangeRate: '0.994',
    statusHistory: '[]',
    createdAt: new Date('2026-10-02T08:01:00.000Z'),
    completedAt: new Date('2026-10-02T08:06:00.000Z'),
    fromAsset: { id: 'a1', currency: 'USDT', code: 'USDT', network: 'TRON', decimals: 6 },
    toAsset: { id: 'a2', currency: 'USDC', code: 'USDC', network: 'TRON', decimals: 6 },
    ...over,
  });

  // 确认单整行（含 id/swapNo/ownerCustomerNo 三个内部列——白名单必须把它们挡在响应之外）
  const confRow = (over: any = {}) => ({
    id: 'tc-uuid-1',
    confirmationNo: 'CNF0400',
    swapNo: 'SWP0400',
    ownerCustomerNo: 'C0001',
    quoteNo: 'SQT0400',
    fromAmount: '100',
    fromAssetCode: 'USDT',
    toAmount: '99.4',
    toAssetCode: 'USDC',
    netToAmount: '97.65',
    feeAmount: '1.75',
    feeCurrency: 'USDT',
    feeLines: JSON.stringify([{ itemCode: 'SWAP_FEE', amount: '1.5', currency: 'USDT' }]),
    exchangeRate: '0.994',
    marketRate: '0.9990',
    rateSource: 'DEMO_FX',
    fetchedAt: new Date('2026-10-02T08:00:00.000Z'),
    spreadPercent: '0.5',
    spreadAmount: '0.5',
    tradedAt: new Date('2026-10-02T08:01:00.000Z'),
    settledAt: new Date('2026-10-02T08:06:00.000Z'),
    issuedAt: new Date('2026-10-02T08:06:01.000Z'),
    ...over,
  });

  const setup = (swap: any, confs: any[]) => {
    prisma = {
      swapTransaction: { findUnique: jest.fn().mockResolvedValue(swap) },
      fundsOrder: { findMany: jest.fn().mockResolvedValue([]) },
      tradeConfirmation: {
        findUnique: jest.fn(async ({ where }: any) => confs.find((c) => c.swapNo === where.swapNo) ?? null),
      },
    };
    service = new SwapTransactionsService(prisma as any, {} as any, {} as any, { emit: jest.fn() } as any, { recordByActor: jest.fn() } as any, { resolve: jest.fn().mockResolvedValue({ blocked: new Set() }) } as any);
  };

  it('SUCCESS 单且确认单存在 → confirmation 含且仅含 19 键（白名单封条，内部列 id/swapNo/ownerCustomerNo 不外泄），feeLines 为解析后的数组', async () => {
    setup(swapRow(), [confRow()]);

    const result: any = await service.findOneForCustomer('swap-c4', 'cust-1');

    expect(result.status).toBe('SUCCESS');
    expect(Object.keys(result.confirmation).sort()).toEqual([...CONFIRMATION_KEYS].sort());
    expect(result.confirmation.confirmationNo).toBe('CNF0400');
    expect(result.confirmation.toAssetCode).toBe('USDC');
    expect(result.confirmation.feeLines).toEqual([{ itemCode: 'SWAP_FEE', amount: '1.5', currency: 'USDT' }]);
    expect(result.confirmation.settledAt).toEqual(new Date('2026-10-02T08:06:00.000Z'));
    expect(prisma.tradeConfirmation.findUnique).toHaveBeenCalledWith({ where: { swapNo: 'SWP0400' } });
  });

  it('FROZEN 单（哪怕确认单行存在）→ confirmation===null，且 status===COMPLIANCE_PENDING、completedAt===null——冻结单与正常处理中单不可区分', async () => {
    setup(swapRow({ status: 'FROZEN' }), [confRow()]);

    const result: any = await service.findOneForCustomer('swap-c4', 'cust-1');

    expect(result.confirmation).toBeNull();
    expect(result.status).toBe('COMPLIANCE_PENDING');
    expect(result.completedAt).toBeNull();
  });

  it('SUCCESS 单但确认单行不存在（历史边缘）→ confirmation===null，其余页面照旧', async () => {
    setup(swapRow(), []);

    const result: any = await service.findOneForCustomer('swap-c4', 'cust-1');

    expect(result.confirmation).toBeNull();
    expect(result.status).toBe('SUCCESS');
    expect(result.swapNo).toBe('SWP0400');
  });

  it('按业务键 swapNo 的详情入口同样带 confirmation（复用 findOneForCustomer）', async () => {
    setup(swapRow(), [confRow()]);
    prisma.swapTransaction.findFirst = jest.fn().mockResolvedValue({ id: 'swap-c4' });

    const result: any = await service.findOneForCustomerBySwapNo('SWP0400', 'cust-1');

    expect(result.confirmation.confirmationNo).toBe('CNF0400');
  });
});
