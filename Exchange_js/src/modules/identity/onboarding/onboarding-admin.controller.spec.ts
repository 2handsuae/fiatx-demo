import { ForbiddenException } from '@nestjs/common';
import { OnboardingAdminController } from './onboarding-admin.controller';
import { OnboardingService } from './onboarding.service';
import { RiskDecisionRecordsService } from '../../risk-engine/risk-decision-records.service';

describe('OnboardingAdminController', () => {
  const onboardingServiceMock = {
    listCddResponses: jest.fn(),
    getCddResponseDetail: jest.fn(),
    listEddResponses: jest.fn(),
    getEddResponseDetail: jest.fn(),
    applyOnboardingDecisionFromAlert: jest.fn(),
    applyOnboardingDecisionFromIncident: jest.fn(),
    simulateCustomerExpired: jest.fn(),
    updateInvestorClassification: jest.fn(),
  };

  const riskDecisionRecordsServiceMock = {
    listDecisionRecords: jest.fn(),
    getDecisionRecordDetail: jest.fn(),
  };

  let controller: OnboardingAdminController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new OnboardingAdminController(
      onboardingServiceMock as unknown as OnboardingService,
      riskDecisionRecordsServiceMock as unknown as RiskDecisionRecordsService,
    );
  });

  it('should reject customer token for compatibility list endpoint', async () => {
    expect(() =>
      controller.listDecisionRecords({ user: { type: 'CUSTOMER' } }, {} as any),
    ).toThrow(ForbiddenException);
  });

  it('should map customerId query to ownerId on compatibility list endpoint', async () => {
    riskDecisionRecordsServiceMock.listDecisionRecords.mockResolvedValue({
      total: 1,
      items: [],
    });

    const result = await controller.listDecisionRecords(
      { user: { type: 'ADMIN' } },
      {
        status: 'COMPLETED',
        customerId: 'c1',
        subjectId: 'sub-1',
      } as any,
    );

    expect(riskDecisionRecordsServiceMock.listDecisionRecords).toHaveBeenCalledWith({
      status: 'COMPLETED',
      contextType: undefined,
      outputDecision: undefined,
      ownerId: 'c1',
      subjectId: 'sub-1',
      policyVersion: undefined,
      skip: undefined,
      take: undefined,
    });
    expect(result.total).toBe(1);
  });

  it('should delegate detail on compatibility endpoint to risk service', async () => {
    riskDecisionRecordsServiceMock.getDecisionRecordDetail.mockResolvedValue({ id: 'dr-1' });

    const result = await controller.getDecisionRecordDetail(
      { user: { type: 'ADMIN' } },
      'dr-1',
    );

    expect(riskDecisionRecordsServiceMock.getDecisionRecordDetail).toHaveBeenCalledWith('dr-1');
    expect(result).toEqual({ id: 'dr-1' });
  });

  it('should expose canonical case onboarding-decision route with proposalCode payload', async () => {
    onboardingServiceMock.applyOnboardingDecisionFromIncident.mockResolvedValue({
      case: { id: 'inc-1', caseNo: 'CAS2603010001' },
      alert: { id: 'alert-1' },
      customer: { id: 'c1', onboardingStatus: 'APPROVED', operatingStatus: 'ACTIVE' },
    });

    const result = await controller.applyOnboardingDecisionFromCase(
      {
        user: {
          type: 'ADMIN',
          userId: 'admin-1',
          role: 'MLRO',
        },
      },
      'inc-1',
      { proposalCode: 'CLEAR' } as any,
    );

    expect(onboardingServiceMock.applyOnboardingDecisionFromIncident).toHaveBeenCalledWith(
      'inc-1',
      'admin-1',
      'MLRO',
      { proposalCode: 'CLEAR' },
    );
    expect(result.case).toEqual({ id: 'inc-1', caseNo: 'CAS2603010001' });
    expect(result).not.toHaveProperty('incident');
  });

  it('should keep legacy decision payload compatibility on case onboarding-decision route', async () => {
    onboardingServiceMock.applyOnboardingDecisionFromIncident.mockResolvedValue({
      case: { id: 'inc-1', caseNo: 'CAS2603010001' },
      alert: { id: 'alert-1' },
      proposal: { workflowDecision: 'REJECT', finalDispositionCode: 'RISK_CONFIRMED' },
    });

    await controller.applyOnboardingDecisionFromCase(
      {
        user: {
          type: 'ADMIN',
          userId: 'admin-1',
          role: 'MLRO',
        },
      },
      'inc-1',
      { decision: 'REJECT', reason: 'legacy client' } as any,
    );

    expect(onboardingServiceMock.applyOnboardingDecisionFromIncident).toHaveBeenCalledWith(
      'inc-1',
      'admin-1',
      'MLRO',
      { decision: 'REJECT', reason: 'legacy client' },
    );
  });
});
