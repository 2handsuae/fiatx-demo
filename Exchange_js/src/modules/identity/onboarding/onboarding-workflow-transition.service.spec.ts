import { BadRequestException } from '@nestjs/common';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
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
    cddResponse: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    eddResponse: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    onboardingAuditLog: {
      create: jest.fn(),
    },
    workflowDecisionRecord: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  let service: OnboardingWorkflowTransitionService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AuditLogsService.prototype, 'recordByActor').mockResolvedValue({} as any);
    service = new OnboardingWorkflowTransitionService(txMock as any);
    txMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'CDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      activeJourneyId: 'ONB-1',
      latestFinalApprovalStatus: null,
      latestDecisionRecordId: 'dr-1',
    });
    txMock.cddResponse.findUnique.mockResolvedValue({
      id: 'cdd-1',
      customerId: 'c1',
    });
    txMock.cddResponse.findFirst.mockResolvedValue({
      id: 'cdd-1',
      customerId: 'c1',
    });
    txMock.cddResponse.update.mockResolvedValue({ id: 'cdd-1' });
    txMock.eddResponse.findFirst.mockResolvedValue(null);
    txMock.eddResponse.create.mockResolvedValue({
      id: 'edd-1',
      customerId: 'c1',
      cddResponseId: 'cdd-1',
      journeyId: 'ONB-1',
      status: 'CREATED',
    });
    txMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'PENDING_EDD_INPUT',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      eddRequired: true,
      latestFinalApprovalStatus: null,
    });
    txMock.onboardingAuditLog.create.mockResolvedValue({ id: 'audit-1' });
    txMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      outputs: '{}',
    });
    txMock.workflowDecisionRecord.update.mockResolvedValue({ id: 'dr-1' });
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

    expect(txMock.eddResponse.create).toHaveBeenCalled();
    expect(txMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          onboardingStatus: 'PENDING_EDD_INPUT',
          operatingStatus: 'INACTIVE',
          restrictionStatus: 'CLEAR',
          eddRequired: true,
        }),
      }),
    );
    expect(txMock.workflowDecisionRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outputs: expect.stringContaining('"transitionCode":"CDD_REQUIRE_EDD_TO_PENDING_EDD"'),
        }),
      }),
    );
    expect(result).not.toHaveProperty('finalApprovalStatus');
    expect(result.transitionCode).toBe(
      WORKFLOW_TRANSITION_CODES.CDD_REQUIRE_EDD_TO_PENDING_EDD,
    );
    expect(result.toStatus).toBe('PENDING_EDD_INPUT');
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

  it('should transition REVIEW_EDD clear to FINAL_APPROVAL without creating approval', async () => {
    txMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'EDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      activeJourneyId: 'ONB-1',
      latestDecisionRecordId: 'dr-1',
      latestFinalApprovalStatus: null,
    });
    txMock.eddResponse.findFirst.mockResolvedValue({
      id: 'edd-1',
      customerId: 'c1',
    });
    txMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'FINAL_APPROVAL',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      latestFinalApprovalId: null,
      latestFinalApprovalStatus: null,
    });

    const result = await service.execute(txMock, {
      workflow: 'ONBOARDING',
      stage: 'REVIEW_EDD',
      producerType: 'CASE',
      producerId: 'case-1',
      customerId: 'c1',
      journeyId: 'ONB-1',
      dispositionCode: 'CLEAR',
      actorId: 'admin-1',
      actorRole: 'MLRO',
      latestDecisionRecordId: 'dr-1',
      linkedCaseIds: ['edd-1'],
    });

    expect(txMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          onboardingStatus: 'FINAL_APPROVAL',
          latestFinalApproval: { disconnect: true },
          latestFinalApprovalStatus: null,
        }),
      }),
    );
    expect(result).not.toHaveProperty('finalApprovalStatus');
    expect(result.createdFinalApprovalId).toBeNull();
    expect(result.toStatus).toBe('FINAL_APPROVAL');
  });

  it('should reject mismatched stage and customer status', async () => {
    txMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'EDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      latestFinalApprovalStatus: null,
    });

    await expect(
      service.execute(txMock, {
        workflow: 'ONBOARDING',
        stage: 'REVIEW_CDD',
        producerType: 'ALERT',
        producerId: 'alert-1',
        customerId: 'c1',
        journeyId: 'ONB-1',
        dispositionCode: 'CLEAR',
        actorId: 'admin-1',
        actorRole: 'COMPLIANCE_LEAD',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
