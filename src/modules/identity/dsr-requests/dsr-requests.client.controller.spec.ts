// 战役丙波四 T7：DSR client 面控制器。行为断言：
//   - 提交 DTO 经真 ValidationPipe：type 只认三值枚举、detail 必填；
//   - 非客户 token 一律 403（admin JWT 不能走客户面）；
//   - 服务调用带的是 JWT sub（customerMain.id），对外返回仍是 requestNo。
import { ArgumentMetadata, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { DsrRequestsClientController } from './dsr-requests.client.controller';
import { SubmitDsrBodyDto } from './dsr-requests.dto';

const customerReq = { user: { type: 'CUSTOMER', userId: 'cust-uuid-1', userNo: 'CU0001' } };
const adminReq = { user: { type: 'ADMIN', userId: 'admin-uuid', userNo: 'ADM-DPO' } };

function makeController() {
  const dsr = {
    submit: jest.fn(async () => ({ requestNo: 'DSR0001' })),
    listForCustomer: jest.fn(async () => []),
    getForCustomer: jest.fn(async () => ({ requestNo: 'DSR0001' })),
  };
  return { controller: new DsrRequestsClientController(dsr as any), dsr };
}

const pipe = new ValidationPipe({ transform: true, whitelist: true });
const bodyMeta: ArgumentMetadata = { type: 'body', metatype: SubmitDsrBodyDto };

describe('DsrRequestsClientController (丙波四 T7)', () => {
  describe('submit DTO validation (real ValidationPipe)', () => {
    it.each(['ACCESS', 'RECTIFICATION', 'ERASURE'])('accepts type %s', async (type) => {
      await expect(pipe.transform({ type, detail: 'please help' }, bodyMeta)).resolves.toMatchObject({ type, detail: 'please help' });
    });

    it.each([
      ['unknown type', { type: 'PORTABILITY', detail: 'x' }],
      ['lowercase type', { type: 'access', detail: 'x' }],
      ['missing type', { detail: 'x' }],
      ['missing detail', { type: 'ACCESS' }],
      ['empty detail', { type: 'ACCESS', detail: '' }],
    ])('rejects %s with 400', async (_name, body) => {
      await expect(pipe.transform(body, bodyMeta)).rejects.toMatchObject({ status: 400 });
    });

    it('strips fields a client should not set (whitelist) — status / dueAt never reach the service', async () => {
      const out = await pipe.transform({ type: 'ACCESS', detail: 'x', status: 'RESOLVED', dueAt: '2020-01-01' }, bodyMeta);
      expect(out).not.toHaveProperty('status');
      expect(out).not.toHaveProperty('dueAt');
    });
  });

  describe('customer identity', () => {
    it('rejects a non-customer token on all three routes with 403 and never touches the service', async () => {
      const { controller, dsr } = makeController();
      await expect(controller.submit(adminReq, { type: 'ACCESS', detail: 'x' })).rejects.toThrow(ForbiddenException);
      await expect(controller.listMine(adminReq)).rejects.toThrow(ForbiddenException);
      await expect(controller.getMine(adminReq, 'DSR0001')).rejects.toThrow(ForbiddenException);
      expect(dsr.submit).not.toHaveBeenCalled();
      expect(dsr.listForCustomer).not.toHaveBeenCalled();
      expect(dsr.getForCustomer).not.toHaveBeenCalled();
    });

    it('passes the JWT sub (customer id) to the service and returns the business key', async () => {
      const { controller, dsr } = makeController();
      await expect(controller.submit(customerReq, { type: 'ERASURE', detail: 'delete me' })).resolves.toEqual({ requestNo: 'DSR0001' });
      expect(dsr.submit).toHaveBeenCalledWith({ id: 'cust-uuid-1' }, { type: 'ERASURE', detail: 'delete me' });
      await controller.listMine(customerReq);
      expect(dsr.listForCustomer).toHaveBeenCalledWith('cust-uuid-1');
      await controller.getMine(customerReq, 'DSR0001');
      expect(dsr.getForCustomer).toHaveBeenCalledWith('cust-uuid-1', 'DSR0001');
    });
  });
});
