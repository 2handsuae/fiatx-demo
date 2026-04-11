import { TransactionComplianceService } from './transaction-compliance.service';
import {
  KytScreeningStage,
  TxSourceType,
} from './types/tx-compliance.types';
import { TransactionRiskBridgeService } from './transaction-risk-bridge.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';

describe('TransactionComplianceService', () => {
  const prismaMock: any = {
    kytCase: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    kytCaseReport: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    travelRuleCase: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
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
    payin: {
      findUnique: jest.fn(),
    },
    inboundTransferSignal: {
      findUnique: jest.fn(),
    },
    withdrawTransaction: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  };

  let service: TransactionComplianceService;
  const buildBridgeMock = () =>
    ({
      handleDepositKytUpdate: jest.fn().mockResolvedValue({ skipped: false }),
      handleDepositTravelRuleUpdate: jest.fn().mockResolvedValue({ skipped: false }),
      handleDepositFinalReviewIfReady: jest.fn().mockResolvedValue({ skipped: false }),
      handleDirectDepositFinalReview: jest.fn().mockResolvedValue({ skipped: false }),
      handleWithdrawPrecheckReview: jest.fn().mockResolvedValue({ skipped: false }),
      handleWithdrawFinalReviewIfReady: jest.fn().mockResolvedValue({ skipped: false }),
      initializeWithdrawFinalReview: jest.fn().mockResolvedValue({ skipped: false }),
    }) as unknown as TransactionRiskBridgeService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AuditLogsService.prototype, 'recordSystem').mockResolvedValue({} as any);
    jest.spyOn(AuditLogsService.prototype, 'recordByActor').mockResolvedValue({} as any);
    prismaMock.payin.findUnique.mockResolvedValue(null);
    prismaMock.inboundTransferSignal.findUnique.mockResolvedValue(null);
    service = new TransactionComplianceService(prismaMock, buildBridgeMock() as any);
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

  it('should create FINAL pre-KYT and Travel Rule response containers for crypto withdraw', async () => {
    prismaMock.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-1',
      ownerType: 'CUSTOMER',
      ownerId: 'c-1',
      assetId: 'asset-1',
      travelRuleRequired: true,
      toAddress: 'TTEST0001',
      toIban: null,
      asset: {
        type: 'CRYPTO',
        code: 'USDT',
        network: 'TRON',
      },
    });

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
        status: 'FINAL',
        provider: 'SYSTEM',
      }),
    );
    expect(upsertTravelSpy).toHaveBeenCalledTimes(1);
    expect(upsertTravelSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sourceType: TxSourceType.WITHDRAW,
        sourceId: 'wd-1',
        status: 'FINAL',
        required: true,
        provider: 'SYSTEM',
      }),
    );
    expect(syncSpy).toHaveBeenCalledWith('wd-1', undefined);
  });

  it('should not create response containers for fiat withdraw', async () => {
    prismaMock.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-fiat-1',
      ownerType: 'CUSTOMER',
      ownerId: 'c-1',
      assetId: 'asset-fiat-1',
      travelRuleRequired: false,
      toAddress: null,
      toIban: 'AE1000000001',
      asset: {
        type: 'FIAT',
        code: 'USD',
        network: null,
      },
    });

    const upsertKytSpy = jest
      .spyOn(service, 'upsertKytCaseAndAppendReport')
      .mockResolvedValue({} as any);
    const upsertTravelSpy = jest
      .spyOn(service, 'upsertTravelRuleCaseAndAppendReport')
      .mockResolvedValue({} as any);
    const syncSpy = jest
      .spyOn(service, 'syncWithdrawSnapshotFromCases')
      .mockResolvedValue({} as any);

    await service.ensureWithdrawPreKytCaseOnCreate('wd-fiat-1');

    expect(upsertKytSpy).not.toHaveBeenCalled();
    expect(upsertTravelSpy).not.toHaveBeenCalled();
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('should delegate withdraw final review initialization to the risk bridge', async () => {
    const bridgeMock = buildBridgeMock();
    const complianceService = new TransactionComplianceService(
      prismaMock,
      bridgeMock as any,
    );

    await complianceService.initializeWithdrawFinalDecisionRecord('wd-init-1');

    expect(bridgeMock.initializeWithdrawFinalReview).toHaveBeenCalledWith(
      'wd-init-1',
      undefined,
    );
  });

  it('should not auto-trigger withdraw risk bridge from KYT response containers', async () => {
    const bridgeMock = buildBridgeMock();
    const complianceService = new TransactionComplianceService(
      prismaMock,
      bridgeMock as any,
    );

    prismaMock.kytCase.upsert.mockResolvedValue({
      id: 'kyt-wd-1',
      caseNo: 'KYT-WD-1',
      sourceType: TxSourceType.WITHDRAW,
      sourceId: 'wd-bridge-1',
      screeningStage: KytScreeningStage.PRE_TXN,
      ownerType: 'CUSTOMER',
      ownerId: 'c-1',
      provider: 'MOCK',
      providerCaseId: 'MOCK-KYT-WD-1',
      riskScore: 80,
      status: 'PASS',
    });
    prismaMock.kytCaseReport.create.mockResolvedValue({ id: 'kyt-report-wd-1' });

    await complianceService.upsertKytCaseAndAppendReport({
      sourceType: TxSourceType.WITHDRAW,
      sourceId: 'wd-bridge-1',
      screeningStage: KytScreeningStage.PRE_TXN,
      ownerType: 'CUSTOMER',
      ownerId: 'c-1',
      assetId: 'asset-1',
      provider: 'MOCK',
      providerCaseId: 'MOCK-KYT-WD-1',
      status: 'PASS',
      riskScore: 80,
    });

    expect(bridgeMock.handleWithdrawPrecheckReview).not.toHaveBeenCalled();
    expect(bridgeMock.handleWithdrawFinalReviewIfReady).not.toHaveBeenCalled();
    expect(bridgeMock.handleDepositFinalReviewIfReady).not.toHaveBeenCalled();
  });

  it('should not auto-trigger withdraw risk bridge from Travel Rule response containers', async () => {
    const bridgeMock = buildBridgeMock();
    const complianceService = new TransactionComplianceService(
      prismaMock,
      bridgeMock as any,
    );

    prismaMock.travelRuleCase.upsert.mockResolvedValue({
      id: 'trv-wd-1',
      caseNo: 'TRV-WD-1',
      sourceType: TxSourceType.WITHDRAW,
      sourceId: 'wd-bridge-1',
      ownerType: 'CUSTOMER',
      ownerId: 'c-1',
      provider: 'MOCK',
      providerTransferId: 'MOCK-TRV-WD-1',
      required: true,
      status: 'FINAL',
      counterpartyVasp: null,
    });
    prismaMock.travelRuleCaseReport.create.mockResolvedValue({
      id: 'trv-report-wd-1',
    });

    await complianceService.upsertTravelRuleCaseAndAppendReport({
      sourceType: TxSourceType.WITHDRAW,
      sourceId: 'wd-bridge-1',
      ownerType: 'CUSTOMER',
      ownerId: 'c-1',
      assetId: 'asset-1',
      provider: 'MOCK',
      providerTransferId: 'MOCK-TRV-WD-1',
      required: true,
      status: 'FINAL',
    });

    expect(bridgeMock.handleWithdrawFinalReviewIfReady).not.toHaveBeenCalled();
    expect(bridgeMock.handleDepositFinalReviewIfReady).not.toHaveBeenCalled();
  });

  it('should create KYT and Travel on payin confirmed for crypto deposit', async () => {
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
        status: 'FINAL',
      }),
    );
    expect(upsertTravelSpy).toHaveBeenCalledTimes(1);
    expect(upsertTravelSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sourceType: TxSourceType.DEPOSIT,
        sourceId: 'dep-1',
        status: 'FINAL',
      }),
    );
    expect(syncSpy).toHaveBeenCalledWith('dep-1', undefined);

    modeSpy.mockRestore();
  });

  it('should auto-fill terminal KYT and Travel responses for interactive payin confirm even when provider mode is MOCK', async () => {
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-interactive-1',
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
      .mockReturnValue('MOCK');
    const upsertKytSpy = jest
      .spyOn(service, 'upsertKytCaseAndAppendReport')
      .mockResolvedValue({} as any);
    const upsertTravelSpy = jest
      .spyOn(service, 'upsertTravelRuleCaseAndAppendReport')
      .mockResolvedValue({} as any);
    const syncSpy = jest
      .spyOn(service, 'syncDepositSnapshotFromCases')
      .mockResolvedValue({} as any);

    await service.ensureInteractiveDepositMainCasesOnPayinConfirmed(
      'dep-interactive-1',
      'payin-interactive-1',
    );

    const kytPayload = upsertKytSpy.mock.calls[0][0];
    expect(upsertKytSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: TxSourceType.DEPOSIT,
        sourceId: 'dep-interactive-1',
        status: 'FINAL',
      }),
      undefined,
    );
    expect(upsertTravelSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: TxSourceType.DEPOSIT,
        sourceId: 'dep-interactive-1',
        status: 'FINAL',
      }),
      undefined,
    );
    expect(kytPayload.rawPayload).not.toHaveProperty('simulationRiskLevel');
    expect(kytPayload.rawPayload).not.toHaveProperty('simulationRiskReason');
    expect(kytPayload.normalizedPayload).not.toHaveProperty('simulationRiskLevel');
    expect(kytPayload.normalizedPayload).not.toHaveProperty('simulationRiskReason');
    const travelPayload = upsertTravelSpy.mock.calls[0][0];
    expect(travelPayload.rawPayload).not.toHaveProperty('simulationRiskLevel');
    expect(travelPayload.rawPayload).not.toHaveProperty('simulationRiskReason');
    expect(travelPayload.normalizedPayload).not.toHaveProperty('simulationRiskLevel');
    expect(travelPayload.normalizedPayload).not.toHaveProperty('simulationRiskReason');
    expect(syncSpy).toHaveBeenCalledWith('dep-interactive-1', undefined);

    modeSpy.mockRestore();
  });

  it('should route fiat payin confirmed into direct final review without creating KYT or Travel cases', async () => {
    const bridgeMock = buildBridgeMock();
    const serviceWithBridge = new TransactionComplianceService(
      prismaMock,
      bridgeMock,
    );
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-fiat-1',
      ownerType: 'CUSTOMER',
      ownerId: 'c-fiat-1',
      assetId: 'asset-fiat-1',
      travelRuleRequired: false,
      asset: {
        type: 'FIAT',
      },
    });
    const upsertKytSpy = jest
      .spyOn(serviceWithBridge, 'upsertKytCaseAndAppendReport')
      .mockResolvedValue({} as any);
    const upsertTravelSpy = jest
      .spyOn(serviceWithBridge, 'upsertTravelRuleCaseAndAppendReport')
      .mockResolvedValue({} as any);
    const syncSpy = jest
      .spyOn(serviceWithBridge, 'syncDepositSnapshotFromCases')
      .mockResolvedValue({} as any);

    const result = await serviceWithBridge.ensureDepositMainCasesOnPayinConfirmed(
      'dep-fiat-1',
      'payin-fiat-1',
    );

    expect(upsertKytSpy).not.toHaveBeenCalled();
    expect(upsertTravelSpy).not.toHaveBeenCalled();
    expect(syncSpy).not.toHaveBeenCalled();
    expect((bridgeMock as any).handleDirectDepositFinalReview).toHaveBeenCalledWith(
      expect.objectContaining({
        depositId: 'dep-fiat-1',
        sourceType: TxSourceType.DEPOSIT,
        sourceId: 'dep-fiat-1',
        triggerStatus: 'PAYIN_CONFIRMED',
        kytStatus: 'FINAL',
        travelRuleRequired: false,
        travelRuleStatus: 'FINAL',
      }),
      undefined,
    );
    expect(result).toEqual({ skipped: false });
  });

  it('should create terminal KYT response on crypto payout confirmed', async () => {
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
    expect(upsertKytSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: TxSourceType.WITHDRAW,
        sourceId: 'wd-2',
        screeningStage: KytScreeningStage.MAIN,
        status: 'FINAL',
        provider: 'SYSTEM',
      }),
      undefined,
    );
    expect(upsertTravelSpy).not.toHaveBeenCalled();
    expect(syncSpy).toHaveBeenCalledWith('wd-2', undefined);
  });

  it('should sync withdraw response snapshots without persisting compliance disposition', async () => {
    prismaMock.withdrawTransaction.findUnique.mockResolvedValue({
      status: 'PAYOUT_PENDING',
    });
    prismaMock.kytCase.findUnique
      .mockResolvedValueOnce({
        status: 'FINAL',
        providerCaseId: 'pre-1',
        riskScore: 10,
        checkedAt: new Date('2026-02-14T10:00:00.000Z'),
      })
      .mockResolvedValueOnce(null);
    prismaMock.travelRuleCase.findUnique.mockResolvedValue({
      status: 'FINAL',
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
        preKytStatus: 'FINAL',
        kytStatus: '',
        travelRuleRequired: false,
        travelRuleStatus: 'FINAL',
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
    prismaMock.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-9',
      withdrawNo: 'WD0009',
      status: 'PAYOUT_PENDING',
      ownerType: 'CUSTOMER',
      ownerId: 'c-9',
      ownerNo: 'CU0009',
      payoutId: null,
      payoutNo: null,
      assetId: 'asset-1',
      amount: null,
      netAmount: null,
      feeAmount: null,
      preKytStatus: 'FINAL',
      kytStatus: null,
      travelRuleStatus: 'FINAL',
      travelRuleRequired: true,
      preKytRiskScore: null,
      kytRiskScore: null,
    });
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
      status: 'FINAL',
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
    expect(result.preKytCase?.status).toBe('FINAL');
    expect(result.mainKytCase?.status).toBe('FINAL');
  });

  it('should normalize legacy lifecycle statuses in response list APIs', async () => {
    prismaMock.kytCase.findMany.mockResolvedValue([
      {
        id: 'kyt-list-1',
        caseNo: 'KYT-LIST-1',
        sourceType: TxSourceType.WITHDRAW,
        sourceId: 'wd-list-1',
        screeningStage: KytScreeningStage.PRE_TXN,
        provider: 'MOCK',
        status: 'PASS',
        updatedAt: new Date('2026-03-28T10:00:00.000Z'),
      },
      {
        id: 'kyt-list-2',
        caseNo: 'KYT-LIST-2',
        sourceType: TxSourceType.WITHDRAW,
        sourceId: 'wd-list-2',
        screeningStage: KytScreeningStage.MAIN,
        provider: 'MOCK',
        status: 'PENDING',
        updatedAt: new Date('2026-03-28T10:05:00.000Z'),
      },
    ]);
    prismaMock.kytCase.count.mockResolvedValue(2);
    prismaMock.travelRuleCase.findMany.mockResolvedValue([
      {
        id: 'trv-list-1',
        caseNo: 'TRV-LIST-1',
        sourceType: TxSourceType.DEPOSIT,
        sourceId: 'dep-list-1',
        provider: 'MOCK',
        required: true,
        status: 'ACCEPTED',
        updatedAt: new Date('2026-03-28T10:10:00.000Z'),
      },
      {
        id: 'trv-list-2',
        caseNo: 'TRV-LIST-2',
        sourceType: TxSourceType.DEPOSIT,
        sourceId: 'dep-list-2',
        provider: 'MOCK',
        required: true,
        status: 'SENT',
        updatedAt: new Date('2026-03-28T10:15:00.000Z'),
      },
    ]);
    prismaMock.travelRuleCase.count.mockResolvedValue(2);

    const kytResult = await service.listKytCases({ status: 'FINAL' } as any);
    const travelResult = await service.listTravelRuleCases({
      status: 'FINAL',
    } as any);

    expect(kytResult.items.map((item: any) => item.status)).toEqual([
      'FINAL',
      'RECEIVED',
    ]);
    expect(travelResult.items.map((item: any) => item.status)).toEqual([
      'FINAL',
      'RECEIVED',
    ]);
    expect(prismaMock.kytCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: expect.objectContaining({
            in: expect.arrayContaining(['FINAL', 'PASS']),
          }),
        }),
      }),
    );
    expect(prismaMock.travelRuleCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: expect.objectContaining({
            in: expect.arrayContaining(['FINAL', 'ACCEPTED', 'NOT_REQUIRED']),
          }),
        }),
      }),
    );
  });

  it('should default mock-complete response containers to FINAL lifecycle', async () => {
    prismaMock.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-mock-1',
      withdrawNo: 'WD-MOCK-1',
      ownerType: 'CUSTOMER',
      ownerId: 'c-1',
      ownerNo: 'CU-1',
      assetId: 'asset-1',
      customer: {
        customerNo: 'CU-1',
      },
    });

    const upsertKytSpy = jest
      .spyOn(service, 'upsertKytCaseAndAppendReport')
      .mockResolvedValue({} as any);
    const upsertTravelSpy = jest
      .spyOn(service, 'upsertTravelRuleCaseAndAppendReport')
      .mockResolvedValue({} as any);
    const syncSpy = jest
      .spyOn(service, 'syncWithdrawSnapshotFromCases')
      .mockResolvedValue({} as any);

    await service.mockCompleteKytCase({
      sourceType: TxSourceType.WITHDRAW,
      sourceId: 'wd-mock-1',
      assetId: 'asset-1',
    } as any);
    await service.mockCompleteTravelRuleCase({
      sourceType: TxSourceType.WITHDRAW,
      sourceId: 'wd-mock-1',
      assetId: 'asset-1',
      required: true,
    } as any);

    expect(upsertKytSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FINAL',
      }),
      undefined,
    );
    expect(upsertTravelSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FINAL',
      }),
      undefined,
    );
    expect(syncSpy).toHaveBeenCalledWith('wd-mock-1', undefined);
  });

  it('should bridge deposit KYT REVIEW into transaction risk workflow', async () => {
    const bridgeMock = buildBridgeMock();
    const serviceWithBridge = new TransactionComplianceService(
      prismaMock,
      bridgeMock,
    );
    prismaMock.kytCase.findUnique.mockResolvedValueOnce(null);
    prismaMock.kytCase.upsert.mockResolvedValue({
      id: 'kyt-bridge-1',
      caseNo: 'KYT2603010001',
      sourceType: TxSourceType.DEPOSIT,
      sourceId: 'dep-bridge-1',
      screeningStage: KytScreeningStage.MAIN,
      ownerType: 'CUSTOMER',
      ownerId: 'c-bridge-1',
      provider: 'EXTERNAL',
      providerCaseId: 'provider-kyt-1',
      riskScore: 87,
      status: 'REVIEW',
    });
    prismaMock.kytCaseReport.create.mockResolvedValue({ id: 'kyt-report-1' });
    jest
      .spyOn(serviceWithBridge, 'getTransactionCaseAggregate')
      .mockResolvedValue({
        sourceType: TxSourceType.DEPOSIT,
        sourceId: 'dep-bridge-1',
        preKytCase: null,
        mainKytCase: {
          id: 'kyt-bridge-1',
          caseNo: 'KYT2603010001',
          status: 'REVIEW',
          provider: 'EXTERNAL',
          providerCaseId: 'provider-kyt-1',
          riskScore: 87,
        },
        travelRuleCase: null,
        derivedComplianceStatus: 'HOLD',
      } as any);

    await serviceWithBridge.upsertKytCaseAndAppendReport({
      sourceType: TxSourceType.DEPOSIT,
      sourceId: 'dep-bridge-1',
      screeningStage: KytScreeningStage.MAIN,
      ownerType: 'CUSTOMER',
      ownerId: 'c-bridge-1',
      assetId: 'asset-bridge-1',
      status: 'REVIEW',
      provider: 'EXTERNAL',
      providerCaseId: 'provider-kyt-1',
      riskScore: 87,
    });

    expect((bridgeMock as any).handleDepositFinalReviewIfReady).toHaveBeenCalledWith(
      expect.objectContaining({
        depositId: 'dep-bridge-1',
        sourceType: TxSourceType.DEPOSIT,
        triggerSource: 'KYT',
        triggerStatus: 'FINAL',
        reportDeduped: false,
      }),
      undefined,
    );
  });

  it('should skip travel rule risk bridge when callback report is deduped', async () => {
    const bridgeMock = buildBridgeMock();
    const serviceWithBridge = new TransactionComplianceService(
      prismaMock,
      bridgeMock,
    );
    prismaMock.travelRuleCase.findUnique.mockResolvedValue({
      id: 'trv-existing-1',
      caseNo: 'TRV2603010001',
      status: 'REJECTED',
    });
    prismaMock.travelRuleCase.upsert.mockResolvedValue({
      id: 'trv-existing-1',
      caseNo: 'TRV2603010001',
      sourceType: TxSourceType.DEPOSIT,
      sourceId: 'dep-bridge-2',
      ownerType: 'CUSTOMER',
      ownerId: 'c-bridge-2',
      provider: 'EXTERNAL',
      providerTransferId: 'transfer-1',
      required: true,
      status: 'REJECTED',
      counterpartyVasp: 'VASP-X',
    });
    prismaMock.travelRuleCaseReport.findFirst.mockResolvedValue({
      id: 'trv-report-1',
    });

    await serviceWithBridge.upsertTravelRuleCaseAndAppendReport(
      {
        sourceType: TxSourceType.DEPOSIT,
        sourceId: 'dep-bridge-2',
        ownerType: 'CUSTOMER',
        ownerId: 'c-bridge-2',
        assetId: 'asset-bridge-2',
        provider: 'EXTERNAL',
        providerTransferId: 'transfer-1',
        required: true,
        status: 'REJECTED',
        counterpartyVasp: 'VASP-X',
      },
      undefined,
      { dedupeReport: true },
    );

    expect((bridgeMock as any).handleDepositFinalReviewIfReady).not.toHaveBeenCalled();
  });
});
