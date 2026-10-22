import { ForbiddenException } from '@nestjs/common';
import { WithdrawalAddressAdminController } from './withdrawal-address-admin.controller';

describe('WithdrawalAddressAdminController', () => {
  let controller: WithdrawalAddressAdminController;
  let workflow: any;
  let addressService: any;

  const adminReq = { user: { type: 'ADMIN', userId: 'admin-1', userNo: 'ADM001', role: 'COMPLIANCE_OFFICER' } };

  beforeEach(() => {
    workflow = { feedScreening: jest.fn().mockResolvedValue({ addressNo: 'WAD1001', status: 'REJECTED' }) };
    addressService = {
      findByNo: jest.fn().mockResolvedValue({ addressNo: 'WAD1001', screeningAnswer: 'RED', hostingMismatch: true, suspendReason: 'AML' }),
    };
    controller = new WithdrawalAddressAdminController(workflow, addressService);
  });

  it('simulate-screening：用 JWT 里的管理员身份 + body 的 answer / reason 调 workflow.feedScreening', async () => {
    const result = await controller.simulateScreening(adminReq, 'WAD1001', { answer: 'RED', reason: 'Sanctions exposure' });

    expect(workflow.feedScreening).toHaveBeenCalledWith(
      'WAD1001',
      { userId: 'admin-1', userNo: 'ADM001', role: 'COMPLIANCE_OFFICER' },
      'RED',
      'Sanctions exposure',
    );
    expect(result).toEqual({ addressNo: 'WAD1001', status: 'REJECTED' });
  });

  it('simulate-screening：非管理员 token → 403，不碰 workflow', async () => {
    await expect(
      controller.simulateScreening({ user: { type: 'CUSTOMER', userId: 'c' } }, 'WAD1001', { answer: 'GREEN', reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(workflow.feedScreening).not.toHaveBeenCalled();
  });

  it('管理台详情照旧返回全量（合规内部判断管理员要看，只有 client 控制器做客户面遮蔽）', async () => {
    const detail = await controller.findOne('WAD1001');
    expect(detail).toMatchObject({ screeningAnswer: 'RED', hostingMismatch: true, suspendReason: 'AML' });
  });
});
