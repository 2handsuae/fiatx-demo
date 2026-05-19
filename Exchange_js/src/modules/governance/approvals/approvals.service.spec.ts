import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { AuditActions } from '../../audit-logging/constants/audit-actions.constant';
import {
  ApprovalActionTypes,
  ApprovalEvents,
  ApprovalStatuses,
} from './constants/approval.constants';

const baseDate = new Date('2026-03-14T10:00:00.000Z');

const buildApproval = (overrides: Record<string, unknown> = {}) => ({
  id: 'approval-1',
  approvalNo: 'APR2603140001',
  actionType: ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
  entityRef: 'pkg-1',
  createdByUserId: 'maker-1',
  createdByUserNo: 'USR-MAKER-001',
  status: ApprovalStatuses.DRAFT,
  selectedCheckerRole: 'DPO',
  allowCancel: true,
  allowRetry: true,
  metadataJson: '{}',
  traceId: 'trace-1',
  createdAt: baseDate,
  updatedAt: baseDate,
  submittedAt: null,
  timeoutAt: null,
  decidedAt: null,
  executedAt: null,
  decisionByUserId: null,
  decisionByUserNo: null,
  decisionByRole: null,
  decisionReason: null,
  steps: [
    {
      id: 'step-1',
      approvalCaseId: 'approval-1',
      approvalNo: 'APR2603140001',
      stepNo: 1,
      status: 'PENDING',
      checkerRoleCandidates: 'DPO,MLRO',
      decidedByUserId: null,
      decidedByUserNo: null,
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
  let lastCreatedApprovalData: Record<string, any> | null;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'checker-1',
    userNo: 'USR-1',
    role: 'DPO',
    roleCodes: ['DPO'],
  };

  beforeEach(() => {
    lastCreatedApprovalData = null;
    prisma = {
      approvalCase: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, any> }) => {
          lastCreatedApprovalData = data;
          return buildApproval({
            ...data,
            metadataJson: data.metadataJson,
            steps: [
              {
                id: 'step-1',
                approvalCaseId: 'approval-1',
                approvalNo: data.approvalNo,
                stepNo: 1,
                status: 'PENDING',
                checkerRoleCandidates: data.steps?.create?.checkerRoleCandidates || 'DPO,MLRO',
                decidedByUserId: null,
                decidedByUserNo: null,
                decidedByRole: null,
                reason: null,
                decidedAt: null,
                createdAt: baseDate,
                updatedAt: baseDate,
              },
            ],
          });
        }),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      approvalStep: {
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (cb: (tx: any) => unknown) => cb(prisma)),
    };

    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };

    approvalPolicyService = {
      getPolicy: jest.fn().mockResolvedValue({
        actionType: ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
        steps: [{ stepNo: 1, roles: ['DPO', 'MLRO'] }],
        timeoutHours: 24,
        allowCancel: true,
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
        actionType: ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
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
        actionType: ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
        entityRef: 'pkg-1',
      },
      actor,
    );

    expect(result.approvalNo).toBe('APR2603140001');
    expect(prisma.approvalCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          approvalNo: expect.stringMatching(/^APR\d{10}$/),
          createdByUserNo: actor.userNo,
          steps: {
            create: expect.arrayContaining([
              expect.objectContaining({
                stepNo: 1,
                status: 'PENDING',
                checkerRoleCandidates: 'DPO,MLRO',
              }),
            ]),
          },
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
        createdByUserId: actor.userId,
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
        createdByUserId: 'maker-1',
      }),
    );
    prisma.approvalCase.update.mockResolvedValue(
      buildApproval({
        status: ApprovalStatuses.APPROVED,
        createdByUserId: 'maker-1',
        decisionByUserId: actor.userId,
        decisionByRole: 'DPO',
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
    expect(result).not.toHaveProperty('decisionByUserId');
    expect(result).not.toHaveProperty('decisionByRole');
    expect(prisma.approvalStep.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decidedByUserNo: actor.userNo,
          decidedByRole: 'DPO',
        }),
      }),
    );
    expect(prisma.approvalCase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ApprovalStatuses.APPROVED,
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
        actionType: ApprovalActionTypes.RISK_RATING_HIGH_APPROVAL,
        status: ApprovalStatuses.PENDING,
        createdByUserId: 'maker-1',
      }),
    );
    prisma.approvalCase.update.mockResolvedValue(
      buildApproval({
        actionType: ApprovalActionTypes.RISK_RATING_HIGH_APPROVAL,
        status: ApprovalStatuses.APPROVED,
        createdByUserId: 'maker-1',
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
        action: AuditActions.APPROVAL_APPROVED,
        result: 'SUCCESS',
        metadata: expect.objectContaining({ superAdminBypass: true }),
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
        actionType: ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
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

  it('lists approvals using persisted createdByUserNo without user lookup', async () => {
    prisma.approvalCase.count.mockResolvedValue(1);
    prisma.approvalCase.findMany.mockResolvedValue([
      buildApproval({
        createdByUserId: 'maker-1',
        createdByUserNo: 'USR-MAKER-001',
      }),
    ]);

    const result = await service.list({}, actor);

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(result.items[0]).toMatchObject({
      createdByUserId: 'maker-1',
      createdByUserNo: 'USR-MAKER-001',
    });
    expect(result.items[0]).not.toHaveProperty('maker.userNo');
  });

  it('lists approvals when persisted createdByUserNo is absent and leaves it null', async () => {
    prisma.approvalCase.count.mockResolvedValue(1);
    prisma.approvalCase.findMany.mockResolvedValue([
      buildApproval({
        createdByUserId: 'maker-1',
        createdByUserNo: null,
      }),
    ]);

    const result = await service.list({}, actor);

    expect(result.items[0]).toMatchObject({
      createdByUserId: 'maker-1',
      createdByUserNo: null,
    });
  });

  it('returns approval detail with persisted operator-facing Nos and hides raw decision ids', async () => {
    prisma.approvalCase.findUnique.mockResolvedValue(
      buildApproval({
        status: ApprovalStatuses.APPROVED,
        createdByUserId: 'maker-1',
        createdByUserNo: 'USR-MAKER-001',
        decisionByUserId: 'checker-1',
        decisionByUserNo: 'USR-CHECKER-001',
        decisionByRole: 'DPO',
        decisionReason: 'approved for wave 1 path',
        steps: [
          {
            id: 'step-1',
            approvalCaseId: 'approval-1',
            approvalNo: 'APR2603140001',
            stepNo: 1,
            status: 'APPROVED',
            checkerRoleCandidates: 'DPO',
            decidedByUserId: 'checker-1',
            decidedByUserNo: 'USR-CHECKER-001',
            decidedByRole: 'DPO',
            reason: 'approved for wave 1 path',
            decidedAt: baseDate,
            createdAt: baseDate,
            updatedAt: baseDate,
          },
        ],
      }),
    );

    const result = await service.getById('approval-1', actor);

    expect(result).toMatchObject({
      createdByUserId: 'maker-1',
      createdByUserNo: 'USR-MAKER-001',
      allowCancel: true,
    });
    expect(result.step).toMatchObject({
      stepNo: 1,
      status: 'APPROVED',
      decidedByUserNo: 'USR-CHECKER-001',
      decidedByRole: 'DPO',
      reason: 'approved for wave 1 path',
    });
    expect(result.step).not.toHaveProperty('decidedByUserId');
  });

  it('returns approval detail when persisted createdByUserNo is absent and leaves it null', async () => {
    prisma.approvalCase.findUnique.mockResolvedValue(
      buildApproval({
        status: ApprovalStatuses.APPROVED,
        createdByUserId: 'maker-1',
        createdByUserNo: null,
        decisionByUserId: 'checker-1',
        decisionByRole: 'DPO',
      }),
    );

    const result = await service.getById('approval-1', actor);

    expect(result).toMatchObject({
      createdByUserId: 'maker-1',
      createdByUserNo: null,
    });
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
    expect(prisma.approvalStep.updateMany).toHaveBeenCalledWith(
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

  describe('multi-step approval', () => {
    it('full 2-step dual-sign: MLRO approves step 1 → case PENDING, SENIOR approves step 2 → APPROVED', async () => {
      // Mutable case record simulating DB state
      let caseRecord: any = {
        id: 'approval-ms-1',
        approvalNo: 'APR2603140002',
        actionType: ApprovalActionTypes.RISK_RATING_HIGH_APPROVAL,
        entityRef: 'customer-ms-1',
        createdByUserId: 'maker-ms-1',
        createdByUserNo: 'USR-MAKER-MS-001',
        status: ApprovalStatuses.PENDING,
        selectedCheckerRole: 'MLRO',
        allowCancel: true,
        allowRetry: true,
        metadataJson: '{}',
        traceId: 'trace-ms-1',
        createdAt: baseDate,
        updatedAt: baseDate,
        submittedAt: baseDate,
        timeoutAt: new Date(baseDate.getTime() + 168 * 60 * 60 * 1000),
        decidedAt: null,
        executedAt: null,
        decisionByUserId: null,
        decisionByUserNo: null,
        decisionByRole: null,
        decisionReason: null,
        evidencePackage: null,
      
        steps: [
          {
            id: 'step-ms-1',
            approvalCaseId: 'approval-ms-1',
            approvalNo: 'APR2603140002',
            stepNo: 1,
            status: ApprovalStatuses.PENDING,
            checkerRoleCandidates: 'MLRO',
            decidedByUserId: null,
            decidedByUserNo: null,
            decidedByRole: null,
            reason: null,
            decidedAt: null,
            createdAt: baseDate,
            updatedAt: baseDate,
          },
          {
            id: 'step-ms-2',
            approvalCaseId: 'approval-ms-1',
            approvalNo: 'APR2603140002',
            stepNo: 2,
            status: ApprovalStatuses.PENDING,
            checkerRoleCandidates: 'SENIOR_MANAGEMENT_OFFICER',
            decidedByUserId: null,
            decidedByUserNo: null,
            decidedByRole: null,
            reason: null,
            decidedAt: null,
            createdAt: baseDate,
            updatedAt: baseDate,
          },
        ],
      };

      // Mock policy for dual-role
      approvalPolicyService.getPolicy.mockResolvedValue({
        actionType: ApprovalActionTypes.RISK_RATING_HIGH_APPROVAL,
        riskLevel: 'HIGH',
        checkerRoles: ['MLRO', 'SENIOR_MANAGEMENT_OFFICER'],
        timeoutHours: 168,
        allowCancel: true,
        allowRetry: true,
      });

      // findUnique always returns latest caseRecord
      prisma.approvalCase.findUnique.mockImplementation(async () => ({
        ...caseRecord,
        steps: caseRecord.steps.map((s: any) => ({ ...s })),
      }));

      // approvalStep.update mutates the corresponding step in caseRecord
      prisma.approvalStep.update.mockImplementation(
        async ({ where, data }: { where: any; data: any }) => {
          const stepNo = where.approvalCaseId_stepNo?.stepNo;
          const step = caseRecord.steps.find((s: any) => s.stepNo === stepNo);
          if (step) Object.assign(step, data);
          return step;
        },
      );

      // approvalCase.update mutates caseRecord and returns it (used for final APPROVED update)
      prisma.approvalCase.update.mockImplementation(
        async ({ data }: { data: any }) => {
          Object.assign(caseRecord, data);
          return { ...caseRecord, steps: caseRecord.steps.map((s: any) => ({ ...s })) };
        },
      );

      const mlroActor = {
        actorType: 'ADMIN' as const,
        userId: 'checker-mlro-1',
        userNo: 'USR-MLRO-001',
        role: 'MLRO',
        roleCodes: ['MLRO'],
      };

      const seniorActor = {
        actorType: 'ADMIN' as const,
        userId: 'checker-senior-1',
        userNo: 'USR-SENIOR-001',
        role: 'SENIOR_MANAGEMENT_OFFICER',
        roleCodes: ['SENIOR_MANAGEMENT_OFFICER'],
      };

      // Step 1: MLRO approves → case should still be PENDING (mid-flow)
      const afterStep1 = await service.approve('approval-ms-1', { reason: 'MLRO sign-off' }, mlroActor);

      expect(afterStep1.status).toBe(ApprovalStatuses.PENDING);
      expect(caseRecord.steps[0].status).toBe(ApprovalStatuses.APPROVED);
      expect(caseRecord.steps[1].status).toBe(ApprovalStatuses.PENDING);

      // Step 2: SENIOR approves → case should be APPROVED (last step)
      const afterStep2 = await service.approve('approval-ms-1', { reason: 'Senior sign-off' }, seniorActor);

      expect(afterStep2.status).toBe(ApprovalStatuses.APPROVED);
      expect(caseRecord.steps[1].status).toBe(ApprovalStatuses.APPROVED);
      expect(caseRecord.status).toBe(ApprovalStatuses.APPROVED);

      // Event emitted only once (after final approval)
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
        ApprovalEvents.APPROVED,
        expect.objectContaining({ approvalId: 'approval-ms-1' }),
      );
    });

    it('reject on any step marks entire case REJECTED', async () => {
      // Mutable case record simulating DB state
      let caseRecord: any = {
        id: 'approval-ms-2',
        approvalNo: 'APR2603140003',
        actionType: ApprovalActionTypes.PEP_RELATIONSHIP_APPROVAL,
        entityRef: 'customer-ms-2',
        createdByUserId: 'maker-ms-2',
        createdByUserNo: 'USR-MAKER-MS-002',
        status: ApprovalStatuses.PENDING,
        selectedCheckerRole: 'MLRO',
        allowCancel: true,
        allowRetry: true,
        metadataJson: '{}',
        traceId: 'trace-ms-2',
        createdAt: baseDate,
        updatedAt: baseDate,
        submittedAt: baseDate,
        timeoutAt: new Date(baseDate.getTime() + 240 * 60 * 60 * 1000),
        decidedAt: null,
        executedAt: null,
        decisionByUserId: null,
        decisionByUserNo: null,
        decisionByRole: null,
        decisionReason: null,
        evidencePackage: null,
      
        steps: [
          {
            id: 'step-ms-3',
            approvalCaseId: 'approval-ms-2',
            approvalNo: 'APR2603140003',
            stepNo: 1,
            status: ApprovalStatuses.PENDING,
            checkerRoleCandidates: 'MLRO',
            decidedByUserId: null,
            decidedByUserNo: null,
            decidedByRole: null,
            reason: null,
            decidedAt: null,
            createdAt: baseDate,
            updatedAt: baseDate,
          },
          {
            id: 'step-ms-4',
            approvalCaseId: 'approval-ms-2',
            approvalNo: 'APR2603140003',
            stepNo: 2,
            status: ApprovalStatuses.PENDING,
            checkerRoleCandidates: 'SENIOR_MANAGEMENT_OFFICER',
            decidedByUserId: null,
            decidedByUserNo: null,
            decidedByRole: null,
            reason: null,
            decidedAt: null,
            createdAt: baseDate,
            updatedAt: baseDate,
          },
        ],
      };

      // Mock policy for PEP dual-role
      approvalPolicyService.getPolicy.mockResolvedValue({
        actionType: ApprovalActionTypes.PEP_RELATIONSHIP_APPROVAL,
        riskLevel: 'HIGH',
        checkerRoles: ['MLRO', 'SENIOR_MANAGEMENT_OFFICER'],
        timeoutHours: 240,
        allowCancel: true,
        allowRetry: true,
      });

      // findUnique always returns latest caseRecord
      prisma.approvalCase.findUnique.mockImplementation(async () => ({
        ...caseRecord,
        steps: caseRecord.steps.map((s: any) => ({ ...s })),
      }));

      // approvalStep.update mutates the corresponding step in caseRecord
      prisma.approvalStep.update.mockImplementation(
        async ({ where, data }: { where: any; data: any }) => {
          const stepNo = where.approvalCaseId_stepNo?.stepNo;
          const step = caseRecord.steps.find((s: any) => s.stepNo === stepNo);
          if (step) Object.assign(step, data);
          return step;
        },
      );

      // approvalStep.updateMany cancels remaining pending steps
      prisma.approvalStep.updateMany.mockImplementation(
        async ({ where, data }: { where: any; data: any }) => {
          let count = 0;
          caseRecord.steps.forEach((s: any) => {
            if (s.status === where.status) {
              Object.assign(s, data);
              count++;
            }
          });
          return { count };
        },
      );

      // approvalCase.update mutates caseRecord and returns it
      prisma.approvalCase.update.mockImplementation(
        async ({ data }: { data: any }) => {
          Object.assign(caseRecord, data);
          return { ...caseRecord, steps: caseRecord.steps.map((s: any) => ({ ...s })) };
        },
      );

      const mlroActor = {
        actorType: 'ADMIN' as const,
        userId: 'checker-mlro-2',
        userNo: 'USR-MLRO-002',
        role: 'MLRO',
        roleCodes: ['MLRO'],
      };

      // MLRO rejects step 1 → entire case REJECTED, step 2 CANCELLED
      const result = await service.reject('approval-ms-2', { reason: 'PEP risk too high' }, mlroActor);

      expect(result.status).toBe(ApprovalStatuses.REJECTED);
      expect(caseRecord.steps[0].status).toBe(ApprovalStatuses.REJECTED);
      expect(caseRecord.steps[1].status).toBe(ApprovalStatuses.CANCELLED);
      expect(caseRecord.status).toBe(ApprovalStatuses.REJECTED);

      expect(prisma.approvalStep.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
        ApprovalEvents.REJECTED,
        expect.objectContaining({ approvalId: 'approval-ms-2' }),
      );
    });
  });
});
