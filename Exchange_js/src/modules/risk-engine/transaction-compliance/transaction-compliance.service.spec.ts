import { TransactionComplianceService } from './transaction-compliance.service';
import {
  KytScreeningStage,
  TxSourceType,
} from './types/tx-compliance.types';

describe('TransactionComplianceService', () => {
  const prismaMock: any = {
    kytCase: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
    kytCaseReport: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    travelRuleCase: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
    travelRuleCaseReport: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    depositTransaction: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    withdrawTransaction: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  };

  let service: TransactionComplianceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TransactionComplianceService(prismaMock);
  });

  it('should upsert KYT case idempotently and append reports', async () => {
    prismaMock.kytCase.upsert
      .mockResolvedValueOnce({
        id: 'kyt-1',
        sourceType: TxSourceType.DEPOSIT,
        sourceId: 'dep-1',
        screeningStage: KytScreeningStage.MAIN,
      })
      .mockResolvedValueOnce({
        id: 'kyt-1',
        sourceType: TxSourceType.DEPOSIT,
        sourceId: 'dep-1',
        screeningStage: KytScreeningStage.MAIN,
      });
    prismaMock.kytCaseReport.create
      .mockResolvedValueOnce({ id: 'r-1' })
      .mockResolvedValueOnce({ id: 'r-2' });

    await service.upsertKytCaseAndAppendReport({
      sourceType: TxSourceType.DEPOSIT,
      sourceId: 'dep-1',
      screeningStage: KytScreeningStage.MAIN,
      ownerType: 'CUSTOMER',
      ownerId: 'c-1',
      assetId: 'asset-1',
      status: 'PASS',
      riskScore: 12,
    });

    await service.upsertKytCaseAndAppendReport({
      sourceType: TxSourceType.DEPOSIT,
      sourceId: 'dep-1',
      screeningStage: KytScreeningStage.MAIN,
      ownerType: 'CUSTOMER',
      ownerId: 'c-1',
      assetId: 'asset-1',
      status: 'PASS',
      riskScore: 15,
    });

    expect(prismaMock.kytCase.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.kytCaseReport.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.kytCase.upsert.mock.calls[0][0].where).toEqual({
      sourceType_sourceId_screeningStage: {
        sourceType: TxSourceType.DEPOSIT,
        sourceId: 'dep-1',
        screeningStage: KytScreeningStage.MAIN,
      },
    });
  });

  it('should create PRE-KYT on withdraw create for crypto', async () => {
    prismaMock.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-1',
      ownerType: 'CUSTOMER',
      ownerId: 'c-1',
      assetId: 'asset-1',
      asset: {
        type: 'CRYPTO',
      },
    });

    const modeSpy = jest
      .spyOn(service as any, 'getProviderMode')
      .mockReturnValue('MOCK');
    const upsertKytSpy = jest
      .spyOn(service, 'upsertKytCaseAndAppendReport')
      .mockResolvedValue({} as any);
    const upsertTravelSpy = jest
      .spyOn(service, 'upsertTravelRuleCaseAndAppendReport')
      .mockResolvedValue({} as any);
    const syncSpy = jest
      .spyOn(service, 'syncWithdrawSnapshotFromCases')
      .mockResolvedValue({} as any);

    await service.ensureWithdrawPreKytCaseOnCreate('wd-1');

    expect(upsertKytSpy).toHaveBeenCalledTimes(1);
    expect(upsertKytSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sourceType: TxSourceType.WITHDRAW,
        sourceId: 'wd-1',
        screeningStage: KytScreeningStage.PRE_TXN,
      }),
    );
    expect(upsertTravelSpy).not.toHaveBeenCalled();
    expect(syncSpy).toHaveBeenCalledWith('wd-1', undefined);

    modeSpy.mockRestore();
  });

  it('should skip PRE-KYT creation on withdraw create for fiat', async () => {
    prismaMock.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-fiat-1',
      ownerType: 'CUSTOMER',
      ownerId: 'c-1',
      assetId: 'asset-fiat-1',
      asset: {
        type: 'FIAT',
      },
    });

    const upsertKytSpy = jest
      .spyOn(service, 'upsertKytCaseAndAppendReport')
      .mockResolvedValue({} as any);

    const result = await service.ensureWithdrawPreKytCaseOnCreate('wd-fiat-1');

    expect(upsertKytSpy).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('should create MAIN KYT and Travel on payin confirmed for crypto deposit', async () => {
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-1',
      ownerType: 'CUSTOMER',
      ownerId: 'c-1',
      assetId: 'asset-1',
      travelRuleRequired: true,
      asset: {
        type: 'CRYPTO',
      },
    });

    const modeSpy = jest
      .spyOn(service as any, 'getProviderMode')
      .mockReturnValue('MANUAL');
    const upsertKytSpy = jest
      .spyOn(service, 'upsertKytCaseAndAppendReport')
      .mockResolvedValue({} as any);
    const upsertTravelSpy = jest
      .spyOn(service, 'upsertTravelRuleCaseAndAppendReport')
      .mockResolvedValue({} as any);
    const syncSpy = jest
      .spyOn(service, 'syncDepositSnapshotFromCases')
      .mockResolvedValue({} as any);

    await service.ensureDepositMainCasesOnPayinConfirmed('dep-1', 'payin-1');

    expect(upsertKytSpy).toHaveBeenCalledTimes(1);
    expect(upsertKytSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sourceType: TxSourceType.DEPOSIT,
        sourceId: 'dep-1',
        screeningStage: KytScreeningStage.MAIN,
        status: 'PENDING',
      }),
    );
    expect(upsertTravelSpy).toHaveBeenCalledTimes(1);
    expect(upsertTravelSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sourceType: TxSourceType.DEPOSIT,
        sourceId: 'dep-1',
        status: 'PENDING',
      }),
    );
    expect(syncSpy).toHaveBeenCalledWith('dep-1', undefined);

    modeSpy.mockRestore();
  });

  it('should create MAIN KYT and Travel on payout confirmed for crypto withdraw', async () => {
    prismaMock.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-2',
      ownerType: 'CUSTOMER',
      ownerId: 'c-2',
      assetId: 'asset-2',
      travelRuleRequired: true,
      asset: {
        type: 'CRYPTO',
      },
    });

    const modeSpy = jest
      .spyOn(service as any, 'getProviderMode')
      .mockReturnValue('MANUAL');
    const upsertKytSpy = jest
      .spyOn(service, 'upsertKytCaseAndAppendReport')
      .mockResolvedValue({} as any);
    const upsertTravelSpy = jest
      .spyOn(service, 'upsertTravelRuleCaseAndAppendReport')
      .mockResolvedValue({} as any);
    const syncSpy = jest
      .spyOn(service, 'syncWithdrawSnapshotFromCases')
      .mockResolvedValue({} as any);

    await service.ensureWithdrawMainCasesOnPayoutConfirmed('wd-2', 'payout-2');

    expect(upsertKytSpy).toHaveBeenCalledTimes(1);
    expect(upsertKytSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sourceType: TxSourceType.WITHDRAW,
        sourceId: 'wd-2',
        screeningStage: KytScreeningStage.MAIN,
        status: 'PENDING',
      }),
    );
    expect(upsertTravelSpy).toHaveBeenCalledTimes(1);
    expect(upsertTravelSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sourceType: TxSourceType.WITHDRAW,
        sourceId: 'wd-2',
        status: 'PENDING',
      }),
    );
    expect(syncSpy).toHaveBeenCalledWith('wd-2', undefined);

    modeSpy.mockRestore();
  });

  it('should derive withdraw compliance status CLEAR when all case checks pass', async () => {
    prismaMock.kytCase.findUnique
      .mockResolvedValueOnce({
        status: 'PASS',
        providerCaseId: 'pre-1',
        riskScore: 10,
        checkedAt: new Date('2026-02-14T10:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        status: 'PASS',
        providerCaseId: 'main-1',
        riskScore: 20,
        checkedAt: new Date('2026-02-14T10:01:00.000Z'),
      });
    prismaMock.travelRuleCase.findUnique.mockResolvedValue({
      status: 'NOT_REQUIRED',
      required: false,
      providerTransferId: 'trv-1',
      counterpartyVasp: null,
      checkedAt: new Date('2026-02-14T10:02:00.000Z'),
    });
    prismaMock.withdrawTransaction.update.mockResolvedValue({ id: 'wd-2' });

    await service.syncWithdrawSnapshotFromCases('wd-2');

    expect(prismaMock.withdrawTransaction.update).toHaveBeenCalledWith({
      where: { id: 'wd-2' },
      data: expect.objectContaining({
        preKytStatus: 'PASS',
        kytStatus: 'PASS',
        travelRuleRequired: false,
        travelRuleStatus: 'NOT_REQUIRED',
        complianceStatus: 'CLEAR',
      }),
    });
  });

  it('should dedupe repeated KYT callback report by provider payload fingerprint', async () => {
    prismaMock.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-3',
      ownerType: 'CUSTOMER',
      ownerId: 'c-1',
      assetId: 'asset-1',
    });
    prismaMock.kytCase.upsert.mockResolvedValue({
      id: 'kyt-wd-3-main',
      sourceType: TxSourceType.WITHDRAW,
      sourceId: 'wd-3',
      screeningStage: KytScreeningStage.MAIN,
    });
    prismaMock.kytCaseReport.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'r-existing' });
    prismaMock.kytCaseReport.create.mockResolvedValue({ id: 'r-created' });
    prismaMock.kytCase.findUnique.mockResolvedValue({
      id: 'kyt-wd-3-main',
      sourceType: TxSourceType.WITHDRAW,
      sourceId: 'wd-3',
      screeningStage: KytScreeningStage.MAIN,
      status: 'PASS',
      providerCaseId: 'provider-kyt-1',
      riskScore: 12,
      checkedAt: new Date('2026-02-19T10:00:00.000Z'),
      reports: [],
    });
    prismaMock.travelRuleCase.findUnique.mockResolvedValue({
      id: 'trv-wd-3',
      sourceType: TxSourceType.WITHDRAW,
      sourceId: 'wd-3',
      status: 'NOT_REQUIRED',
      required: false,
      providerTransferId: 'provider-trv-1',
      reports: [],
    });
    prismaMock.withdrawTransaction.update.mockResolvedValue({ id: 'wd-3' });

    await service.callbackKytCase({
      sourceType: TxSourceType.WITHDRAW,
      sourceId: 'wd-3',
      screeningStage: KytScreeningStage.MAIN,
      provider: 'CHAINALYSIS',
      providerCaseId: 'provider-kyt-1',
      status: 'CLEAR',
      riskScore: 12,
      checkedAt: '2026-02-19T10:00:00.000Z',
      normalizedPayload: { status: 'PASS', riskScore: 12 },
    });

    await service.callbackKytCase({
      sourceType: TxSourceType.WITHDRAW,
      sourceId: 'wd-3',
      screeningStage: KytScreeningStage.MAIN,
      provider: 'CHAINALYSIS',
      providerCaseId: 'provider-kyt-1',
      status: 'CLEAR',
      riskScore: 12,
      checkedAt: '2026-02-19T10:00:00.000Z',
      normalizedPayload: { status: 'PASS', riskScore: 12 },
    });

    expect(prismaMock.kytCaseReport.create).toHaveBeenCalledTimes(1);
  });

  it('should aggregate withdraw compliance status to CLEAR', async () => {
    prismaMock.kytCase.findUnique
      .mockResolvedValueOnce({
        id: 'kyt-pre',
        sourceType: TxSourceType.WITHDRAW,
        sourceId: 'wd-9',
        screeningStage: KytScreeningStage.PRE_TXN,
        status: 'PASS',
        reports: [],
      })
      .mockResolvedValueOnce({
        id: 'kyt-main',
        sourceType: TxSourceType.WITHDRAW,
        sourceId: 'wd-9',
        screeningStage: KytScreeningStage.MAIN,
        status: 'PASS',
        reports: [],
      });
    prismaMock.travelRuleCase.findUnique.mockResolvedValue({
      id: 'trv-main',
      sourceType: TxSourceType.WITHDRAW,
      sourceId: 'wd-9',
      status: 'ACCEPTED',
      required: true,
      reports: [],
    });

    const result = await service.getTransactionCaseAggregate(
      TxSourceType.WITHDRAW,
      'wd-9',
      {
        includeReports: true,
        includePayload: false,
      },
    );

    expect(result.derivedComplianceStatus).toBe('CLEAR');
    expect(result.preKytCase?.screeningStage).toBe(KytScreeningStage.PRE_TXN);
    expect(result.mainKytCase?.screeningStage).toBe(KytScreeningStage.MAIN);
  });
});
