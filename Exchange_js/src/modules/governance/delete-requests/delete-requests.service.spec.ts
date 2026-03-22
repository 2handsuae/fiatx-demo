import { ForbiddenException } from '@nestjs/common';
import { DeleteRequestsService } from './delete-requests.service';
import {
  DeleteRequestStatuses,
  DeleteRequestTargetTypes,
} from './constants/delete-request.constants';
import {
  ApprovalActionTypes,
  ApprovalStatuses,
} from '../approvals/constants/approval.constants';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';

const baseDate = new Date('2026-03-15T08:00:00.000Z');

const buildDeleteRequest = (overrides: Record<string, unknown> = {}) => ({
  id: 'delete-request-1',
  requestNo: 'DR2603150001',
  targetType: DeleteRequestTargetTypes.CHANGE_TICKET,
  targetId: 'ticket-1',
  targetNo: 'CT2603150001',
  status: DeleteRequestStatuses.DRAFT,
  latestApprovalId: null,
  latestApprovalStatus: null,
  makerUserId: 'maker-1',
  submittedByUserId: null,
  executedByUserId: null,
  deleteReason: 'Cleanup closed ticket',
  docRef: 'DOC-1',
  targetSnapshotJson: '{}',
  traceId: 'trace-1',
  createdAt: baseDate,
  updatedAt: baseDate,
  submittedAt: null,
  executedAt: null,
  latestApproval: null,
  ...overrides,
});

const buildChangeTicketTarget = (overrides: Record<string, unknown> = {}) => ({
  id: 'ticket-1',
  ticketNo: 'CT2603150001',
  status: 'CLOSED',
  changeType: 'ADMIN_ACCESS_CHANGE',
  latestApprovalId: 'approval-ticket-1',
  latestApprovalStatus: 'APPROVED',
  traceId: 'trace-ticket-1',
  createdAt: baseDate,
  updatedAt: baseDate,
  deletedAt: null,
  deletedBy: null,
  deleteRequestId: null,
  deleteReason: null,
  ...overrides,
});

const buildCaseEvidencePackageTarget = (overrides: Record<string, unknown> = {}) => ({
  id: 'case-package-1',
  packageNo: 'CEP2603150001',
  approvalCaseId: 'approval-case-1',
  status: 'READY',
  exportMode: 'CASE_SELECTION',
  itemCount: 2,
  digest: 'd'.repeat(64),
  createdAt: baseDate,
  updatedAt: baseDate,
  deletedAt: null,
  deletedBy: null,
  deleteRequestId: null,
  deleteReason: null,
  approvalCase: {
    approvalNo: 'APR2603150099',
    status: ApprovalStatuses.APPROVED,
  },
  ...overrides,
});

const buildAdminUserTarget = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  userNo: 'ADM2603150001',
  email: 'ops@example.com',
  status: 'ACTIVE',
  role: 'OPS',
  createdAt: baseDate,
  updatedAt: baseDate,
  deletedAt: null,
  deletedBy: null,
  deleteRequestId: null,
  deleteReason: null,
  userRoles: [
    {
      role: {
        code: 'OPS',
        name: 'Operations',
      },
    },
  ],
  ...overrides,
});

describe('DeleteRequestsService', () => {
  let prisma: any;
  let approvalsService: any;
  let auditLogsService: any;
  let service: DeleteRequestsService;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'maker-1',
    userNo: 'ADM-001',
    role: 'TECH_ADMIN',
    roleCodes: ['TECH_ADMIN'],
  };

  const executor = {
    actorType: 'ADMIN' as const,
    userId: 'executor-1',
    userNo: 'ADM-002',
    role: 'DPO',
    roleCodes: ['DPO'],
  };

  beforeEach(() => {
    prisma = {
      changeTicket: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      approvalCase: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      auditEvidencePackage: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      complianceCaseEvidencePackage: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      adminUserInvitation: {
        updateMany: jest.fn(),
      },
      deleteRequest: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: any) => unknown) => cb(prisma)),
    };

    approvalsService = {
      createAndSubmit: jest.fn(),
      emitSubmittedSideEffects: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn(),
      requireApproved: jest.fn(),
      markExecutionResult: jest.fn().mockResolvedValue(undefined),
    };

    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };

    service = new DeleteRequestsService(prisma, approvalsService, auditLogsService);
  });

  it('creates a delete request with generated requestNo and audit record', async () => {
    prisma.changeTicket.findFirst.mockResolvedValue(buildChangeTicketTarget());
    prisma.deleteRequest.findFirst.mockResolvedValue(null);
    prisma.deleteRequest.create.mockResolvedValue(buildDeleteRequest());

    const result = await service.create(
      {
        targetType: DeleteRequestTargetTypes.CHANGE_TICKET,
        targetNo: 'CT2603150001',
        deleteReason: 'Cleanup closed ticket',
      },
      actor,
    );

    expect(result.requestNo).toBe('DR2603150001');
    expect(prisma.deleteRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestNo: expect.stringMatching(/^DR\d{10}$/),
        }),
      }),
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.DELETE_REQUEST_CREATED,
        module: AuditModules.GOVERNANCE_DELETE_REQUESTS,
        entityType: AuditEntityTypes.DELETE_REQUEST,
        entityNo: 'DR2603150001',
      }),
      expect.anything(),
    );
  });

  it('returns existing active delete request for the same target', async () => {
    prisma.changeTicket.findFirst.mockResolvedValue(buildChangeTicketTarget());
    prisma.deleteRequest.findFirst.mockResolvedValue(
      buildDeleteRequest({ status: DeleteRequestStatuses.SUBMITTED }),
    );

    const result = await service.create(
      {
        targetType: DeleteRequestTargetTypes.CHANGE_TICKET,
        targetNo: 'CT2603150001',
        deleteReason: 'Cleanup closed ticket',
      },
      actor,
    );

    expect(result.requestNo).toBe('DR2603150001');
    expect(prisma.deleteRequest.create).not.toHaveBeenCalled();
  });

  it('creates a delete request for case evidence export targets', async () => {
    prisma.complianceCaseEvidencePackage.findFirst.mockResolvedValue(
      buildCaseEvidencePackageTarget(),
    );
    prisma.deleteRequest.findFirst.mockResolvedValue(null);
    prisma.deleteRequest.create.mockResolvedValue(
      buildDeleteRequest({
        targetType: DeleteRequestTargetTypes.COMPLIANCE_CASE_EVIDENCE_PACKAGE,
        targetId: 'case-package-1',
        targetNo: 'CEP2603150001',
      }),
    );

    const result = await service.create(
      {
        targetType: DeleteRequestTargetTypes.COMPLIANCE_CASE_EVIDENCE_PACKAGE,
        targetNo: 'CEP2603150001',
        deleteReason: 'Cleanup exported case package',
      },
      actor,
    );

    expect(result.targetType).toBe(
      DeleteRequestTargetTypes.COMPLIANCE_CASE_EVIDENCE_PACKAGE,
    );
    expect(prisma.deleteRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetType: DeleteRequestTargetTypes.COMPLIANCE_CASE_EVIDENCE_PACKAGE,
          targetNo: 'CEP2603150001',
        }),
      }),
    );
  });

  it('submits a draft delete request and links approval', async () => {
    prisma.deleteRequest.findUnique
      .mockResolvedValueOnce(buildDeleteRequest())
      .mockResolvedValueOnce(buildDeleteRequest())
      .mockResolvedValueOnce(
        buildDeleteRequest({
          status: DeleteRequestStatuses.APPROVAL_PENDING,
          submittedByUserId: actor.userId,
          submittedAt: baseDate,
          latestApprovalId: 'approval-1',
          latestApprovalStatus: ApprovalStatuses.PENDING,
          latestApproval: {
            id: 'approval-1',
            approvalNo: 'APR2603150001',
            status: ApprovalStatuses.PENDING,
            traceId: 'trace-1',
          },
        }),
      );
    prisma.changeTicket.findUnique.mockResolvedValue(buildChangeTicketTarget());
    prisma.deleteRequest.update
      .mockResolvedValueOnce(
        buildDeleteRequest({
          status: DeleteRequestStatuses.SUBMITTED,
          submittedByUserId: actor.userId,
          submittedAt: baseDate,
        }),
      )
      .mockResolvedValueOnce(
        buildDeleteRequest({
          status: DeleteRequestStatuses.APPROVAL_PENDING,
          submittedByUserId: actor.userId,
          submittedAt: baseDate,
          latestApprovalId: 'approval-1',
          latestApprovalStatus: ApprovalStatuses.PENDING,
          latestApproval: {
            id: 'approval-1',
            approvalNo: 'APR2603150001',
            status: ApprovalStatuses.PENDING,
            traceId: 'trace-1',
          },
        }),
      );
    approvalsService.createAndSubmit.mockResolvedValue({
      id: 'approval-1',
      approvalNo: 'APR2603150001',
      status: ApprovalStatuses.PENDING,
    });

    const result = await service.submit('delete-request-1', { reason: 'submit' }, actor);

    expect(result.status).toBe(DeleteRequestStatuses.APPROVAL_PENDING);
    expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: ApprovalActionTypes.DELETE_REQUEST_APPROVAL,
        entityRef: 'delete-request-1',
      }),
      expect.anything(),
      actor,
      prisma,
      { emitSideEffects: false },
    );
    expect(approvalsService.emitSubmittedSideEffects).toHaveBeenCalledWith(
      'approval-1',
      actor,
      'submit',
    );
  });

  it('projects approved approval to READY_TO_EXECUTE', async () => {
    prisma.deleteRequest.findUnique.mockResolvedValue(
      buildDeleteRequest({
        status: DeleteRequestStatuses.APPROVAL_PENDING,
        latestApprovalId: 'approval-1',
        latestApprovalStatus: ApprovalStatuses.PENDING,
        latestApproval: {
          id: 'approval-1',
          approvalNo: 'APR2603150001',
          status: ApprovalStatuses.APPROVED,
          traceId: 'trace-1',
        },
      }),
    );
    prisma.deleteRequest.update.mockResolvedValue(
      buildDeleteRequest({
        status: DeleteRequestStatuses.READY_TO_EXECUTE,
        latestApprovalId: 'approval-1',
        latestApprovalStatus: ApprovalStatuses.APPROVED,
        latestApproval: {
          id: 'approval-1',
          approvalNo: 'APR2603150001',
          status: ApprovalStatuses.APPROVED,
          traceId: 'trace-1',
        },
      }),
    );

    const result = await service.syncApprovalProjectionByEvent({
      approvalId: 'approval-1',
      approvalNo: 'APR2603150001',
      entityRef: 'delete-request-1',
      actionType: ApprovalActionTypes.DELETE_REQUEST_APPROVAL,
      status: ApprovalStatuses.APPROVED,
    });

    expect(result?.status).toBe(DeleteRequestStatuses.READY_TO_EXECUTE);
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.DELETE_REQUEST_APPROVED,
        statusTo: DeleteRequestStatuses.READY_TO_EXECUTE,
      }),
      expect.anything(),
    );
  });

  it('blocks maker from executing their own request', async () => {
    prisma.deleteRequest.findUnique.mockResolvedValue(
      buildDeleteRequest({
        status: DeleteRequestStatuses.READY_TO_EXECUTE,
        latestApprovalId: 'approval-1',
        latestApprovalStatus: ApprovalStatuses.APPROVED,
        latestApproval: {
          id: 'approval-1',
          approvalNo: 'APR2603150001',
          status: ApprovalStatuses.APPROVED,
          traceId: 'trace-1',
        },
      }),
    );

    await expect(
      service.execute('delete-request-1', { reason: 'execute' }, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('executes delete request and soft deletes the target', async () => {
    prisma.deleteRequest.findUnique.mockResolvedValue(
      buildDeleteRequest({
        status: DeleteRequestStatuses.READY_TO_EXECUTE,
        latestApprovalId: 'approval-1',
        latestApprovalStatus: ApprovalStatuses.APPROVED,
        latestApproval: {
          id: 'approval-1',
          approvalNo: 'APR2603150001',
          status: ApprovalStatuses.APPROVED,
          traceId: 'trace-1',
        },
      }),
    );
    prisma.changeTicket.findUnique.mockResolvedValue(buildChangeTicketTarget());
    prisma.changeTicket.update.mockResolvedValue(
      buildChangeTicketTarget({
        deletedAt: baseDate,
        deletedBy: executor.userId,
        deleteRequestId: 'delete-request-1',
        deleteReason: 'Cleanup closed ticket',
      }),
    );
    prisma.deleteRequest.update.mockResolvedValue(
      buildDeleteRequest({
        status: DeleteRequestStatuses.EXECUTED,
        latestApprovalId: 'approval-1',
        latestApprovalStatus: ApprovalStatuses.APPROVED,
        executedByUserId: executor.userId,
        executedAt: baseDate,
        targetSnapshotJson: JSON.stringify({
          targetType: DeleteRequestTargetTypes.CHANGE_TICKET,
          targetId: 'ticket-1',
          targetNo: 'CT2603150001',
        }),
        latestApproval: {
          id: 'approval-1',
          approvalNo: 'APR2603150001',
          status: ApprovalStatuses.APPROVED,
          traceId: 'trace-1',
        },
      }),
    );
    approvalsService.requireApproved.mockResolvedValue({
      id: 'approval-1',
      approvalNo: 'APR2603150001',
      status: ApprovalStatuses.APPROVED,
    });

    const result = await service.execute(
      'delete-request-1',
      { reason: 'execute now' },
      executor,
    );

    expect(result.status).toBe(DeleteRequestStatuses.EXECUTED);
    expect(prisma.changeTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-1' },
        data: expect.objectContaining({
          deletedBy: executor.userId,
          deleteRequestId: 'delete-request-1',
        }),
      }),
    );
    expect(approvalsService.markExecutionResult).toHaveBeenCalledWith(
      'approval-1',
      true,
      executor,
      'execute now',
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.DELETE_REQUEST_EXECUTED,
        statusTo: DeleteRequestStatuses.EXECUTED,
      }),
      expect.anything(),
    );
  });

  it('executes admin-user delete request and revokes pending invitations', async () => {
    prisma.deleteRequest.findUnique.mockResolvedValue(
      buildDeleteRequest({
        status: DeleteRequestStatuses.READY_TO_EXECUTE,
        targetType: DeleteRequestTargetTypes.ADMIN_USER,
        targetId: 'user-1',
        targetNo: 'ADM2603150001',
        latestApprovalId: 'approval-1',
        latestApprovalStatus: ApprovalStatuses.APPROVED,
        latestApproval: {
          id: 'approval-1',
          approvalNo: 'APR2603150001',
          status: ApprovalStatuses.APPROVED,
          traceId: 'trace-1',
        },
      }),
    );
    prisma.user.findUnique.mockResolvedValue(buildAdminUserTarget());
    prisma.user.update.mockResolvedValue(
      buildAdminUserTarget({
        deletedAt: baseDate,
        deletedBy: executor.userId,
        deleteRequestId: 'delete-request-1',
        deleteReason: 'Cleanup closed ticket',
      }),
    );
    prisma.adminUserInvitation.updateMany.mockResolvedValue({ count: 1 });
    prisma.deleteRequest.update.mockResolvedValue(
      buildDeleteRequest({
        status: DeleteRequestStatuses.EXECUTED,
        targetType: DeleteRequestTargetTypes.ADMIN_USER,
        targetId: 'user-1',
        targetNo: 'ADM2603150001',
        latestApprovalId: 'approval-1',
        latestApprovalStatus: ApprovalStatuses.APPROVED,
        executedByUserId: executor.userId,
        executedAt: baseDate,
        targetSnapshotJson: JSON.stringify({
          targetType: DeleteRequestTargetTypes.ADMIN_USER,
          targetId: 'user-1',
          targetNo: 'ADM2603150001',
        }),
        latestApproval: {
          id: 'approval-1',
          approvalNo: 'APR2603150001',
          status: ApprovalStatuses.APPROVED,
          traceId: 'trace-1',
        },
      }),
    );
    approvalsService.requireApproved.mockResolvedValue({
      id: 'approval-1',
      approvalNo: 'APR2603150001',
      status: ApprovalStatuses.APPROVED,
    });

    const result = await service.execute(
      'delete-request-1',
      { reason: 'execute now' },
      executor,
    );

    expect(result.status).toBe(DeleteRequestStatuses.EXECUTED);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          deletedBy: executor.userId,
          deleteRequestId: 'delete-request-1',
        }),
      }),
    );
    expect(prisma.adminUserInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          consumedAt: null,
          revokedAt: null,
        }),
      }),
    );
  });
});
