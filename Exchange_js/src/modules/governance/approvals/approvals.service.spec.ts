import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import {
  ApprovalActionTypes,
  ApprovalEvents,
  ApprovalExecutionStatuses,
  ApprovalStatuses,
} from './constants/approval.constants';

const baseDate = new Date('2026-03-14T10:00:00.000Z');

const buildApproval = (overrides: Record<string, unknown> = {}) => ({
  id: 'approval-1',
  approvalNo: 'APR2603140001',
  actionType: ApprovalActionTypes.SENSITIVE_EXPORT_APPROVAL,
  entityRef: 'pkg-1',
  makerUserId: 'maker-1',
  status: ApprovalStatuses.DRAFT,
  executionStatus: ApprovalExecutionStatuses.NOT_EXECUTED,
  riskLevel: 'HIGH',
  checkerRoles: 'DPO,MLRO',
  selectedCheckerRole: 'DPO',
  allowCancel: true,
  allowRetry: true,
  docRef: null,
  metadataJson: '{}',
  traceId: 'trace-1',
  workflowType: null,
  workflowId: null,
  workflowNo: null,
  createdAt: baseDate,
  updatedAt: baseDate,
  submittedAt: null,
  timeoutAt: null,
  decidedAt: null,
  executedAt: null,
  decisionByUserId: null,
  decisionByRole: null,
  decisionReason: null,
  steps: [
    {
      id: 'step-1',
      approvalCaseId: 'approval-1',
      stepNo: 1,
      status: 'PENDING',
      checkerRoleCandidates: 'DPO,MLRO',
      decidedByUserId: null,
      decidedByRole: null,
      reason: null,
      decidedAt: null,
      createdAt: baseDate,
      updatedAt: baseDate,
    },
  ],
  evidencePackage: null,
  ...overrides,
});

describe('ApprovalsService', () => {
  let prisma: any;
  let auditLogsService: { recordByActor: jest.Mock };
  let approvalPolicyService: {
    getPolicy: jest.Mock;
    isSameUserMakerCheckerDenied: jest.Mock;
  };
  let eventEmitter: { emitAsync: jest.Mock; emit: jest.Mock };
  let service: ApprovalsService;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'checker-1',
    userNo: 'USR-1',
    role: 'DPO',
    roleCodes: ['DPO'],
  };

  beforeEach(() => {
    prisma = {
      approvalCase: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      approvalStep: {
        update: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: any) => unknown) => cb(prisma)),
    };

    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };

    approvalPolicyService = {
      getPolicy: jest.fn().mockResolvedValue({
        actionType: ApprovalActionTypes.SENSITIVE_EXPORT_APPROVAL,
        riskLevel: 'HIGH',
        checkerRoles: ['DPO', 'MLRO'],
        timeoutHours: 24,
        allowCancel: true,
        allowRetry: true,
      }),
      isSameUserMakerCheckerDenied: jest.fn().mockResolvedValue(true),
    };

    eventEmitter = {
      emitAsync: jest.fn().mockResolvedValue([]),
      emit: jest.fn(),
    };

    service = new ApprovalsService(
      prisma,
      auditLogsService as any,
      approvalPolicyService as any,
      eventEmitter as any,
    );
  });

  it('returns existing pending approval for the same action and entity', async () => {
    prisma.approvalCase.findFirst.mockResolvedValue(
      buildApproval({ status: ApprovalStatuses.PENDING }),
    );

    const result = await service.create(
      {
        actionType: ApprovalActionTypes.SENSITIVE_EXPORT_APPROVAL,
        entityRef: 'pkg-1',
      },
      actor,
    );

    expect(result.status).toBe(ApprovalStatuses.PENDING);
    expect(prisma.approvalCase.create).not.toHaveBeenCalled();
  });

  it('creates approval with generated approvalNo', async () => {
    prisma.approvalCase.findFirst.mockResolvedValue(null);
    prisma.approvalCase.create.mockResolvedValue(buildApproval());

    const result = await service.create(
      {
        actionType: ApprovalActionTypes.SENSITIVE_EXPORT_APPROVAL,
        entityRef: 'pkg-1',
      },
      actor,
    );

    expect(result.approvalNo).toBe('APR2603140001');
    expect(prisma.approvalCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          approvalNo: expect.stringMatching(/^APR\d{10}$/),
        }),
      }),
    );
  });

  it('creates workflow-bound approval with workflow tuple', async () => {
    prisma.approvalCase.findFirst.mockResolvedValue(null);
    prisma.approvalCase.create.mockResolvedValue(
      buildApproval({
        traceId: 'ONBOARDING:ONB-1',
        workflowType: 'ONBOARDING',
        workflowId: 'ONB-1',
        workflowNo: 'ONB-1',
      }),
    );

    await service.create(
      {
        actionType: ApprovalActionTypes.ONBOARDING_FINAL_APPROVAL,
        entityRef: 'customer-1',
        traceId: 'ONBOARDING:ONB-1',
        workflowType: 'ONBOARDING',
        workflowId: 'ONB-1',
        workflowNo: 'ONB-1',
      },
      actor,
    );

    expect(prisma.approvalCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          traceId: 'ONBOARDING:ONB-1',
          workflowType: 'ONBOARDING',
          workflowId: 'ONB-1',
          workflowNo: 'ONB-1',
        }),
      }),
    );
  });

  it('allows submit only from DRAFT', async () => {
    prisma.approvalCase.findUnique.mockResolvedValue(
      buildApproval({ status: ApprovalStatuses.APPROVED }),
    );

    await expect(
      service.submit(
        'approval-1',
        {
          reason: 'submit',
        },
        {
          ...actor,
          userId: 'maker-1',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks maker and checker from being the same user', async () => {
    prisma.approvalCase.findUnique.mockResolvedValue(
      buildApproval({
        status: ApprovalStatuses.PENDING,
        makerUserId: actor.userId,
        checkerRoles: 'DPO',
      }),
    );

    await expect(
      service.approve(
        'approval-1',
        {
          reason: 'approve',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('resolves checker role from current actor roles and approves successfully', async () => {
    prisma.approvalCase.findUnique.mockResolvedValue(
      buildApproval({
        status: ApprovalStatuses.PENDING,
        makerUserId: 'maker-1',
        checkerRoles: 'DPO',
        workflowType: 'ONBOARDING',
        workflowId: 'ONB-1',
        workflowNo: 'ONB-1',
      }),
    );
    prisma.approvalCase.update.mockResolvedValue(
      buildApproval({
        status: ApprovalStatuses.APPROVED,
        makerUserId: 'maker-1',
        checkerRoles: 'DPO',
        decisionByUserId: actor.userId,
        decisionByRole: 'DPO',
        workflowType: 'ONBOARDING',
        workflowId: 'ONB-1',
        workflowNo: 'ONB-1',
      }),
    );

    const result = await service.approve(
      'approval-1',
      {
        reason: 'looks good',
      },
      actor,
    );

    expect(result.status).toBe(ApprovalStatuses.APPROVED);
    expect(prisma.approvalStep.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decidedByRole: 'DPO',
        }),
      }),
    );
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      ApprovalEvents.APPROVED,
      expect.objectContaining({
        approvalId: 'approval-1',
        approvalNo: 'APR2603140001',
      }),
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        entityNo: 'APR2603140001',
        workflowType: 'ONBOARDING',
        workflowId: 'ONB-1',
        workflowNo: 'ONB-1',
      }),
      expect.anything(),
    );
  });

  it('rejects workflow-bound decisions when workflow tuple mismatches the chain', async () => {
    prisma.approvalCase.findUnique.mockResolvedValue(
      buildApproval({
        status: ApprovalStatuses.PENDING,
        makerUserId: 'maker-1',
        checkerRoles: 'DPO',
        workflowType: 'ONBOARDING',
        workflowId: 'ONB-1',
        workflowNo: 'ONB-1',
      }),
    );

    await expect(
      service.approve(
        'approval-1',
        {
          reason: 'approve',
          workflowType: 'ONBOARDING',
          workflowId: 'ONB-2',
          workflowNo: 'ONB-2',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows SUPER_ADMIN to bypass maker-checker SoD and records bypass metadata', async () => {
    const superAdminActor = {
      actorType: 'ADMIN' as const,
      userId: 'maker-1',
      userNo: 'ADMIN-001',
      role: 'SUPER_ADMIN',
      roleCodes: ['SUPER_ADMIN'],
    };

    prisma.approvalCase.findUnique.mockResolvedValue(
      buildApproval({
        status: ApprovalStatuses.PENDING,
        makerUserId: 'maker-1',
        checkerRoles: 'DPO,MLRO',
      }),
    );
    prisma.approvalCase.update.mockResolvedValue(
      buildApproval({
        status: ApprovalStatuses.APPROVED,
        makerUserId: 'maker-1',
        checkerRoles: 'DPO,MLRO',
        decisionByUserId: 'maker-1',
        decisionByRole: 'DPO',
      }),
    );

    const result = await service.approve(
      'approval-1',
      {
        checkerRole: 'DPO',
        reason: 'demo bypass',
      },
      superAdminActor,
    );

    expect(result.status).toBe(ApprovalStatuses.APPROVED);
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          superAdminBypass: true,
        }),
      }),
      expect.anything(),
    );
  });

  it.each([
    ApprovalStatuses.PENDING,
    ApprovalStatuses.REJECTED,
    ApprovalStatuses.CANCELLED,
    ApprovalStatuses.EXPIRED,
  ])('blocks requireApproved when approval is %s', async (status) => {
    prisma.approvalCase.findUnique.mockResolvedValue(buildApproval({ status }));

    await expect(
      service.requireApproved({
        actionType: ApprovalActionTypes.SENSITIVE_EXPORT_APPROVAL,
        entityRef: 'pkg-1',
        approvalCaseId: 'approval-1',
        actor,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('filters approvals by approvalNo and keyword', async () => {
    prisma.approvalCase.count.mockResolvedValue(0);
    prisma.approvalCase.findMany.mockResolvedValue([]);

    await service.list(
      {
        approvalNo: 'APR2603140001',
        keyword: 'APR260314',
      },
      actor,
    );

    expect(prisma.approvalCase.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          approvalNo: 'APR2603140001',
          OR: expect.arrayContaining([
            { approvalNo: { contains: 'APR260314' } },
          ]),
        }),
      }),
    );
  });

  it('expires overdue pending approvals and emits expiry event', async () => {
    prisma.approvalCase.findMany.mockResolvedValue([{ id: 'approval-1' }]);
    prisma.approvalCase.findUnique.mockResolvedValue(
      buildApproval({
        status: ApprovalStatuses.PENDING,
        timeoutAt: new Date('2026-03-13T10:00:00.000Z'),
      }),
    );
    prisma.approvalCase.update.mockResolvedValue(
      buildApproval({
        status: ApprovalStatuses.EXPIRED,
        timeoutAt: new Date('2026-03-13T10:00:00.000Z'),
        decisionReason: 'Approval expired after timeout',
      }),
    );

    const result = await service.expirePendingApprovals();

    expect(result.expiredCount).toBe(1);
    expect(prisma.approvalStep.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'EXPIRED',
        }),
      }),
    );
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      ApprovalEvents.EXPIRED,
      expect.objectContaining({
        approvalId: 'approval-1',
        approvalNo: 'APR2603140001',
      }),
    );
  });
});
