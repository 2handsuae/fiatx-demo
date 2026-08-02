import { MODULE_METADATA } from '@nestjs/common/constants';

/**
 * Task 6(计划1 甲方案)安全闸 a 的测试证据:AdminDepositDemoController 只在
 * SUMSUB_MOCK_MODE=true 时被 DepositSumsubModule 注册 —— 生产环境该路由压根不存在,
 * 不是靠 guard 拦。
 *
 * DepositSumsubModule 的 `@Module({...})` 装饰器在文件被 require() 时(模块加载时机)
 * 就求值一次并把 controllers 数组固定下来,所以每个 env 值都要 `jest.resetModules()`
 * 清缓存后重新 require() 才能拿到对应该 env 值算出的那份新鲜 metadata。同一轮 reset
 * 周期内 require 两个文件(module + controller)才能拿到同一份 class 引用做 toContain
 * 比较 —— 中途再 resetModules() 会让两边指向不同批次的 class,永远比不出相等。
 *
 * ⚠️ 不要用 `delete process.env.SUMSUB_MOCK_MODE` 来模拟"未设置":
 * `deposit-sumsub.module.ts` 的 require 链会经过 PrismaService/@prisma/client,而
 * @prisma/client 的 runtime 自带一次 `dotenv.config()`(读 worktree 根 `.env`,dotenv
 * 默认不覆盖 process.env 里已存在的 key)。若该 key 被 delete 成"不存在",resetModules()
 * 触发的这次 Prisma 自带 dotenv 加载会把它从 `.env` 里重新填回来(本机 `.env` 目前正巧
 * 写着 SUMSUB_MOCK_MODE=true,用于本地起服务演示)——导致这条用例在本 worktree 里输出
 * "假失败"。改成显式赋一个非 'true' 的字符串(如 ''),让 key 在 process.env 里"存在"
 * (哪怕是空串),dotenv 就不会碰它,断言才不受 `.env` 磁盘内容摆布。
 */
describe('DepositSumsubModule — SUMSUB_MOCK_MODE controller gate', () => {
  const ORIGINAL_ENV = process.env.SUMSUB_MOCK_MODE;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.SUMSUB_MOCK_MODE;
    } else {
      process.env.SUMSUB_MOCK_MODE = ORIGINAL_ENV;
    }
  });

  function loadModuleParts(): {
    controllers: unknown[];
    AdminDepositDemoController: unknown;
  } {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DepositSumsubModule } = require('./deposit-sumsub.module');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AdminDepositDemoController } = require('./admin-deposit-demo.controller');
    const controllers =
      (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DepositSumsubModule) as unknown[]) || [];
    return { controllers, AdminDepositDemoController };
  }

  it('production (SUMSUB_MOCK_MODE not "true"): the demo route is never registered', () => {
    // Present-but-empty, NOT deleted — see file header for why.
    process.env.SUMSUB_MOCK_MODE = '';
    const { controllers } = loadModuleParts();

    expect(controllers).toEqual([]);
  });

  it('production (SUMSUB_MOCK_MODE="false"): the demo route is never registered', () => {
    process.env.SUMSUB_MOCK_MODE = 'false';
    const { controllers } = loadModuleParts();

    expect(controllers).toEqual([]);
  });

  it('demo mode (SUMSUB_MOCK_MODE="true"): the demo route IS registered', () => {
    process.env.SUMSUB_MOCK_MODE = 'true';
    const { controllers, AdminDepositDemoController } = loadModuleParts();

    expect(controllers).toContain(AdminDepositDemoController);
    expect(controllers.length).toBe(1);
  });
});
