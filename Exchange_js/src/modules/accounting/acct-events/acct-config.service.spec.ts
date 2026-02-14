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
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      asset: {
        findFirst: jest.fn().mockResolvedValue({ id: 'asset-aed' }),
      },
      journalHeaderTemplate: {
        upsert: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      journalLineTemplate: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
      coa: {
        findUnique: jest.fn().mockResolvedValue({ code: 'COA_OK' }),
      },
    };

    service = new AcctConfigService(mockPrisma);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('syncDefaults should upsert new deposit events and cleanup rejected events', async () => {
    await service.syncDefaults();

    expect(mockPrisma.acctEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventCode: 'EVT_DEPOSIT_CONFIRMED__CRYPTO' },
        update: expect.objectContaining({
          toStatus: 'COMPLIANCE_PENDING',
        }),
      }),
    );

    expect(mockPrisma.acctEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventCode: 'EVT_DEPOSIT_SUCCESS__FIAT' },
        update: expect.objectContaining({
          toStatus: 'SUCCESS',
        }),
      }),
    );

    expect(mockPrisma.journalHeaderTemplate.deleteMany).toHaveBeenCalledWith({
      where: {
        eventCode: {
          in: ['EVT_DEPOSIT_REJECTED__CRYPTO', 'EVT_DEPOSIT_REJECTED__FIAT'],
        },
      },
    });

    expect(mockPrisma.acctEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        eventCode: {
          in: ['EVT_DEPOSIT_REJECTED__CRYPTO', 'EVT_DEPOSIT_REJECTED__FIAT'],
        },
      },
    });
  });

  it('onModuleInit should auto-sync in non-production', async () => {
    process.env.NODE_ENV = 'development';
    const syncSpy = jest
      .spyOn(service, 'syncDefaults')
      .mockResolvedValue({ success: true, message: 'ok' } as any);
    const validateSpy = jest
      .spyOn(service as any, 'validateDepositEventContract')
      .mockResolvedValue({ ok: true, issues: [] });

    await service.onModuleInit();

    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(validateSpy).toHaveBeenCalledTimes(1);
  });

  it('onModuleInit should validate only in production (no auto-sync)', async () => {
    process.env.NODE_ENV = 'production';
    const syncSpy = jest
      .spyOn(service, 'syncDefaults')
      .mockResolvedValue({ success: true, message: 'ok' } as any);
    const validateSpy = jest
      .spyOn(service as any, 'validateDepositEventContract')
      .mockResolvedValue({ ok: true, issues: [] });

    await service.onModuleInit();

    expect(syncSpy).not.toHaveBeenCalled();
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
