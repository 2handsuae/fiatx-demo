import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { AuditActions } from '../../risk-engine/audit-logs/constants/audit-actions.constant';
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
  actionType: ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
  entityRef: 'pkg-1',
  createdByUserId: 'maker-1',
  createdByUserNo: 'USR-MAKER-001',
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
  caseEvidencePackage: null,
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
  let changeTicketsService: { syncApprovalProjectionByEvent: jest.Mock };
  let deleteRequestsService: { syncApprovalProjectionByEvent: jest.Mock };
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
      changeTicket: {
        findFirst: jest.fn(),
      },
      deleteRequest: {
        findFirst: jest.fn(),
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

    changeTicketsService = {
      syncApprovalProjectionByEvent: jest.fn().mockResolvedValue(undefined),
    };

    deleteRequestsService = {
      syncApprovalProjectionByEvent: jest.fn().mockResolvedValue(undefined),
    };

    service = new ApprovalsService(
      prisma,
      auditLogsService as any,
      approvalPolicyService as any,
      eventEmitter as any,
      changeTicketsService as any,
      deleteRequestsService as any,
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
                approvalNo: expect.stringMatching(/^APR\d{10}$/),
              }),
            ]),
          },
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

  it('inherits change-ticket parent workflow context when approval is created and submitted', async () => {
    prisma.approvalCase.findFirst.mockResolvedValue(null);
    prisma.changeTicket.findFirst.mockResolvedValue({
      id: 'ticket-1',
      ticketNo: 'CT2604010001',
      traceId: 'trace-ticket-1',
      changeType: 'ADMIN_ACCESS_CHANGE',
    });
    prisma.approvalCase.findUnique.mockImplementation(async () =>
      buildApproval({
        ...(lastCreatedApprovalData || {}),
        actionType: ApprovalActionTypes.CHANGE_TICKET_APPROVAL,
        entityRef: 'ticket-1',
        status: ApprovalStatuses.DRAFT,
        traceId: lastCreatedApprovalData?.traceId || 'trace-ticket-1',
        workflowType: lastCreatedApprovalData?.workflowType || null,
        workflowId: lastCreatedApprovalData?.workflowId || null,
        workflowNo: lastCreatedApprovalData?.workflowNo || null,
      }),
    );
    prisma.approvalCase.update.mockImplementation(async ({ data }: { data: Record<string, any> }) =>
      buildApproval({
        ...(lastCreatedApprovalData || {}),
        actionType: ApprovalActionTypes.CHANGE_TICKET_APPROVAL,
        entityRef: 'ticket-1',
        status: data.status,
        traceId: lastCreatedApprovalData?.traceId || 'trace-ticket-1',
        workflowType: lastCreatedApprovalData?.workflowType || null,
        workflowId: lastCreatedApprovalData?.workflowId || null,
        workflowNo: lastCreatedApprovalData?.workflowNo || null,
        submittedAt: baseDate,
        timeoutAt: new Date(baseDate.getTime() + 24 * 60 * 60 * 1000),
      }),
    );

    await service.createAndSubmit(
      {
        actionType: ApprovalActionTypes.CHANGE_TICKET_APPROVAL,
        entityRef: 'ticket-1',
        traceId: 'trace-ticket-1',
      },
      {
        reason: 'submit CT approval',
        traceId: 'trace-ticket-1',
      },
      actor,
    );

    expect(prisma.approvalCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workflowType: 'ADMIN_MEMBER_PROVISIONING',
          workflowId: 'ticket-1',
          workflowNo: 'CT2604010001',
          traceId: 'trace-ticket-1',
        }),
      }),
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.APPROVAL_SUBMITTED,
        workflowType: 'ADMIN_MEMBER_PROVISIONING',
        traceId: 'trace-ticket-1',
        subjectNos: expect.arrayContaining([
          expect.objectContaining({
            subjectRole: 'RELATED',
            subjectType: 'ADMIN_MEMBER_PROVISIONING',
            subjectNo: 'CT2604010001',
          }),
        ]),
      }),
      expect.anything(),
    );
  });

  it('overrides caller workflow tuple and trace with change-ticket parent context during create', async () => {
    prisma.approvalCase.findFirst.mockResolvedValue(null);
    prisma.changeTicket.findFirst.mockResolvedValue({
      id: 'ticket-1',
      ticketNo: 'CT2604010001',
      traceId: 'trace-ticket-1',
      changeType: 'ADMIN_ACCESS_CHANGE',
    });

    const result = await service.create(
      {
        actionType: ApprovalActionTypes.CHANGE_TICKET_APPROVAL,
        entityRef: 'ticket-1',
        traceId: 'trace-wrong',
        workflowType: 'APPROVAL',
        workflowId: 'approval-should-not-bind',
        workflowNo: 'APR-WRONG-1',
      },
      actor,
    );

    expect(prisma.approvalCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          traceId: 'trace-ticket-1',
          workflowType: 'ADMIN_MEMBER_PROVISIONING',
          workflowId: 'ticket-1',
          workflowNo: 'CT2604010001',
        }),
      }),
    );
    expect(result).toMatchObject({
      traceId: 'trace-ticket-1',
      workflowType: 'ADMIN_MEMBER_PROVISIONING',
      workflowId: 'ticket-1',
      workflowNo: 'CT2604010001',
    });
  });

  it('inherits delete-request parent workflow context when approval is created and submitted', async () => {
    prisma.approvalCase.findFirst.mockResolvedValue(null);
    prisma.deleteRequest.findFirst.mockResolvedValue({
      id: 'request-1',
      requestNo: 'DR2604010001',
      traceId: 'trace-request-1',
      targetType: 'CHANGE_TICKET',
    });
    prisma.approvalCase.findUnique.mockImplementation(async () =>
      buildApproval({
        ...(lastCreatedApprovalData || {}),
        actionType: ApprovalActionTypes.DELETE_REQUEST_APPROVAL,
        entityRef: 'request-1',
        status: ApprovalStatuses.DRAFT,
        traceId: lastCreatedApprovalData?.traceId || 'trace-request-1',
        workflowType: lastCreatedApprovalData?.workflowType || null,
        workflowId: lastCreatedApprovalData?.workflowId || null,
        workflowNo: lastCreatedApprovalData?.workflowNo || null,
      }),
    );
    prisma.approvalCase.update.mockImplementation(async ({ data }: { data: Record<string, any> }) =>
      buildApproval({
        ...(lastCreatedApprovalData || {}),
        actionType: ApprovalActionTypes.DELETE_REQUEST_APPROVAL,
        entityRef: 'request-1',
        status: data.status,
        traceId: lastCreatedApprovalData?.traceId || 'trace-request-1',
        workflowType: lastCreatedApprovalData?.workflowType || null,
        workflowId: lastCreatedApprovalData?.workflowId || null,
        workflowNo: lastCreatedApprovalData?.workflowNo || null,
        submittedAt: baseDate,
        timeoutAt: new Date(baseDate.getTime() + 24 * 60 * 60 * 1000),
      }),
    );

    await service.createAndSubmit(
      {
        actionType: ApprovalActionTypes.DELETE_REQUEST_APPROVAL,
        entityRef: 'request-1',
        traceId: 'trace-request-1',
      },
      {
        reason: 'submit DR approval',
        traceId: 'trace-request-1',
      },
      actor,
    );

    expect(prisma.approvalCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workflowType: 'CHANGE_TICKET_DELETION',
          workflowId: 'request-1',
          workflowNo: 'DR2604010001',
          traceId: 'trace-request-1',
        }),
      }),
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.APPROVAL_SUBMITTED,
        workflowType: 'CHANGE_TICKET_DELETION',
        traceId: 'trace-request-1',
      }),
      expect.anything(),
    );
  });

  it('overrides caller workflow tuple and trace with delete-request parent context during create', async () => {
    prisma.approvalCase.findFirst.mockResolvedValue(null);
    prisma.deleteRequest.findFirst.mockResolvedValue({
      id: 'request-1',
      requestNo: 'DR2604010001',
      traceId: 'trace-request-1',
      targetType: 'CHANGE_TICKET',
    });

    const result = await service.create(
      {
        actionType: ApprovalActionTypes.DELETE_REQUEST_APPROVAL,
        entityRef: 'request-1',
        traceId: 'trace-wrong',
        workflowType: 'APPROVAL',
        workflowId: 'approval-should-not-bind',
        workflowNo: 'APR-WRONG-1',
      },
      actor,
    );

    expect(prisma.approvalCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          traceId: 'trace-request-1',
          workflowType: 'CHANGE_TICKET_DELETION',
          workflowId: 'request-1',
          workflowNo: 'DR2604010001',
        }),
      }),
    );
    expect(result).toMatchObject({
      traceId: 'trace-request-1',
      workflowType: 'CHANGE_TICKET_DELETION',
      workflowId: 'request-1',
      workflowNo: 'DR2604010001',
    });
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
        createdByUserId: 'maker-1',
        checkerRoles: 'DPO',
        workflowType: 'ONBOARDING',
        workflowId: 'ONB-1',
        workflowNo: 'ONB-1',
      }),
    );
    prisma.approvalCase.update.mockResolvedValue(
      buildApproval({
        status: ApprovalStatuses.APPROVED,
        createdByUserId: 'maker-1',
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
          decisionByUserNo: actor.userNo,
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
        action: AuditActions.APPROVAL_APPROVED,
        entityNo: 'APR2603140001',
        workflowType: 'ONBOARDING',
        subjectNos: expect.arrayContaining([
          expect.objectContaining({
            subjectRole: 'RELATED',
            subjectType: 'ONBOARDING',
            subjectNo: 'ONB-1',
          }),
        ]),
      }),
      expect.anything(),
    );
  });

  it('rejects workflow-bound decisions when workflow tuple mismatches the chain', async () => {
    prisma.approvalCase.findUnique.mockResolvedValue(
      buildApproval({
        status: ApprovalStatuses.PENDING,
        createdByUserId: 'maker-1',
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
        createdByUserId: 'maker-1',
        checkerRoles: 'DPO,MLRO',
      }),
    );
    prisma.approvalCase.update.mockResolvedValue(
      buildApproval({
        status: ApprovalStatuses.APPROVED,
        createdByUserId: 'maker-1',
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
      decisionByUserNo: 'USR-CHECKER-001',
      decisionReason: 'approved for wave 1 path',
      selectedCheckerRole: 'DPO',
      allowCancel: true,
      allowRetry: true,
    });
    expect(result).not.toHaveProperty('decisionByUserId');
    expect(result).not.toHaveProperty('decisionByRole');
    expect(result.step).not.toHaveProperty('decidedByUserId');
    expect(result.step).toMatchObject({
      approvalNo: 'APR2603140001',
      decidedByUserNo: 'USR-CHECKER-001',
    });
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
