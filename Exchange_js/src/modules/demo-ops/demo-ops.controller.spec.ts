import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '@nestjs/passport';
import { DemoOpsController } from './demo-ops.controller';

describe('DemoOpsController', () => {
  it('三条路由委托给 service', () => {
    const service = {
      readStatus: jest.fn().mockReturnValue('s'),
      requestReset: jest.fn().mockReturnValue('r'),
      startReconBreak: jest.fn().mockReturnValue('b'),
    };
    const c = new DemoOpsController(service as never);
    expect(c.status()).toBe('s');
    expect(c.reset()).toBe('r');
    expect(c.reconBreak()).toBe('b');
  });

  it('守卫口径：status 免登录，两个 POST 挂 jwt（spec §3 勘误条）', () => {
    const proto = DemoOpsController.prototype as unknown as Record<string, () => unknown>;
    const guardsOf = (method: string) =>
      Reflect.getMetadata(GUARDS_METADATA, proto[method]) as unknown[] | undefined;
    expect(guardsOf('status')).toBeUndefined();
    expect(guardsOf('reset')).toEqual([AuthGuard('jwt')]);
    expect(guardsOf('reconBreak')).toEqual([AuthGuard('jwt')]);
  });
});
