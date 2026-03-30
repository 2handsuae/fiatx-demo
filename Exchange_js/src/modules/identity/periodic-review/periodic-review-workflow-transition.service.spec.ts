import { PeriodicReviewWorkflowTransitionService } from './periodic-review-workflow-transition.service';

describe('PeriodicReviewWorkflowTransitionService', () => {
  const txMock: any = {
    customerMain: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    periodicReviewCycle: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    workflowDecisionRecord: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  let service: PeriodicReviewWorkflowTransitionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PeriodicReviewWorkflowTransitionService(txMock as any);
    txMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'APPROVED',
      operatingStatus: 'ACTIVE',
      restrictionStatus: 'RESTRICTED',
      restrictionCaseId: 'case-1',
      activePeriodicReviewCycleId: 'cycle-1',
      latestDecisionRecordId: 'dr-1',
      latestFinalApprovalId: 'approval-1',
      latestFinalApprovalStatus: 'APPROVED',
    });
    txMock.periodicReviewCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      customerId: 'c1',
      status: 'CDD_UNDER_REVIEW',
      currentCddResponseId: 'cdd-1',
      currentEddResponseId: null,
      primaryIncidentId: 'case-1',
      latestDecisionRecordId: 'dr-1',
    });
    txMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      outputs: '{}',
    });
    txMock.workflowDecisionRecord.update.mockResolvedValue({ id: 'dr-1' });
  });

  it('should omit compatibility finalApprovalStatus from no-transition output', async () => {
    const result = await service.execute(txMock, {
      workflow: 'PERIODIC_REVIEW',
      stage: 'REVIEW_CDD',
      producerType: 'CASE',
      producerId: 'case-1',
      customerId: 'c1',
      sourceId: 'cycle-1',
      dispositionCode: 'REPORT',
      actorId: 'admin-1',
      actorRole: 'MLRO',
      latestDecisionRecordId: 'dr-1',
    } as any);

    expect(result.executed).toBe(false);
    expect(result.latestFinalApprovalStatus).toBe('APPROVED');
    expect(result).not.toHaveProperty('finalApprovalStatus');
    expect(txMock.workflowDecisionRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outputs: expect.stringContaining('"transitionCode":"NO_TRANSITION"'),
        }),
      }),
    );
  });
});
