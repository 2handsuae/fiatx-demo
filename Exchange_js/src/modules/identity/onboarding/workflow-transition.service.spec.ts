import { BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { WorkflowTransitionService } from './workflow-transition.service';

describe('WorkflowTransitionService', () => {
  const onboardingWorkflowTransitionServiceMock = {
    execute: jest.fn(),
  };
  const periodicReviewWorkflowTransitionServiceMock = {
    execute: jest.fn(),
  };
  const transactionDepositWorkflowServiceMock = {
    execute: jest.fn(),
  };
  const moduleRefMock = {
    get: jest.fn(),
  };

  let service: WorkflowTransitionService;

  beforeEach(() => {
    jest.clearAllMocks();
    moduleRefMock.get.mockImplementation((token: unknown) => {
      if (token) return transactionDepositWorkflowServiceMock;
      return null;
    });
    service = new WorkflowTransitionService(
      onboardingWorkflowTransitionServiceMock as any,
      periodicReviewWorkflowTransitionServiceMock as any,
      moduleRefMock as unknown as ModuleRef,
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

  it('should dispatch TRANSACTION workflow to transaction deposit handler', async () => {
    transactionDepositWorkflowServiceMock.execute.mockResolvedValue({
      transitionCode: 'TX_DEPOSIT_CLEAR_TO_SUCCESS',
      applied: true,
      blocked: false,
      blockedReason: null,
      depositId: 'dep-1',
      depositNo: 'DEP0001',
      depositStatusBefore: 'UNDER_REVIEW',
      depositStatusAfter: 'SUCCESS',
    });

    const tx = { depositTransaction: {} } as any;
    const result = await service.transition(tx, {
      workflow: 'TRANSACTION',
      stage: 'REVIEW_KYT',
      producerType: 'CASE',
      producerId: 'case-1',
      customerId: 'c1',
      sourceId: 'dep-1',
      dispositionCode: 'FALSE_POSITIVE',
      actorId: 'mlro-1',
      actorRole: 'MLRO',
    } as any);

    expect(transactionDepositWorkflowServiceMock.execute).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        depositId: 'dep-1',
        source: 'CASE',
        sourceId: 'case-1',
        workflowAction: 'CLEAR',
      }),
    );
    expect(result.transitionCode).toBe('TX_DEPOSIT_CLEAR_TO_SUCCESS');
    expect(result.toStatus).toBe('SUCCESS');
  });
});
