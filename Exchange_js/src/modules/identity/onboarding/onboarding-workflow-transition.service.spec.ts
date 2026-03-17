import { BadRequestException } from '@nestjs/common';
import {
  OnboardingWorkflowTransitionService,
  WORKFLOW_TRANSITION_CODES,
} from './onboarding-workflow-transition.service';

describe('OnboardingWorkflowTransitionService', () => {
  const txMock: any = {
    customerMain: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    cddCase: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    eddCase: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    onboardingAuditLog: {
      create: jest.fn(),
    },
    onboardingDecisionRecord: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  let service: OnboardingWorkflowTransitionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OnboardingWorkflowTransitionService();
    txMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      publicStatus: 'REVIEW_CDD',
      currentCddCaseId: 'cdd-1',
      currentEddCaseId: null,
      activeCaseId: 'cdd-1',
      finalApprovalStatus: 'NOT_REQUIRED',
      latestDecisionRecordId: 'dr-1',
    });
    txMock.cddCase.findUnique.mockResolvedValue({
      id: 'cdd-1',
      customerId: 'c1',
    });
    txMock.cddCase.findFirst.mockResolvedValue({
      id: 'cdd-1',
      customerId: 'c1',
    });
    txMock.cddCase.update.mockResolvedValue({ id: 'cdd-1' });
    txMock.eddCase.findFirst.mockResolvedValue(null);
    txMock.eddCase.create.mockResolvedValue({
      id: 'edd-1',
      customerId: 'c1',
      cddCaseId: 'cdd-1',
      journeyId: 'ONB-1',
      status: 'CREATED',
    });
    txMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      publicStatus: 'PENDING_EDD',
      cddStatus: 'APPROVED',
      eddRequired: true,
      activeCaseId: 'edd-1',
      finalApprovalStatus: 'NOT_REQUIRED',
    });
    txMock.onboardingAuditLog.create.mockResolvedValue({ id: 'audit-1' });
    txMock.onboardingDecisionRecord.findUnique.mockResolvedValue({
      outputs: '{}',
    });
    txMock.onboardingDecisionRecord.update.mockResolvedValue({ id: 'dr-1' });
  });

  it('should transition REVIEW_CDD REQUIRE_EDD to PENDING_EDD and create EDD case', async () => {
    const result = await service.execute(txMock, {
      workflow: 'ONBOARDING',
      stage: 'REVIEW_CDD',
      producerType: 'ALERT',
      producerId: 'alert-1',
      customerId: 'c1',
      journeyId: 'ONB-1',
      dispositionCode: 'REQUIRE_EDD',
      reason: 'need more checks',
      actorId: 'admin-1',
      actorRole: 'COMPLIANCE_LEAD',
      latestDecisionRecordId: 'dr-1',
      linkedCaseIds: ['cdd-1'],
    });

    expect(txMock.eddCase.create).toHaveBeenCalled();
    expect(txMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          publicStatus: 'PENDING_EDD',
          activeCaseId: 'edd-1',
          currentEddCaseId: 'edd-1',
        }),
      }),
    );
    expect(txMock.onboardingDecisionRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outputs: expect.stringContaining('"transitionCode":"CDD_REQUIRE_EDD_TO_PENDING_EDD"'),
        }),
      }),
    );
    expect(result.transitionCode).toBe(
      WORKFLOW_TRANSITION_CODES.CDD_REQUIRE_EDD_TO_PENDING_EDD,
    );
    expect(result.toStatus).toBe('PENDING_EDD');
  });

  it('should return NO_TRANSITION for report-like disposition', async () => {
    const result = await service.execute(txMock, {
      workflow: 'ONBOARDING',
      stage: 'REVIEW_CDD',
      producerType: 'CASE',
      producerId: 'case-1',
      customerId: 'c1',
      journeyId: 'ONB-1',
      dispositionCode: 'REPORT',
      actorId: 'admin-1',
      actorRole: 'MLRO',
      latestDecisionRecordId: 'dr-1',
      linkedCaseIds: ['cdd-1'],
    });

    expect(txMock.customerMain.update).not.toHaveBeenCalled();
    expect(result.transitionCode).toBe(WORKFLOW_TRANSITION_CODES.NO_TRANSITION);
    expect(result.executed).toBe(false);
  });

  it('should reject mismatched stage and customer status', async () => {
    txMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      publicStatus: 'REVIEW_EDD',
      currentEddCaseId: 'edd-1',
    });

    await expect(
      service.execute(txMock, {
        workflow: 'ONBOARDING',
        stage: 'REVIEW_CDD',
        producerType: 'ALERT',
        producerId: 'alert-1',
        customerId: 'c1',
        journeyId: 'ONB-1',
        dispositionCode: 'APPROVE_STAGE',
        actorId: 'admin-1',
        actorRole: 'COMPLIANCE_LEAD',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
