import { AcctConfigService } from './acct-config.service';

describe('AcctConfigService', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  let service: AcctConfigService;
  let mockPrisma: any;

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env.NODE_ENV = 'test';

    mockPrisma = {
      acctEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    service = new AcctConfigService(mockPrisma);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('onModuleInit should validate only in non-production check-only mode', async () => {
    process.env.NODE_ENV = 'development';
    const validateSpy = jest
      .spyOn(service as any, 'validateDepositEventContract')
      .mockResolvedValue({ ok: true, issues: [] });

    await service.onModuleInit();

    expect(validateSpy).toHaveBeenCalledTimes(1);
  });

  it('onModuleInit should ignore deprecated sync-on-boot env and keep validation-only behavior', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ACCT_CONFIG_SYNC_ON_BOOT = 'true';
    const validateSpy = jest
      .spyOn(service as any, 'validateDepositEventContract')
      .mockResolvedValue({ ok: true, issues: [] });
    const logSpy = jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation();

    await service.onModuleInit();

    expect(validateSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('ACCT_CONFIG_SYNC_ON_BOOT'),
    );
  });

  it('onModuleInit should validate only in production (no auto-sync)', async () => {
    process.env.NODE_ENV = 'production';
    const validateSpy = jest
      .spyOn(service as any, 'validateDepositEventContract')
      .mockResolvedValue({ ok: true, issues: [] });

    await service.onModuleInit();

    expect(validateSpy).toHaveBeenCalledTimes(1);
  });

  it('onModuleInit should warn in production when contract mismatch is found', async () => {
    process.env.NODE_ENV = 'production';
    jest
      .spyOn(service as any, 'validateDepositEventContract')
      .mockResolvedValue({
        ok: false,
        issues: ['EVT_DEPOSIT_SUCCESS__FIAT toStatus expected SUCCESS'],
      });
    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation();

    await service.onModuleInit();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Deposit accounting event contract mismatch detected',
      ),
    );
  });
});
