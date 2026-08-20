import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
        customer: true,
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
    service = new SwapTransactionsService({} as any, {} as any, {} as any, { emit: jest.fn() } as any);
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
});

// Finding 1 (Critical, task-10 review): the customer-facing read paths must
// return an allow-listed view, not the raw findOne row — the raw row carries
// compliance-investigation fields (matched Sumsub rule names, reject reason,
// the full Sumsub payload, verdict/action, txn ids) that would tip off a
// customer under sanctions investigation. Mirrors
// withdraw-transactions.service.spec.ts's toCustomerWithdrawView coverage.
describe('customer-facing tipping-off whitelist (findOneForCustomer / findAllForCustomer)', () => {
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
    riskDecisionRef: 'risk-ref-1',
    failureCode: null,
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
    service = new SwapTransactionsService(prisma as any, {} as any, {} as any, { emit: jest.fn() } as any);
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
      expect(result.riskDecisionRef).toBeUndefined();
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
    };
    service = new SwapTransactionsService(prisma as any, {} as any, {} as any, { emit: jest.fn() } as any);
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
    service = new SwapTransactionsService({} as any, {} as any, {} as any, { emit: jest.fn() } as any);
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

  it('FROZEN 零出边：对已冻结的单施加任何动作都抛 Invalid transition', async () => {
    const tx = {
      swapTransaction: { findUnique: jest.fn().mockResolvedValue({ id: 's1', status: 'FROZEN' }) },
    } as any;
    await expect(service.markStatus('s1', SwapTransactionAction.KYT_APPROVED, tx))
      .rejects.toThrow(/Invalid transition/);
    await expect(service.markStatus('s1', SwapTransactionAction.KYT_REJECTED, tx))
      .rejects.toThrow(/Invalid transition/);
    await expect(service.markStatus('s1', SwapTransactionAction.SUCCESS, tx))
      .rejects.toThrow(/Invalid transition/);
    await expect(service.markStatus('s1', SwapTransactionAction.FREEZE, tx))
      .rejects.toThrow(/Invalid transition/);
  });

  it('PROCESSING 阶段没有 freeze 出边（腿已开跑，冻结会留半截账）', async () => {
    const tx = {
      swapTransaction: { findUnique: jest.fn().mockResolvedValue({ id: 's1', status: 'PROCESSING' }) },
    } as any;
    await expect(service.markStatus('s1', SwapTransactionAction.FREEZE, tx))
      .rejects.toThrow(/Invalid transition/);
  });
});
