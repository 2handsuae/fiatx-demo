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
