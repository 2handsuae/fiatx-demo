import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import { AuditTriggerType } from '../../risk-engine/audit-logs/dto/audit-log.dto';
import { OnboardingFinalApprovalService } from './onboarding-final-approval.service';
import {
  ApprovalActionTypes,
  ApprovalStatuses,
} from '../../governance/approvals/constants/approval.constants';

describe('OnboardingFinalApprovalService', () => {
  let prisma: any;
  let approvalsService: any;
  let service: OnboardingFinalApprovalService;
  let recordByActorSpy: jest.SpyInstance;

  beforeEach(() => {
    prisma = {
      customerMain: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      eddResponse: {
        findFirst: jest.fn(),
      },
      approvalCase: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      onboardingAuditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback(prisma)),
    };

    recordByActorSpy = jest
      .spyOn(AuditLogsService.prototype, 'recordByActor')
      .mockResolvedValue({} as any);

    approvalsService = {
      createAndSubmit: jest.fn(),
      emitSubmittedSideEffects: jest.fn(),
      getById: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
      markExecutionResult: jest.fn(),
    };

    service = new OnboardingFinalApprovalService(prisma, approvalsService);
  });

  it('should create and submit onboarding final approval for FINAL_APPROVAL customer', async () => {
    prisma.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'FINAL_APPROVAL',
      activeJourneyId: 'ONB-1',
      latestFinalApprovalId: null,
      latestFinalApprovalStatus: null,
    });
    prisma.eddResponse.findFirst.mockResolvedValue({ id: 'edd-1' });
    prisma.approvalCase.findFirst.mockResolvedValue(null);
    approvalsService.createAndSubmit.mockResolvedValue({
      id: 'approval-1',
      approvalNo: 'APR2603180001',
      status: ApprovalStatuses.PENDING,
    });
    approvalsService.getById.mockResolvedValue({
      id: 'approval-1',
      approvalNo: 'APR2603180001',
      status: ApprovalStatuses.PENDING,
    });

    const result = await service.submitFinalApproval('c1', 'admin-1', 'COMPLIANCE_OFFICER', {
      reason: 'submit',
    });

    expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: ApprovalActionTypes.ONBOARDING_FINAL_APPROVAL,
        entityRef: 'c1',
        traceId: 'ONBOARDING:ONB-1',
        workflowType: 'ONBOARDING',
        workflowId: 'ONB-1',
        workflowNo: 'ONB-1',
        metadata: expect.objectContaining({
          customerNo: 'CU0001',
          journeyId: 'ONB-1',
          currentEddResponseId: 'edd-1',
        }),
      }),
      expect.objectContaining({
        reason: 'submit',
      }),
      expect.objectContaining({
        userId: 'admin-1',
        role: 'COMPLIANCE_OFFICER',
      }),
      prisma,
      { emitSideEffects: false },
    );
    expect(prisma.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          latestFinalApproval: { connect: { id: 'approval-1' } },
          latestFinalApprovalStatus: ApprovalStatuses.PENDING,
        }),
      }),
    );
    expect(approvalsService.emitSubmittedSideEffects).toHaveBeenCalledWith(
      'approval-1',
      expect.objectContaining({
        userId: 'admin-1',
        role: 'COMPLIANCE_OFFICER',
      }),
      'submit',
    );
    expect(recordByActorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FINAL_APPROVAL_SUBMITTED',
        triggerType: AuditTriggerType.DATA_UPDATE,
      }),
      expect.anything(),
    );
    expect(result.approvalNo).toBe('APR2603180001');
  });

  it('should reject final approval submission when customer is not in FINAL_APPROVAL', async () => {
    prisma.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'EDD_UNDER_REVIEW',
    });

    await expect(service.submitFinalApproval('c1', 'admin-1', 'COMPLIANCE_OFFICER')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('should proxy compatibility final review to linked pending approval', async () => {
    prisma.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'FINAL_APPROVAL',
      latestFinalApprovalId: 'approval-1',
      latestFinalApprovalStatus: ApprovalStatuses.PENDING,
    });
    prisma.approvalCase.findUnique.mockResolvedValue({
      id: 'approval-1',
      approvalNo: 'APR2603180001',
      actionType: ApprovalActionTypes.ONBOARDING_FINAL_APPROVAL,
      entityRef: 'c1',
      status: ApprovalStatuses.PENDING,
    });
    approvalsService.approve.mockResolvedValue({
      id: 'approval-1',
      status: ApprovalStatuses.APPROVED,
    });

    await service.proxyFinalDecision('c1', 'admin-1', 'MLRO', {
      decision: 'APPROVE',
      reason: 'clear',
    });

    expect(approvalsService.approve).toHaveBeenCalledWith(
      'approval-1',
      { reason: 'clear' },
      expect.objectContaining({
        userId: 'admin-1',
        role: 'MLRO',
      }),
    );
  });

  it('should keep customer in FINAL_APPROVAL when approval is cancelled', async () => {
    prisma.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'FINAL_APPROVAL',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      eddRequired: true,
      latestFinalApprovalId: 'approval-1',
      latestFinalApprovalStatus: ApprovalStatuses.PENDING,
    });
    prisma.customerMain.update.mockResolvedValue({
      id: 'c1',
      latestFinalApprovalId: 'approval-1',
      latestFinalApprovalStatus: ApprovalStatuses.CANCELLED,
      onboardingStatus: 'FINAL_APPROVAL',
    });

    await service.onApprovalCancelled({
      approvalId: 'approval-1',
      approvalNo: 'APR2603180001',
      actionType: ApprovalActionTypes.ONBOARDING_FINAL_APPROVAL,
      entityRef: 'c1',
      traceId: 'trace-1',
      status: ApprovalStatuses.CANCELLED,
      decisionByUserId: 'admin-1',
      decisionByRole: 'COMPLIANCE_OFFICER',
      decidedAt: null,
    });

    expect(prisma.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          latestFinalApprovalStatus: ApprovalStatuses.CANCELLED,
        }),
      }),
    );
    expect(approvalsService.markExecutionResult).not.toHaveBeenCalled();
  });

  it('should project approved final approval to approved and active customer', async () => {
    prisma.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'FINAL_APPROVAL',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      eddRequired: true,
      latestFinalApprovalId: 'approval-1',
      latestFinalApprovalStatus: ApprovalStatuses.PENDING,
    });
    prisma.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'APPROVED',
      operatingStatus: 'ACTIVE',
      latestFinalApprovalStatus: ApprovalStatuses.APPROVED,
    });

    await service.onApprovalApproved({
      approvalId: 'approval-1',
      approvalNo: 'APR2603180001',
      actionType: ApprovalActionTypes.ONBOARDING_FINAL_APPROVAL,
      entityRef: 'c1',
      traceId: 'trace-1',
      status: ApprovalStatuses.APPROVED,
      decisionByUserId: 'mlro-1',
      decisionByRole: 'MLRO',
      decisionReason: 'approved',
      decidedAt: '2026-03-18T12:00:00.000Z',
    });

    expect(prisma.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          onboardingStatus: 'APPROVED',
          operatingStatus: 'ACTIVE',
          latestFinalApprovalStatus: ApprovalStatuses.APPROVED,
          restrictionStatus: 'CLEAR',
        }),
      }),
    );
    expect(approvalsService.markExecutionResult).toHaveBeenCalledWith(
      'approval-1',
      true,
      expect.objectContaining({
        userId: 'mlro-1',
        role: 'MLRO',
      }),
      'Customer final approval projected as APPROVED',
    );
  });

  it('should block resubmission when linked approval is already approved', async () => {
    prisma.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'FINAL_APPROVAL',
      latestFinalApprovalId: 'approval-1',
      latestFinalApprovalStatus: ApprovalStatuses.APPROVED,
    });
    prisma.approvalCase.findUnique.mockResolvedValue({
      id: 'approval-1',
      approvalNo: 'APR2603180001',
      actionType: ApprovalActionTypes.ONBOARDING_FINAL_APPROVAL,
      entityRef: 'c1',
      status: ApprovalStatuses.APPROVED,
    });

    await expect(
      service.submitFinalApproval('c1', 'admin-1', 'COMPLIANCE_OFFICER'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
