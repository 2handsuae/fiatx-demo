import { TradeConfirmationsService } from './trade-confirmations.service';
import { SwapTransactionsService } from './swap-transactions.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';

// 战役丙波二 T3：prisma/audit 全 mock，mock 行为化——swapTransaction.findUnique 按 where.swapNo
// 语义返回（不匹配即 null），不无视 where 假绿（本仓判例：mock 无视 where 假绿）。
// toCustomerPricingFacts 不 mock：直接借真函数（它不读 this），断言走真实拆费口径——
// feeBreakdown 里的 fx 技术字段（endpoint/symbol/bid/ask）必须被拆掉，只剩业务事实。
const FEE_BREAKDOWN = JSON.stringify([
  {
    fees: [
      { itemCode: 'SWAP_FEE', amount: '1.5', currency: 'USDT' },
      { itemCode: 'NETWORK_FEE', amount: 0.25, currency: 'USDT' },
    ],
    fx: { baseRate: '0.9990', markupBps: 50, endpoint: 'https://fx.example/rates', symbol: 'USDTUSDC', bid: '0.998', ask: '1.001' },
  },
]);

const QUOTE = {
  marketRate: '0.9990',
  rateSource: 'DEMO_FX',
  fetchedAt: new Date('2026-10-02T08:00:00.000Z'),
  spreadPercent: '0.5',
};

const SWAP = {
  id: 'swap-uuid-1',
  swapNo: 'SWP261002000001',
  ownerNo: 'CUS00001',
  quoteNo: 'SQT261002000001',
  fromAmount: '100',
  fromAssetCode: 'USDT',
  toAmount: '99.4',
  toAssetCode: 'USDC',
  netToAmount: '97.65',
  feeAmount: '1.75',
  feeCurrency: 'USDT',
  feeBreakdown: FEE_BREAKDOWN,
  exchangeRate: '0.994',
  spreadAmount: '0.5',
  createdAt: new Date('2026-10-02T08:01:00.000Z'),
  completedAt: new Date('2026-10-02T08:06:00.000Z'),
  quote: QUOTE,
};

function makeService(opts: { swaps?: any[]; createImpl?: (args: any) => Promise<any>; auditImpl?: (args: any) => Promise<any> } = {}) {
  const swaps = opts.swaps ?? [SWAP];
  const order: string[] = [];
  const prisma: any = {
    swapTransaction: {
      findUnique: jest.fn(async ({ where }: any) => swaps.find((s) => s.swapNo === where.swapNo) ?? null),
    },
    tradeConfirmation: {
      create: jest.fn(async (args: any) => {
        order.push('create');
        if (opts.createImpl) return opts.createImpl(args);
        return { id: 'tc-uuid-1', ...args.data };
      }),
    },
  };
  const auditLogs: any = {
    recordSystem: jest.fn(async (args: any) => {
      order.push('audit');
      if (opts.auditImpl) return opts.auditImpl(args);
      return {};
    }),
  };
  const swapTransactionsService: any = {
    toCustomerPricingFacts: (raw: string | null) =>
      (SwapTransactionsService.prototype as any).toCustomerPricingFacts.call(null, raw),
  };
  const service = new TradeConfirmationsService(prisma, auditLogs, swapTransactionsService);
  return { service, prisma, auditLogs, order };
}

describe('TradeConfirmationsService.issueForSwapIfSuccess', () => {
  let errSpy: jest.SpyInstance;
  beforeEach(() => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errSpy.mockRestore());

  // ① SUCCESS → 恰一张确认单，字段全部取自兑换单行与报价行（不重算）
  it('SUCCESS → tradeConfirmation.create 恰一次，字段来自 swap 行/quote 行/真实拆费口径', async () => {
    const { service, prisma } = makeService();

    await service.issueForSwapIfSuccess('SWP261002000001', 'SUCCESS');

    expect(prisma.tradeConfirmation.create).toHaveBeenCalledTimes(1);
    const { data } = prisma.tradeConfirmation.create.mock.calls[0][0];
    expect(data.confirmationNo).toMatch(/^CNF\d{12}$/);
    expect(data.swapNo).toBe('SWP261002000001');
    expect(data.quoteNo).toBe('SQT261002000001');
    expect(data.ownerCustomerNo).toBe(SWAP.ownerNo);
    expect(data.fromAmount).toBe('100');
    expect(data.fromAssetCode).toBe('USDT');
    expect(data.toAmount).toBe('99.4');
    expect(data.toAssetCode).toBe('USDC');
    expect(data.netToAmount).toBe('97.65');
    expect(data.feeAmount).toBe('1.75');
    expect(data.feeCurrency).toBe('USDT');
    expect(data.exchangeRate).toBe('0.994');
    // quote 行
    expect(data.marketRate).toBe(QUOTE.marketRate);
    expect(data.rateSource).toBe('DEMO_FX');
    expect(data.fetchedAt).toBe(QUOTE.fetchedAt);
    expect(data.spreadPercent).toBe('0.5');
    // swap 行已存值，不重算
    expect(data.spreadAmount).toBe('0.5');
    expect(data.tradedAt).toBe(SWAP.createdAt);
    expect(data.settledAt).toBe(SWAP.completedAt);
    // feeLines：JSON 字符串，口径=toCustomerPricingFacts——fx 技术字段被拆掉
    expect(typeof data.feeLines).toBe('string');
    expect(JSON.parse(data.feeLines)).toEqual([
      { itemCode: 'SWAP_FEE', amount: '1.5', currency: 'USDT' },
      { itemCode: 'NETWORK_FEE', amount: '0.25', currency: 'USDT' },
    ]);
    expect(data.feeLines).not.toContain('endpoint');
    expect(data.feeLines).not.toContain('bid');
  });

  it('quote 行缺失（swap 无 quote）→ 报价快照列落 null，其余照出', async () => {
    const { service, prisma } = makeService({ swaps: [{ ...SWAP, quote: null }] });

    await service.issueForSwapIfSuccess('SWP261002000001', 'SUCCESS');

    const { data } = prisma.tradeConfirmation.create.mock.calls[0][0];
    expect(data.marketRate).toBeNull();
    expect(data.rateSource).toBeNull();
    expect(data.fetchedAt).toBeNull();
    expect(data.spreadPercent).toBeNull();
    expect(data.exchangeRate).toBe('0.994');
  });

  // ② 先落单后审计；审计信封逐字照 NOTIFICATION_SENT 先例
  it('随后 recordSystem 恰一次：CONFIRMATION_ISSUED 信封，requestId=created.id，且次序 create 先于 audit', async () => {
    const { service, prisma, auditLogs, order } = makeService();

    await service.issueForSwapIfSuccess('SWP261002000001', 'SUCCESS');

    expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
    const created = await prisma.tradeConfirmation.create.mock.results[0].value;
    const arg = auditLogs.recordSystem.mock.calls[0][0];
    expect(arg.action).toBe(AuditActions.CONFIRMATION_ISSUED);
    expect(arg.action).toBe('CONFIRMATION_ISSUED');
    expect(arg.actionDomain).toBe('SWAP');
    expect(arg.category).toBe(AuditCategory.BUSINESS);
    expect(arg.primarySubjectType).toBe(AuditEntityTypes.SWAP_TRANSACTION);
    expect(arg.primarySubjectNo).toBe('SWP261002000001');
    expect(arg.ownerCustomerNo).toBe('CUS00001');
    expect(arg.subjects).toEqual([
      { subjectType: AuditEntityTypes.SWAP_TRANSACTION, subjectNo: 'SWP261002000001', subjectRole: AuditSubjectRole.PRIMARY },
      { subjectType: AuditEntityTypes.CUSTOMER, subjectNo: 'CUS00001', subjectRole: AuditSubjectRole.OWNER },
    ]);
    // requiredFields=['confirmationNo'] 顶层展开 + metadata 另镜像
    expect(arg.confirmationNo).toBe(created.confirmationNo);
    expect(arg.confirmationNo).toMatch(/^CNF\d{12}$/);
    expect(arg.metadata).toEqual({ confirmationNo: created.confirmationNo, swapNo: 'SWP261002000001' });
    expect(arg.requestId).toBe(created.id);
    expect(arg.requestId).toBe('tc-uuid-1');
    expect(arg.sourcePlatform).toBe('SYSTEM');
    // 倒逼"先 create 后审计"：持久物先于信号
    expect(order).toEqual(['create', 'audit']);
  });

  // ③ 非 SUCCESS 一律不出具
  it.each(['REJECTED', 'FROZEN', 'PROCESSING'])('toStatus=%s → create 与 recordSystem 均零调用', async (toStatus) => {
    const { service, prisma, auditLogs } = makeService();

    await service.issueForSwapIfSuccess('SWP261002000001', toStatus);

    expect(prisma.swapTransaction.findUnique).not.toHaveBeenCalled();
    expect(prisma.tradeConfirmation.create).not.toHaveBeenCalled();
    expect(auditLogs.recordSystem).not.toHaveBeenCalled();
  });

  // ④ 边界吞错封条：出具失败不阻断已提交的成交
  it('create 抛错（含唯一约束冲突）→ resolve 不外抛，recordSystem 零调用', async () => {
    const dup: any = new Error('Unique constraint failed on the fields: (`swapNo`)');
    dup.code = 'P2002';
    const { service, auditLogs } = makeService({
      createImpl: async () => {
        throw dup;
      },
    });

    await expect(service.issueForSwapIfSuccess('SWP261002000001', 'SUCCESS')).resolves.toBeUndefined();

    expect(auditLogs.recordSystem).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });

  it('审计写失败 → 同样吞错不外抛（确认单已落库，不回滚成交）', async () => {
    const { service, prisma } = makeService({
      auditImpl: async () => {
        throw new Error('audit down');
      },
    });

    await expect(service.issueForSwapIfSuccess('SWP261002000001', 'SUCCESS')).resolves.toBeUndefined();

    expect(prisma.tradeConfirmation.create).toHaveBeenCalledTimes(1);
  });

  // ⑤ 查无兑换单 / 无归属客户：静默 return（行为化 mock：where.swapNo 不等即返回 null）
  it('swapNo 查无（findUnique(where:{swapNo}) 不匹配）→ 静默 return，不 create 不审计', async () => {
    const { service, prisma, auditLogs } = makeService();

    await expect(service.issueForSwapIfSuccess('SWP-NO-SUCH', 'SUCCESS')).resolves.toBeUndefined();

    expect(prisma.swapTransaction.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.swapTransaction.findUnique.mock.calls[0][0].where).toEqual({ swapNo: 'SWP-NO-SUCH' });
    expect(prisma.tradeConfirmation.create).not.toHaveBeenCalled();
    expect(auditLogs.recordSystem).not.toHaveBeenCalled();
  });

  it('兑换单无 ownerNo（schema 列可空）→ 静默 return，不编造归属', async () => {
    const { service, prisma, auditLogs } = makeService({ swaps: [{ ...SWAP, ownerNo: null }] });

    await service.issueForSwapIfSuccess('SWP261002000001', 'SUCCESS');

    expect(prisma.tradeConfirmation.create).not.toHaveBeenCalled();
    expect(auditLogs.recordSystem).not.toHaveBeenCalled();
  });
});
