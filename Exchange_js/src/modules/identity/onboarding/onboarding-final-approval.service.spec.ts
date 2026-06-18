import { BadRequestException, ConflictException } from '@nestjs/common';
import { OnboardingFinalApprovalService } from './onboarding-final-approval.service';
import {
  ApprovalActionTypes,
  ApprovalStatuses,
} from '../../governance/approvals/constants/approval.constants';

describe('OnboardingFinalApprovalService', () => {
  let prisma: any;
  let approvalsService: any;
  let auditLogsService: any;
  let service: OnboardingFinalApprovalService;

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

    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue({}),
    };

    approvalsService = {
      createAndSubmit: jest.fn(),
      emitSubmittedSideEffects: jest.fn(),
      getById: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
    };

    service = new OnboardingFinalApprovalService(prisma, approvalsService, auditLogsService as any);
  });

  it('should create and submit onboarding final approval for FINAL_APPROVAL customer', async () => {
    prisma.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'FINAL_APPROVAL',
      latestRiskApprovalId: null,
      latestRiskApprovalStatus: null,
    });
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
        traceId: 'ONBOARDING:c1',
        objectSnapshot: expect.objectContaining({
          customerNo: 'CU0001',
          journeyId: 'c1',
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
          latestRiskApproval: { connect: { id: 'approval-1' } },
          latestRiskApprovalStatus: ApprovalStatuses.PENDING,
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
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FINAL_APPROVAL_SUBMITTED',
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
      latestRiskApprovalId: 'approval-1',
      latestRiskApprovalStatus: ApprovalStatuses.PENDING,
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
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      eddRequired: true,
      latestRiskApprovalId: 'approval-1',
      latestRiskApprovalStatus: ApprovalStatuses.PENDING,
    });
    prisma.customerMain.update.mockResolvedValue({
      id: 'c1',
      latestRiskApprovalId: 'approval-1',
      latestRiskApprovalStatus: ApprovalStatuses.CANCELLED,
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
          latestRiskApprovalStatus: ApprovalStatuses.CANCELLED,
        }),
      }),
    );
  });

  it('should project approved final approval to approved and active customer', async () => {
    prisma.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'FINAL_APPROVAL',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      eddRequired: true,
      latestRiskApprovalId: 'approval-1',
      latestRiskApprovalStatus: ApprovalStatuses.PENDING,
    });
    prisma.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'APPROVED',
      adminStatus: 'ACTIVE',
      latestRiskApprovalStatus: ApprovalStatuses.APPROVED,
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
          adminStatus: 'ACTIVE',
          latestRiskApprovalStatus: ApprovalStatuses.APPROVED,
          complianceStatus: 'CLEAR',
        }),
      }),
    );
  });

  it('should block resubmission when linked approval is already approved', async () => {
    prisma.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'FINAL_APPROVAL',
      latestRiskApprovalId: 'approval-1',
      latestRiskApprovalStatus: ApprovalStatuses.APPROVED,
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
