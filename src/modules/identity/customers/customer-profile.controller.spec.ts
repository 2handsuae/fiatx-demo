// 战役丙波四 T9：客户自助改 phone 的控制器边界。
//   - 非客户 token（admin JWT）一律 403，服务不被碰；
//   - 服务调用带的是 JWT sub（customerMain.id）与 body.phone 原样值（不在控制器层裁剪/改写）。
import { ForbiddenException } from '@nestjs/common';
import { CustomerProfileController } from './customer-profile.controller';

const customerReq = { user: { type: 'CUSTOMER', userId: 'cust-uuid-1', userNo: 'CU0001' } };
const adminReq = { user: { type: 'ADMIN', userId: 'admin-uuid', userNo: 'ADM-CO' } };

function makeController() {
  const customers = { updatePhoneSelf: jest.fn(async () => undefined) };
  return { controller: new CustomerProfileController({} as any, {} as any, customers as any), customers };
}

describe('CustomerProfileController.updatePhone (丙波四 T9)', () => {
  it('forwards the JWT customer id and the raw phone to CustomersService.updatePhoneSelf', async () => {
    const { controller, customers } = makeController();
    await controller.updatePhone(customerReq, { phone: ' +971500000002 ' });
    expect(customers.updatePhoneSelf).toHaveBeenCalledWith('cust-uuid-1', ' +971500000002 ');
  });

  it('rejects a non-customer token with 403 and never touches the service', async () => {
    const { controller, customers } = makeController();
    await expect(controller.updatePhone(adminReq, { phone: '+971500000002' })).rejects.toThrow(ForbiddenException);
    expect(customers.updatePhoneSelf).not.toHaveBeenCalled();
  });
});
