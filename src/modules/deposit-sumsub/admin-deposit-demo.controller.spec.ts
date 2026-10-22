import { AdminDepositDemoController } from './admin-deposit-demo.controller';

describe('AdminDepositDemoController', () => {
  let controller: AdminDepositDemoController;
  let workflow: { applySourceAttribution: jest.Mock };

  beforeEach(() => {
    workflow = { applySourceAttribution: jest.fn().mockResolvedValue({ depositNo: 'DP1' }) };
    controller = new AdminDepositDemoController({} as any, workflow as any);
  });

  it('GET verdict-buttons 返回 12 个按钮，含 source 分组标记', async () => {
    const res = await controller.listVerdictButtons({ user: { type: 'ADMIN' } });
    expect(res.buttons).toHaveLength(12);
    expect(res.buttons[0]).toEqual(
      expect.objectContaining({ key: expect.any(String), label: expect.any(String), source: expect.any(String) }),
    );
    // 不吐报文内容：前端只需要键、文案、分组
    expect(res.buttons[0]).not.toHaveProperty('verdict');
  });

  // 对手方波二 Task 4：⚡喂归因——controller 只做传输，业务全在 workflow。
  it('POST feed-attribution 把 body + 当前 admin 作为 operator 转给 workflow.applySourceAttribution', async () => {
    const req = {
      user: { type: 'ADMIN', userId: 'u-1', userNo: 'ADM001', role: 'COMPLIANCE_OFFICER', roleCodes: ['COMPLIANCE_OFFICER'] },
    };

    const res = await controller.feedAttribution(
      { depositNo: 'DP1', attribution: 'VASP', vasp: 'GREY_HARBOR' },
      req,
    );

    expect(workflow.applySourceAttribution).toHaveBeenCalledWith(
      'DP1',
      { attribution: 'VASP', vasp: 'GREY_HARBOR' },
      { actorType: 'ADMIN', userId: 'u-1', userNo: 'ADM001', role: 'COMPLIANCE_OFFICER', roleCodes: ['COMPLIANCE_OFFICER'] },
    );
    expect(res).toEqual({ depositNo: 'DP1' });
  });

  it('roleCodes 缺省时回落到 [role]（与其它 admin controller 同款拼 actor）', async () => {
    await controller.feedAttribution(
      { depositNo: 'DP1', attribution: 'UNHOSTED' },
      { user: { type: 'ADMIN', userId: 'u-1', userNo: 'ADM001', role: 'MLRO' } },
    );

    expect(workflow.applySourceAttribution.mock.calls[0][2]).toMatchObject({ roleCodes: ['MLRO'] });
  });
});
