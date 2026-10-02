import { SwapTransactionsCustomerController } from './swap-transactions-customer.controller';

describe('SwapTransactionsCustomerController.getRate（波二·岔口 4）', () => {
  it('实时报价预览把客户身份传给 getExecutableRate（否则 VIP 打字时看到默认档价）', async () => {
    const swapTransactionsService = { getExecutableRate: jest.fn().mockResolvedValue({ executableRate: 3.67 }) };
    // 绕过构造器顺序：控制器字段就是普通属性
    const ctrl = Object.assign(Object.create(SwapTransactionsCustomerController.prototype), { swapTransactionsService });

    await ctrl.getRate({ user: { userId: 'cust-grace' } }, 'a-usdt', 'a-aed', '100');

    expect(swapTransactionsService.getExecutableRate).toHaveBeenCalledWith(
      'a-usdt',
      'a-aed',
      expect.objectContaining({ amount: 100, ownerType: 'CUSTOMER', ownerId: 'cust-grace' }),
    );
  });
});

describe('SwapTransactionsCustomerController.createQuote 报价响应（丙波二·点差金额同源）', () => {
  it('响应带 spreadAmount = in 腿市值(按 toAsset.decimals 取整) − 报出毛额', async () => {
    const quote = {
      id: 'q1', quoteNo: 'SQT-1', quoteType: 'FIRM', status: 'ACTIVE', side: 'SELL', amountType: 'FROM',
      amountIn: '1000', amountOut: '0.01507', marketRate: '0.0000153', totalsJson: null,
      rateDisplay: '0.00001507', rateAllIn: '0.00001507', spreadPercent: '1.5', spreadBps: 150,
      feeTotal: '0', feeBreakdown: null, fromAssetCode: 'USDT', toAssetCode: 'BTC',
      currencyIn: 'USDT', currencyOut: 'BTC', feeCurrency: 'BTC', rateSource: 'MOCK',
    };
    const prisma = {
      asset: {
        findUnique: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve(where.id === 'a-btc'
            ? { id: 'a-btc', currency: 'BTC', decimals: 8 }
            : { id: 'a-usdt', currency: 'USDT', decimals: 2 }),
        ),
      },
    };
    const swapQuoteService = {
      resolveOwnerNo: jest.fn().mockResolvedValue('C-1'),
      createQuote: jest.fn().mockResolvedValue(quote),
    };
    const customerAccess = { assertTradingIntake: jest.fn().mockResolvedValue(undefined) };
    const ctrl = Object.assign(Object.create(SwapTransactionsCustomerController.prototype), {
      prisma, swapQuoteService, customerAccess,
    });

    const res = await ctrl.createQuote(
      { user: { userId: 'cust-grace' } },
      { fromAssetId: 'a-usdt', toAssetId: 'a-btc', fromAmount: '1000' },
    );

    expect(res.spreadAmount).toBe(0.00023);
  });
});
