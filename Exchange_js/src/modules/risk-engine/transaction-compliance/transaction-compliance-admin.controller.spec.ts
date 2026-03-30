import { ForbiddenException } from '@nestjs/common';
import { TransactionComplianceAdminController } from './transaction-compliance-admin.controller';
import { TransactionComplianceService } from './transaction-compliance.service';
import {
  KytScreeningStage,
  TxSourceType,
} from './types/tx-compliance.types';

describe('TransactionComplianceAdminController', () => {
  const serviceMock = {
    callbackKytCase: jest.fn(),
    callbackTravelRuleCase: jest.fn(),
    getTransactionCaseAggregate: jest.fn(),
    mockCompleteKytCase: jest.fn(),
    mockCompleteTravelRuleCase: jest.fn(),
    listKytCases: jest.fn(),
    listTravelRuleCases: jest.fn(),
    getKytCaseDetail: jest.fn(),
    getTravelRuleCaseDetail: jest.fn(),
  };

  let controller: TransactionComplianceAdminController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new TransactionComplianceAdminController(
      serviceMock as unknown as TransactionComplianceService,
    );
  });

  it('should reject customer token for mockCompleteKytCase', async () => {
    expect(() =>
      controller.mockCompleteKytCase(
        { user: { type: 'CUSTOMER' } },
        {
          sourceType: TxSourceType.DEPOSIT,
          sourceId: 'dep-1',
          screeningStage: KytScreeningStage.MAIN,
        },
      ),
    ).toThrow(ForbiddenException);
  });

  it('should allow admin token for mockCompleteKytCase', async () => {
    serviceMock.mockCompleteKytCase.mockResolvedValue({ ok: true });

    const result = await controller.mockCompleteKytCase(
      { user: { type: 'ADMIN' } },
      {
        sourceType: TxSourceType.DEPOSIT,
        sourceId: 'dep-1',
        screeningStage: KytScreeningStage.MAIN,
      },
    );

    expect(serviceMock.mockCompleteKytCase).toHaveBeenCalledWith({
      sourceType: TxSourceType.DEPOSIT,
      sourceId: 'dep-1',
      screeningStage: KytScreeningStage.MAIN,
    });
    expect(result).toEqual({ ok: true });
  });

  it('should reject callback when signature is invalid and signature mode enabled', async () => {
    process.env.TX_COMPLIANCE_CALLBACK_SIGNATURE = 'secret';
    expect(() =>
      controller.callbackKytCase(
        { user: { type: 'ADMIN' } },
        'bad-signature',
        {
          sourceType: TxSourceType.WITHDRAW,
          sourceId: 'wd-1',
          providerCaseId: 'kyt-001',
        },
      ),
    ).toThrow(ForbiddenException);
    delete process.env.TX_COMPLIANCE_CALLBACK_SIGNATURE;
  });

  it('should allow callback when signature is valid', async () => {
    process.env.TX_COMPLIANCE_CALLBACK_SIGNATURE = 'secret';
    serviceMock.callbackTravelRuleCase.mockResolvedValue({ ok: true });

    const result = await controller.callbackTravelRuleCase(
      {},
      'secret',
      {
        sourceType: TxSourceType.WITHDRAW,
        sourceId: 'wd-1',
        providerTransferId: 'trv-001',
      },
    );

    expect(serviceMock.callbackTravelRuleCase).toHaveBeenCalledWith({
      sourceType: TxSourceType.WITHDRAW,
      sourceId: 'wd-1',
      providerTransferId: 'trv-001',
    });
    expect(result).toEqual({ ok: true });
    delete process.env.TX_COMPLIANCE_CALLBACK_SIGNATURE;
  });

  it('should return aggregated tx cases for admin', async () => {
    serviceMock.getTransactionCaseAggregate.mockResolvedValue({
      sourceType: TxSourceType.WITHDRAW,
      sourceId: 'wd-1',
      preKytCase: null,
      mainKytCase: null,
      travelRuleCase: null,
      derivedComplianceStatus: 'PENDING',
    });

    const result = await controller.getTransactionCases(
      { user: { type: 'ADMIN' } },
      TxSourceType.WITHDRAW,
      'wd-1',
      'true',
      'false',
      '10',
      '5',
    );

    expect(serviceMock.getTransactionCaseAggregate).toHaveBeenCalledWith(
      TxSourceType.WITHDRAW,
      'wd-1',
      {
        includeReports: true,
        includePayload: false,
        limit: 10,
        offset: 5,
      },
    );
    expect(result.derivedComplianceStatus).toBe('PENDING');
  });

  it('should reject customer token for mock backfill', async () => {
    expect((controller as any).mockBackfill).toBeUndefined();
  });

  it('should allow admin to list travel rule cases', async () => {
    serviceMock.listTravelRuleCases.mockResolvedValue({ items: [], total: 0 });

    const result = await controller.listTravelRuleCases(
      { user: { type: 'ADMIN' } },
      {
        sourceType: TxSourceType.WITHDRAW,
      },
    );

    expect(serviceMock.listTravelRuleCases).toHaveBeenCalledWith({
      sourceType: TxSourceType.WITHDRAW,
    });
    expect(result.total).toBe(0);
  });

  it('should return KYT response detail for admin', async () => {
    serviceMock.getKytCaseDetail.mockResolvedValue({
      id: 'kyt-1',
      caseNo: 'KYT0001',
    });

    const result = await controller.getKytCaseDetail(
      { user: { type: 'ADMIN' } },
      'kyt-1',
      'true',
      'true',
      '10',
      '5',
    );

    expect(serviceMock.getKytCaseDetail).toHaveBeenCalledWith('kyt-1', {
      includeReports: true,
      includePayload: true,
      limit: 10,
      offset: 5,
    });
    expect(result.caseNo).toBe('KYT0001');
  });

  it('should return Travel Rule response detail for admin', async () => {
    serviceMock.getTravelRuleCaseDetail.mockResolvedValue({
      id: 'trv-1',
      caseNo: 'TRV0001',
    });

    const result = await controller.getTravelRuleCaseDetail(
      { user: { type: 'ADMIN' } },
      'trv-1',
      'true',
      'false',
      '20',
      '0',
    );

    expect(serviceMock.getTravelRuleCaseDetail).toHaveBeenCalledWith('trv-1', {
      includeReports: true,
      includePayload: false,
      limit: 20,
      offset: 0,
    });
    expect(result.caseNo).toBe('TRV0001');
  });
});
