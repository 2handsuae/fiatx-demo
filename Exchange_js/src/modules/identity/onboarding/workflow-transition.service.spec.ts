import { BadRequestException } from '@nestjs/common';
import { WorkflowTransitionService } from './workflow-transition.service';

describe('WorkflowTransitionService', () => {
  const onboardingWorkflowTransitionServiceMock = {
    execute: jest.fn(),
  };
  const periodicReviewWorkflowTransitionServiceMock = {
    execute: jest.fn(),
  };

  let service: WorkflowTransitionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorkflowTransitionService(
      onboardingWorkflowTransitionServiceMock as any,
      periodicReviewWorkflowTransitionServiceMock as any,
    );
  });

  it('should dispatch ONBOARDING workflow to onboarding handler', async () => {
    onboardingWorkflowTransitionServiceMock.execute.mockResolvedValue({
      workflow: 'ONBOARDING',
      stage: 'REVIEW_CDD',
      transitionCode: 'CDD_APPROVE_TO_ACTIVE',
      executed: true,
    });

    const tx = { customerMain: {} } as any;
    const result = await service.transition(tx, {
      workflow: 'ONBOARDING',
      stage: 'REVIEW_CDD',
      producerType: 'ALERT',
      producerId: 'alert-1',
      customerId: 'c1',
      journeyId: 'ONB-1',
      dispositionCode: 'CLEAR',
      actorId: 'admin-1',
      actorRole: 'COMPLIANCE_LEAD',
    } as any);

    expect(onboardingWorkflowTransitionServiceMock.execute).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        workflow: 'ONBOARDING',
        stage: 'REVIEW_CDD',
      }),
    );
    expect(result.transitionCode).toBe('CDD_APPROVE_TO_ACTIVE');
  });

  it('should dispatch PERIODIC_REVIEW workflow to periodic review handler', async () => {
    periodicReviewWorkflowTransitionServiceMock.execute.mockResolvedValue({
      workflow: 'PERIODIC_REVIEW',
      stage: 'REVIEW_CDD',
      transitionCode: 'PERIODIC_REVIEW_CDD_APPROVE_TO_CLEARED',
      executed: true,
    });

    const tx = { customerMain: {} } as any;
    const result = await service.transition(tx, {
      workflow: 'PERIODIC_REVIEW',
      stage: 'REVIEW_CDD',
      producerType: 'ALERT',
      producerId: 'alert-1',
      customerId: 'c1',
      sourceId: 'prr-1',
      dispositionCode: 'CLEAR',
      actorId: 'admin-1',
      actorRole: 'COMPLIANCE_LEAD',
    } as any);

    expect(periodicReviewWorkflowTransitionServiceMock.execute).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        workflow: 'PERIODIC_REVIEW',
        stage: 'REVIEW_CDD',
      }),
    );
    expect(result.transitionCode).toBe('PERIODIC_REVIEW_CDD_APPROVE_TO_CLEARED');
  });

  it('should reject unsupported workflow', async () => {
    await expect(
      service.transition({} as any, {
        workflow: 'DEPOSIT',
        stage: 'REVIEW_CDD',
        producerType: 'ALERT',
        producerId: 'alert-1',
        customerId: 'c1',
        journeyId: 'ONB-1',
        dispositionCode: 'CLEAR',
        actorId: 'admin-1',
        actorRole: 'COMPLIANCE_LEAD',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
