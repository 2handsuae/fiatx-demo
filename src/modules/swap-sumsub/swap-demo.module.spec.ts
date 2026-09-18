import { MODULE_METADATA } from '@nestjs/common/constants';

/**
 * Task 9 mirror of withdraw-sumsub.module.spec.ts / deposit-sumsub.module.spec.ts
 * (deliberate fork): security gate (a) evidence — AdminSwapDemoController is
 * only registered by SwapDemoModule when SUMSUB_MOCK_MODE=true; in
 * production the route doesn't exist at all, it isn't merely guard-blocked.
 *
 * Same caveats as the withdraw/deposit specs apply verbatim: `@Module({...})`
 * metadata is fixed at require()-time, so each env value needs
 * `jest.resetModules()` + a fresh require() of both files within the same
 * reset cycle; and never `delete process.env.SUMSUB_MOCK_MODE` (Prisma's own
 * dotenv.config() would refill it from the worktree's on-disk `.env`) —
 * assign a non-'true' string instead so the key stays "present" and dotenv
 * leaves it alone.
 */
describe('SwapDemoModule — SUMSUB_MOCK_MODE controller gate', () => {
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
    AdminSwapDemoController: unknown;
  } {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SwapDemoModule } = require('./swap-demo.module');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AdminSwapDemoController } = require('./admin-swap-demo.controller');
    const controllers =
      (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, SwapDemoModule) as unknown[]) || [];
    return { controllers, AdminSwapDemoController };
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
    const { controllers, AdminSwapDemoController } = loadModuleParts();

    expect(controllers).toContain(AdminSwapDemoController);
    expect(controllers.length).toBe(1);
  });
});
