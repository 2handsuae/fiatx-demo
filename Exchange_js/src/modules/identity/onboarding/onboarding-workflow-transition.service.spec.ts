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
  const onboardingFinalApprovalServiceMock = {
    ensurePendingApprovalInTransaction: jest.fn(),
  };

  let service: OnboardingWorkflowTransitionService;
  let mockAuditLogsService: { recordByActor: jest.Mock; recordSystem: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuditLogsService = {
      recordByActor: jest.fn().mockResolvedValue({}),
      recordSystem: jest.fn().mockResolvedValue({}),
    };
    service = new OnboardingWorkflowTransitionService(
      txMock as any,
      onboardingFinalApprovalServiceMock as any,
      mockAuditLogsService as any,
    );
    txMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'CDD_UNDER_REVIEW',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      activeJourneyId: 'ONB-1',
      latestRiskApprovalStatus: null,
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
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      eddRequired: true,
      latestRiskApprovalStatus: null,
    });
    txMock.onboardingAuditLog.create.mockResolvedValue({ id: 'audit-1' });
    txMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      outputs: '{}',
    });
    txMock.workflowDecisionRecord.update.mockResolvedValue({ id: 'dr-1' });
    onboardingFinalApprovalServiceMock.ensurePendingApprovalInTransaction.mockResolvedValue({
      approval: {
        id: 'approval-1',
        status: 'PENDING',
      },
      created: true,
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
      actorRole: 'COMPLIANCE_OFFICER',
      latestDecisionRecordId: 'dr-1',
      linkedCaseIds: ['cdd-1'],
    });

    expect(txMock.eddResponse.create).toHaveBeenCalled();
    expect(txMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          onboardingStatus: 'PENDING_EDD_INPUT',
          adminStatus: 'INACTIVE',
          complianceStatus: 'CLEAR',
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

  it('should transition REVIEW_EDD clear to FINAL_APPROVAL and auto-create approval', async () => {
    txMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'EDD_UNDER_REVIEW',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      eddRequired: true,
      activeJourneyId: 'ONB-1',
      latestDecisionRecordId: 'dr-1',
      latestRiskApprovalId: null,
      latestRiskApprovalStatus: null,
    });
    txMock.eddResponse.findFirst.mockResolvedValue({
      id: 'edd-1',
      customerId: 'c1',
    });
    txMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'FINAL_APPROVAL',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      latestRiskApprovalId: 'approval-1',
      latestRiskApprovalStatus: 'PENDING',
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

    expect(
      onboardingFinalApprovalServiceMock.ensurePendingApprovalInTransaction,
    ).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        customer: expect.objectContaining({
          id: 'c1',
          customerNo: 'CU0001',
          onboardingStatus: 'FINAL_APPROVAL',
          activeJourneyId: 'ONB-1',
        }),
        actorId: 'admin-1',
        actorRole: 'MLRO',
      }),
    );
    expect(txMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          onboardingStatus: 'FINAL_APPROVAL',
          latestRiskApproval: { connect: { id: 'approval-1' } },
          latestRiskApprovalStatus: 'PENDING',
        }),
      }),
    );
    expect(result).not.toHaveProperty('finalApprovalStatus');
    expect(result.createdFinalApprovalId).toBe('approval-1');
    expect(result.latestRiskApprovalId).toBe('approval-1');
    expect(result.latestRiskApprovalStatus).toBe('PENDING');
    expect(result.toStatus).toBe('FINAL_APPROVAL');
  });

  it('should reject mismatched stage and customer status', async () => {
    txMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'EDD_UNDER_REVIEW',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      latestRiskApprovalStatus: null,
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
        actorRole: 'COMPLIANCE_OFFICER',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
