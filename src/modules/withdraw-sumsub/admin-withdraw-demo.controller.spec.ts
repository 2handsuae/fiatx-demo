import { AdminWithdrawDemoController } from './admin-withdraw-demo.controller';

describe('AdminWithdrawDemoController', () => {
  let controller: AdminWithdrawDemoController;

  beforeEach(() => {
    controller = new AdminWithdrawDemoController({} as any);
  });

  it('GET verdict-buttons 返回 11 个按钮，含 source 分组标记', async () => {
    const res = await controller.listVerdictButtons({ user: { type: 'ADMIN' } });
    expect(res.buttons).toHaveLength(11);
    expect(res.buttons[0]).toEqual(
      expect.objectContaining({ key: expect.any(String), label: expect.any(String), source: expect.any(String) }),
    );
    // 不吐报文内容：前端只需要键、文案、分组
    expect(res.buttons[0]).not.toHaveProperty('verdict');
  });
});
