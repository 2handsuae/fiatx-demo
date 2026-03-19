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

  const onboardingFinalApprovalServiceMock: any = {
    ensurePendingApprovalInTransaction: jest.fn(),
  };

  let service: OnboardingWorkflowTransitionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OnboardingWorkflowTransitionService(onboardingFinalApprovalServiceMock);
    txMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
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
    onboardingFinalApprovalServiceMock.ensurePendingApprovalInTransaction.mockResolvedValue({
      approval: {
        id: 'approval-1',
        approvalNo: 'APR2603180001',
        status: 'PENDING',
      },
      created: true,
      auditAction: 'FINAL_APPROVAL_SUBMITTED',
    });
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

  it('should create pending final approval when REVIEW_EDD is approved', async () => {
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
      latestFinalApprovalId: 'approval-1',
      latestFinalApprovalStatus: 'PENDING',
    });

    const result = await service.execute(txMock, {
      workflow: 'ONBOARDING',
      stage: 'REVIEW_EDD',
      producerType: 'CASE',
      producerId: 'case-1',
      customerId: 'c1',
      journeyId: 'ONB-1',
      dispositionCode: 'APPROVE_STAGE',
      actorId: 'admin-1',
      actorRole: 'MLRO',
      latestDecisionRecordId: 'dr-1',
      linkedCaseIds: ['edd-1'],
    });

    expect(onboardingFinalApprovalServiceMock.ensurePendingApprovalInTransaction).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        customer: expect.objectContaining({
          id: 'c1',
          onboardingStatus: 'EDD_UNDER_REVIEW',
        }),
        actorId: 'admin-1',
        actorRole: 'MLRO',
      }),
    );
    expect(txMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          onboardingStatus: 'FINAL_APPROVAL',
          latestFinalApproval: { connect: { id: 'approval-1' } },
          latestFinalApprovalStatus: 'PENDING',
        }),
      }),
    );
    expect(result.createdFinalApprovalId).toBe('approval-1');
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
        dispositionCode: 'APPROVE_STAGE',
        actorId: 'admin-1',
        actorRole: 'COMPLIANCE_LEAD',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
