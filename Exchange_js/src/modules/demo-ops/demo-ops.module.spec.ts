import { MODULE_METADATA } from '@nestjs/common/constants';

/**
 * 门控证据（照 deposit-demo.module.spec.ts 模板，坑同款）：
 * - @Module() 装饰器在 require 时求值一次，每个 env 值都要 jest.resetModules() 后重新 require；
 * - 同一轮 reset 内 require module + controller 两个文件才能拿到同一批 class 引用；
 * - 用「显式赋空串」模拟未设置，不许 delete（@prisma/client 的 dotenv 会从 .env 悄悄填回，
 *   本地验收时 .env 恰好写着 DEMO_OPS=1，delete 版用例会假失败）。
 */
describe('DemoOpsModule — DEMO_OPS controller gate', () => {
  const ORIGINAL_ENV = process.env.DEMO_OPS;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      process.env.DEMO_OPS = '';
    } else {
      process.env.DEMO_OPS = ORIGINAL_ENV;
    }
  });

  function loadModuleParts(): { controllers: unknown[]; DemoOpsController: unknown } {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DemoOpsModule } = require('./demo-ops.module');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DemoOpsController } = require('./demo-ops.controller');
    const controllers =
      (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DemoOpsModule) as unknown[]) || [];
    return { controllers, DemoOpsController };
  }

  it('本地（DEMO_OPS 未设）：路由压根不注册', () => {
    process.env.DEMO_OPS = '';
    expect(loadModuleParts().controllers).toEqual([]);
  });

  it('DEMO_OPS=0：路由不注册', () => {
    process.env.DEMO_OPS = '0';
    expect(loadModuleParts().controllers).toEqual([]);
  });

  it('云端（DEMO_OPS=1）：路由注册', () => {
    process.env.DEMO_OPS = '1';
    const { controllers, DemoOpsController } = loadModuleParts();
    expect(controllers).toContain(DemoOpsController);
    expect(controllers.length).toBe(1);
  });
});
