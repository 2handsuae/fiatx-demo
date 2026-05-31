import { BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DepositWorkflowService } from '../../trading/deposit-transactions/deposit-workflow.service';
import { DepositTransactionsService } from '../../trading/deposit-transactions/deposit-transactions.service';
import { WithdrawTransactionWorkflowService } from '../../trading/withdraw-transactions/withdraw-transaction-workflow.service';
import { WorkflowTransitionService } from './workflow-transition.service';

describe('WorkflowTransitionService', () => {
  const onboardingWorkflowTransitionServiceMock = {
    execute: jest.fn(),
  };
  const periodicReviewWorkflowTransitionServiceMock = {
    execute: jest.fn(),
  };
  const depositWorkflowServiceMock = {
    approveDeposit: jest.fn(),
  };
  const depositTransactionsServiceMock = {
    findOne: jest.fn(),
    updateStatus: jest.fn(),
  };
  const withdrawTransactionWorkflowServiceMock = {
    execute: jest.fn(),
  };
  const moduleRefMock = {
    get: jest.fn(),
  };

  let service: WorkflowTransitionService;

  beforeEach(() => {
    jest.clearAllMocks();
    moduleRefMock.get.mockImplementation((token: unknown) => {
      if (token === DepositWorkflowService) {
        return depositWorkflowServiceMock;
      }
      if (token === DepositTransactionsService) {
        return depositTransactionsServiceMock;
      }
      if (token === WithdrawTransactionWorkflowService) {
        return withdrawTransactionWorkflowServiceMock;
      }
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
      actorRole: 'COMPLIANCE_OFFICER',
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
      actorRole: 'COMPLIANCE_OFFICER',
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
        actorRole: 'COMPLIANCE_OFFICER',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should dispatch TRANSACTION workflow to transaction deposit handler', async () => {
    depositTransactionsServiceMock.findOne.mockResolvedValue({
      id: 'dep-1',
      depositNo: 'DEP0001',
      status: 'ACTION_PENDING',
    });
    depositWorkflowServiceMock.approveDeposit.mockResolvedValue(undefined);

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

    expect(depositWorkflowServiceMock.approveDeposit).toHaveBeenCalledWith('dep-1');
    expect(result.toStatus).toBe('SUCCESS');
    expect(result.updatedSubject).toEqual(
      expect.objectContaining({
        id: 'dep-1',
        sourceType: 'DEPOSIT',
        subjectNo: 'DEP0001',
      }),
    );
  });

  it('should dispatch TRANSACTION workflow to withdraw handler for false positive resolution', async () => {
    withdrawTransactionWorkflowServiceMock.execute.mockResolvedValue({
      transitionCode: 'TX_WITHDRAW_CLEAR_TO_PAYOUT_PENDING',
      applied: true,
      blocked: false,
      blockedReason: null,
      withdrawId: 'wd-1',
      withdrawNo: 'WD0001',
      withdrawStatusBefore: 'UNDER_REVIEW',
      withdrawStatusAfter: 'PAYOUT_PENDING',
    });

    const tx = { withdrawTransaction: {} } as any;
    const result = await service.transition(tx, {
      workflow: 'TRANSACTION',
      stage: 'REVIEW_WITHDRAW_FINAL',
      producerType: 'CASE',
      producerId: 'case-1',
      customerId: 'c1',
      sourceId: 'wd-1',
      sourceType: 'WITHDRAW',
      dispositionCode: 'FALSE_POSITIVE',
      actorId: 'mlro-1',
      actorRole: 'MLRO',
      latestDecisionRecordId: 'decision-wd-1',
    } as any);

    expect(withdrawTransactionWorkflowServiceMock.execute).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        withdrawId: 'wd-1',
        source: 'CASE',
        sourceId: 'case-1',
        workflowAction: 'CLEAR',
        decisionRecordId: 'decision-wd-1',
        triggerStage: 'REVIEW_WITHDRAW_FINAL',
      }),
    );
    expect(result.transitionCode).toBe('TX_WITHDRAW_CLEAR_TO_PAYOUT_PENDING');
    expect(result.toStatus).toBe('PAYOUT_PENDING');
    expect(result.updatedSubject).toEqual(
      expect.objectContaining({
        id: 'wd-1',
        sourceType: 'WITHDRAW',
        subjectNo: 'WD0001',
      }),
    );
  });

  it('should dispatch TRANSACTION workflow to withdraw handler for freeze resolution', async () => {
    withdrawTransactionWorkflowServiceMock.execute.mockResolvedValue({
      transitionCode: 'TX_WITHDRAW_FREEZE_TO_UNDER_REVIEW',
      applied: true,
      blocked: true,
      blockedReason: 'TX_REVIEW_REQUIRED',
      withdrawId: 'wd-2',
      withdrawNo: 'WD0002',
      withdrawStatusBefore: 'PAYOUT_PENDING',
      withdrawStatusAfter: 'UNDER_REVIEW',
    });

    const tx = { withdrawTransaction: {} } as any;
    const result = await service.transition(tx, {
      workflow: 'TRANSACTION',
      stage: 'REVIEW_WITHDRAW_FINAL',
      producerType: 'ALERT',
      producerId: 'alert-1',
      customerId: 'c1',
      sourceId: 'wd-2',
      sourceType: 'WITHDRAW',
      dispositionCode: 'FREEZE_TRANSACTION',
      actorId: 'admin-1',
      actorRole: 'COMPLIANCE_OFFICER',
      latestDecisionRecordId: 'decision-wd-2',
    } as any);

    expect(withdrawTransactionWorkflowServiceMock.execute).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        withdrawId: 'wd-2',
        source: 'ALERT',
        sourceId: 'alert-1',
        workflowAction: 'FREEZE',
        alertId: 'alert-1',
        decisionRecordId: 'decision-wd-2',
      }),
    );
    expect(result.transitionCode).toBe('TX_WITHDRAW_FREEZE_TO_UNDER_REVIEW');
    expect(result.toStatus).toBe('UNDER_REVIEW');
  });
});
