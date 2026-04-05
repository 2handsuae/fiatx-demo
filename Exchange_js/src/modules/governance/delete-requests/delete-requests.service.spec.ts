import { BadRequestException } from '@nestjs/common';
import {
  ApprovalActionTypes,
  ApprovalStatuses,
} from '../approvals/constants/approval.constants';
import {
  DeleteRequestStatuses,
  DeleteRequestTargetTypes,
} from './constants/delete-request.constants';
import { ChangeTicketStatuses } from '../change-tickets/constants/change-ticket.constants';
import { DeleteRequestsService } from './delete-requests.service';
import { sha256Hex } from '../../risk-engine/audit-logs/utils/audit-digest.util';
import {
  AuditActions,
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import { AuditSubjectRole } from '../../risk-engine/audit-logs/dto/audit-log.dto';

const actor = {
  actorType: 'ADMIN' as const,
  userId: 'admin-1',
  userNo: 'ADM-001',
  role: 'TECH_ADMIN',
  roleCodes: ['TECH_ADMIN'],
};

const reviewer = {
  actorType: 'ADMIN' as const,
  userId: 'admin-2',
  userNo: 'ADM-002',
  role: 'TECH_ADMIN',
  roleCodes: ['TECH_ADMIN'],
};

function buildApprovalCase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'approval-1',
    approvalNo: 'APR2604010001',
    status: ApprovalStatuses.PENDING,
    traceId: 'trace-1',
    ...overrides,
  };
}

function buildDeleteRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delete-request-1',
    requestNo: 'DR2604010001',
    targetType: DeleteRequestTargetTypes.CHANGE_TICKET,
    targetId: 'change-ticket-1',
    targetNo: 'CT2604010001',
    status: DeleteRequestStatuses.DRAFT,
    approvalCaseId: null,
    approvalNo: null,
    createdByUserId: actor.userId,
    createdByUserNo: actor.userNo,
    submittedByUserId: null,
    submittedByUserNo: null,
    consumedByUserId: null,
    consumedByUserNo: null,
    deleteReason: 'cleanup closed record',
    resultNote: null,
    docRef: 'DOC-1',
    targetSnapshotJson: JSON.stringify({ hello: 'world' }),
    targetSnapshotDigest: null,
    traceId: 'trace-1',
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    submittedAt: null,
    consumedAt: null,
    approvalCase: null,
    ...overrides,
  };
}

function buildService() {
  const prisma = {
    deleteRequest: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    changeTicket: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditEvidencePackage: {
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
    $transaction: jest.fn(),
  };

  const approvalsService = {
    cancel: jest.fn(),
    createAndSubmit: jest.fn(),
    emitSubmittedSideEffects: jest.fn(),
    requireApproved: jest.fn(),
  };

  const auditLogsService = {
    recordByActor: jest.fn(),
  };

  const service = new DeleteRequestsService(
    prisma as any,
    approvalsService as any,
    auditLogsService as any,
  );

  return { service, prisma, approvalsService, auditLogsService };
}

function getSingleAuditCall(auditLogsService: { recordByActor: jest.Mock }) {
  expect(auditLogsService.recordByActor).toHaveBeenCalledTimes(1);
  return auditLogsService.recordByActor.mock.calls[0];
}

describe('DeleteRequestsService Task 3 contract', () => {
  it('filters list by approvalNo, createdByUserNo, and consumedByUserNo', async () => {
    const { service, prisma } = buildService();

    prisma.deleteRequest.count.mockResolvedValue(0);
    prisma.deleteRequest.findMany.mockResolvedValue([]);

    await service.list(
      {
        approvalNo: 'APR2604010001',
        createdByUserNo: 'ADM-001',
        consumedByUserNo: 'ADM-002',
      },
      actor,
    );

    expect(prisma.deleteRequest.count).toHaveBeenCalledWith({
      where: {
        approvalNo: 'APR2604010001',
        createdByUserNo: 'ADM-001',
        consumedByUserNo: 'ADM-002',
      },
    });
    expect(prisma.deleteRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          approvalNo: 'APR2604010001',
          createdByUserNo: 'ADM-001',
          consumedByUserNo: 'ADM-002',
        },
      }),
    );
  });

  it('keeps keyword search operator-facing', async () => {
    const { service, prisma } = buildService();

    prisma.deleteRequest.count.mockResolvedValue(0);
    prisma.deleteRequest.findMany.mockResolvedValue([]);

    await service.list(
      {
        keyword: 'ADM-001',
      },
      actor,
    );

    expect(prisma.deleteRequest.count).toHaveBeenCalledWith({
      where: {
        OR: [
          { requestNo: { contains: 'ADM-001' } },
          { targetNo: { contains: 'ADM-001' } },
          { targetType: { contains: 'ADM-001' } },
          { traceId: { contains: 'ADM-001' } },
          { deleteReason: { contains: 'ADM-001' } },
          { approvalNo: { contains: 'ADM-001' } },
          { createdByUserNo: { contains: 'ADM-001' } },
          { consumedByUserNo: { contains: 'ADM-001' } },
        ],
      },
    });
  });

  it('lists with the new field model only', async () => {
    const { service, prisma } = buildService();
    const consumedAt = new Date('2026-04-02T08:00:00.000Z');

    prisma.deleteRequest.count.mockResolvedValue(1);
    prisma.deleteRequest.findMany.mockResolvedValue([
      buildDeleteRequestRow({
        status: DeleteRequestStatuses.DONE,
        approvalCaseId: 'approval-1',
        approvalNo: 'APR2604010001',
        consumedByUserId: reviewer.userId,
        consumedByUserNo: reviewer.userNo,
        consumedAt,
        resultNote: 'delete applied',
        approvalCase: buildApprovalCase({ status: ApprovalStatuses.APPROVED }),
      }),
    ]);

    const result = await service.list(
      {
        status: DeleteRequestStatuses.DONE,
      },
      actor,
    );

    expect(prisma.deleteRequest.count).toHaveBeenCalledWith({
      where: { status: DeleteRequestStatuses.DONE },
    });
    expect(result.items[0]).toMatchObject({
      approvalCaseId: 'approval-1',
      approvalNo: 'APR2604010001',
      createdByUserId: actor.userId,
      createdByUserNo: actor.userNo,
      consumedByUserId: reviewer.userId,
      consumedByUserNo: reviewer.userNo,
      consumedAt,
      resultNote: 'delete applied',
    });
    expect(result.items[0]).not.toHaveProperty('latestApprovalStatus');
    expect(result.items[0]).not.toHaveProperty('makerUserId');
    expect(result.items[0]).not.toHaveProperty('executedAt');
  });

  it('submit transitions the request to PENDING_APPROVAL and stores approvalCase fields', async () => {
    const { service, prisma, approvalsService } = buildService();
    const draft = buildDeleteRequestRow();
    const pending = buildDeleteRequestRow({
      status: DeleteRequestStatuses.PENDING_APPROVAL,
      approvalCaseId: 'approval-1',
      approvalNo: 'APR2604010001',
      submittedByUserId: actor.userId,
      submittedByUserNo: actor.userNo,
      submittedAt: new Date('2026-04-02T09:00:00.000Z'),
      approvalCase: buildApprovalCase(),
    });

    prisma.deleteRequest.findUnique.mockResolvedValue(draft);
    prisma.changeTicket.findUnique.mockResolvedValue({
      id: 'change-ticket-1',
      ticketNo: 'CT2604010001',
      status: ChangeTicketStatuses.DONE,
      changeType: 'NORMAL',
      approvalCaseId: null,
      approvalNo: null,
      traceId: 'trace-1',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      deletedAt: null,
      deletedBy: null,
      deleteRequestId: null,
      deleteReason: null,
    });
    approvalsService.createAndSubmit.mockResolvedValue(buildApprovalCase());

    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        deleteRequest: {
          findUnique: prisma.deleteRequest.findUnique,
          update: jest.fn().mockImplementation(({ data }: any) => {
            if (data.status === DeleteRequestStatuses.PENDING_APPROVAL) {
              return Promise.resolve(pending);
            }
            return Promise.resolve({ ...draft, ...data });
          }),
        },
      }),
    );

    const result = await service.submit(
      'delete-request-1',
      { reason: 'submit now', traceId: 'trace-1' },
      actor,
    );

    expect(result).toMatchObject({
      status: DeleteRequestStatuses.PENDING_APPROVAL,
      approvalCaseId: 'approval-1',
      approvalNo: 'APR2604010001',
      submittedByUserId: actor.userId,
      submittedByUserNo: actor.userNo,
    });
  });

  it('stores targetSnapshotDigest when creating a delete request', async () => {
    const { service, prisma } = buildService();
    const targetRow = {
      id: 'change-ticket-1',
      ticketNo: 'CT2604010001',
      status: ChangeTicketStatuses.DONE,
      changeType: 'ADMIN_ACCESS_CHANGE',
      approvalCaseId: 'approval-1',
      approvalNo: 'APR2604010001',
      traceId: 'trace-1',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      deletedAt: null,
      deletedBy: null,
      deleteRequestId: null,
      deleteRequestNo: null,
      deleteReason: null,
    };

    prisma.changeTicket.findFirst.mockResolvedValue(targetRow);
    prisma.deleteRequest.findFirst.mockResolvedValue(null);
    prisma.deleteRequest.create.mockImplementation(async ({ data }: any) =>
      buildDeleteRequestRow({
        ...data,
        approvalCase: null,
      }),
    );

    const result = await service.create(
      {
        targetType: DeleteRequestTargetTypes.CHANGE_TICKET,
        targetNo: 'CT2604010001',
        deleteReason: 'cleanup closed record',
        traceId: 'trace-1',
      },
      actor,
    );

    const expectedSnapshot = {
      targetType: DeleteRequestTargetTypes.CHANGE_TICKET,
      targetId: targetRow.id,
      targetNo: targetRow.ticketNo,
      status: targetRow.status,
      changeType: targetRow.changeType,
      approvalCaseId: targetRow.approvalCaseId,
      approvalNo: targetRow.approvalNo,
      traceId: targetRow.traceId,
      createdAt: targetRow.createdAt,
      updatedAt: targetRow.updatedAt,
    };

    expect(prisma.deleteRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetSnapshotJson: JSON.stringify(expectedSnapshot),
          targetSnapshotDigest: sha256Hex(expectedSnapshot),
        }),
      }),
    );
    expect(result).toMatchObject({
      targetSnapshotDigest: sha256Hex(expectedSnapshot),
    });
    expect(result.targetSnapshotJson).toMatchObject({
      ...expectedSnapshot,
      createdAt: expectedSnapshot.createdAt.toISOString(),
      updatedAt: expectedSnapshot.updatedAt.toISOString(),
    });
  });

  it('creates admin user delete requests by userNo and snapshots the governed member fields', async () => {
    const { service, prisma } = buildService();
    const targetRow = {
      id: 'admin-user-1',
      userNo: 'ADM-777',
      email: 'ops@example.com',
      status: 'ACTIVE',
      role: 'OPS_TREASURY',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      deletedAt: null,
      deletedBy: null,
      deleteRequestId: null,
      deleteReason: null,
      userRoles: [
        {
          role: {
            code: 'OPS_TREASURY',
            name: 'Ops Treasury',
          },
        },
      ],
    };

    prisma.user.findFirst.mockResolvedValue(targetRow);
    prisma.deleteRequest.findFirst.mockResolvedValue(null);
    prisma.deleteRequest.create.mockImplementation(async ({ data }: any) =>
      buildDeleteRequestRow({
        ...data,
        targetType: DeleteRequestTargetTypes.ADMIN_USER,
        targetId: targetRow.id,
        targetNo: targetRow.userNo,
        approvalCase: null,
      }),
    );

    const result = await service.create(
      {
        targetType: DeleteRequestTargetTypes.ADMIN_USER,
        targetNo: targetRow.userNo,
        deleteReason: 'Member no longer requires admin access',
        traceId: 'trace-1',
      },
      actor,
    );

    const expectedSnapshot = {
      targetType: DeleteRequestTargetTypes.ADMIN_USER,
      targetId: targetRow.id,
      targetNo: targetRow.userNo,
      email: targetRow.email,
      status: targetRow.status,
      role: targetRow.role,
      roles: ['OPS_TREASURY'],
      createdAt: targetRow.createdAt,
      updatedAt: targetRow.updatedAt,
    };

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userNo: targetRow.userNo,
          deletedAt: null,
        },
      }),
    );
    expect(prisma.deleteRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetType: DeleteRequestTargetTypes.ADMIN_USER,
          targetNo: targetRow.userNo,
          targetSnapshotJson: JSON.stringify(expectedSnapshot),
          targetSnapshotDigest: sha256Hex(expectedSnapshot),
        }),
      }),
    );
    expect(result).toMatchObject({
      targetType: DeleteRequestTargetTypes.ADMIN_USER,
      targetNo: targetRow.userNo,
      targetSnapshotDigest: sha256Hex(expectedSnapshot),
    });
    expect(result.targetSnapshotJson).toMatchObject({
      ...expectedSnapshot,
      createdAt: expectedSnapshot.createdAt.toISOString(),
      updatedAt: expectedSnapshot.updatedAt.toISOString(),
    });
  });

  it('creates evidence package delete requests by packageNo and snapshots export metadata', async () => {
    const { service, prisma } = buildService();
    const targetRow = {
      id: 'evidence-package-1',
      packageNo: 'EVP-777',
      approvalCaseId: 'approval-1',
      status: 'READY',
      exportMode: 'SELECTED_EVENTS',
      itemCount: 3,
      digest: 'digest-1',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      deletedAt: null,
      deletedBy: null,
      deleteRequestId: null,
      deleteReason: null,
      approvalCase: {
        approvalNo: 'APR2604010001',
        status: ApprovalStatuses.APPROVED,
      },
    };

    prisma.auditEvidencePackage.findFirst.mockResolvedValue(targetRow);
    prisma.deleteRequest.findFirst.mockResolvedValue(null);
    prisma.deleteRequest.create.mockImplementation(async ({ data }: any) =>
      buildDeleteRequestRow({
        ...data,
        targetType: DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE,
        targetId: targetRow.id,
        targetNo: targetRow.packageNo,
        approvalNo: targetRow.approvalCase.approvalNo,
        approvalCase: null,
      }),
    );

    const result = await service.create(
      {
        targetType: DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE,
        targetNo: targetRow.packageNo,
        deleteReason: 'Package retention exception approved for cleanup',
        traceId: 'trace-1',
      },
      actor,
    );

    const expectedSnapshot = {
      targetType: DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE,
      targetId: targetRow.id,
      targetNo: targetRow.packageNo,
      status: targetRow.status,
      exportMode: targetRow.exportMode,
      itemCount: targetRow.itemCount,
      digest: targetRow.digest,
      approvalCaseId: targetRow.approvalCaseId,
      approvalNo: targetRow.approvalCase.approvalNo,
      approvalStatus: targetRow.approvalCase.status,
      createdAt: targetRow.createdAt,
      updatedAt: targetRow.updatedAt,
    };

    expect(prisma.auditEvidencePackage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          packageNo: targetRow.packageNo,
          deletedAt: null,
        },
      }),
    );
    expect(prisma.deleteRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetType: DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE,
          targetNo: targetRow.packageNo,
          approvalNo: targetRow.approvalCase.approvalNo,
          targetSnapshotJson: JSON.stringify(expectedSnapshot),
          targetSnapshotDigest: sha256Hex(expectedSnapshot),
        }),
      }),
    );
    expect(result).toMatchObject({
      targetType: DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE,
      targetNo: targetRow.packageNo,
      approvalNo: targetRow.approvalCase.approvalNo,
      targetSnapshotDigest: sha256Hex(expectedSnapshot),
    });
    expect(result.targetSnapshotJson).toMatchObject({
      ...expectedSnapshot,
      createdAt: expectedSnapshot.createdAt.toISOString(),
      updatedAt: expectedSnapshot.updatedAt.toISOString(),
    });
  });

  it.each([
    {
      name: 'change ticket',
      targetType: DeleteRequestTargetTypes.CHANGE_TICKET,
      targetNo: 'CT2604010001',
      expectedWorkflowType: AuditBusinessWorkflowTypes.CHANGE_TICKET_DELETION,
      setup(prisma: ReturnType<typeof buildService>['prisma']) {
        prisma.changeTicket.findFirst.mockResolvedValue({
          id: 'change-ticket-1',
          ticketNo: 'CT2604010001',
          status: ChangeTicketStatuses.DONE,
          changeType: 'ADMIN_ACCESS_CHANGE',
          approvalCaseId: 'approval-1',
          approvalNo: 'APR2604010001',
          traceId: 'trace-target-change-ticket',
          createdAt: new Date('2026-04-01T00:00:00.000Z'),
          updatedAt: new Date('2026-04-01T00:00:00.000Z'),
          deletedAt: null,
          deletedBy: null,
          deleteRequestId: null,
          deleteRequestNo: null,
          deleteReason: null,
        });
      },
    },
    {
      name: 'admin user',
      targetType: DeleteRequestTargetTypes.ADMIN_USER,
      targetNo: 'ADM-777',
      expectedWorkflowType: AuditBusinessWorkflowTypes.ADMIN_USER_DELETION,
      setup(prisma: ReturnType<typeof buildService>['prisma']) {
        prisma.user.findFirst.mockResolvedValue({
          id: 'admin-user-1',
          userNo: 'ADM-777',
          email: 'ops@example.com',
          status: 'ACTIVE',
          role: 'OPS_TREASURY',
          createdAt: new Date('2026-04-01T00:00:00.000Z'),
          updatedAt: new Date('2026-04-01T00:00:00.000Z'),
          deletedAt: null,
          deletedBy: null,
          deleteRequestId: null,
          deleteReason: null,
          userRoles: [],
        });
      },
    },
    {
      name: 'audit evidence package',
      targetType: DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE,
      targetNo: 'EVP-777',
      expectedWorkflowType: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_PACKAGE_DELETION,
      setup(prisma: ReturnType<typeof buildService>['prisma']) {
        prisma.auditEvidencePackage.findFirst.mockResolvedValue({
          id: 'evidence-package-1',
          packageNo: 'EVP-777',
          approvalCaseId: 'approval-1',
          status: 'READY',
          exportMode: 'SELECTED_EVENTS',
          itemCount: 3,
          digest: 'digest-1',
          createdAt: new Date('2026-04-01T00:00:00.000Z'),
          updatedAt: new Date('2026-04-01T00:00:00.000Z'),
          deletedAt: null,
          deletedBy: null,
          deleteRequestId: null,
          deleteReason: null,
          approvalCase: {
            approvalNo: 'APR2604010001',
            status: ApprovalStatuses.APPROVED,
          },
        });
      },
    },
  ])(
    'projects $name delete-request audit writes to $expectedWorkflowType',
    async ({ targetType, targetNo, expectedWorkflowType, setup }) => {
      const { service, prisma, auditLogsService } = buildService();
      setup(prisma);
      prisma.deleteRequest.findFirst.mockResolvedValue(null);
      prisma.deleteRequest.create.mockImplementation(async ({ data }: any) =>
        buildDeleteRequestRow({
          ...data,
          approvalCase: null,
        }),
      );

      const result = await service.create(
        {
          targetType,
          targetNo,
          deleteReason: 'cleanup closed record',
          traceId: 'trace-request-1',
        },
        actor,
      );

      const [auditPayload, auditActor] = getSingleAuditCall(auditLogsService);

      expect(auditPayload).toMatchObject({
        action: AuditActions.DELETE_REQUEST_CREATED,
        workflowType: expectedWorkflowType,
        workflowNo: result.requestNo,
        traceId: result.traceId,
      });
      expect(auditActor).toMatchObject({
        actorId: actor.userId,
        actorNo: actor.userNo,
      });
    },
  );

  it('creates delete requests with a fresh trace when dto.traceId is omitted', async () => {
    const { service, prisma } = buildService();
    const crypto = require('crypto');
    const randomUUIDSpy = jest.spyOn(crypto, 'randomUUID').mockReturnValue('generated-trace-1');
    const targetRow = {
      id: 'change-ticket-1',
      ticketNo: 'CT2604010001',
      status: ChangeTicketStatuses.DONE,
      changeType: 'ADMIN_ACCESS_CHANGE',
      approvalCaseId: 'approval-1',
      approvalNo: 'APR2604010001',
      traceId: 'trace-target-change-ticket',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      deletedAt: null,
      deletedBy: null,
      deleteRequestId: null,
      deleteRequestNo: null,
      deleteReason: null,
    };

    prisma.changeTicket.findFirst.mockResolvedValue(targetRow);
    prisma.deleteRequest.findFirst.mockResolvedValue(null);
    prisma.deleteRequest.create.mockImplementation(async ({ data }: any) =>
      buildDeleteRequestRow({
        ...data,
        approvalCase: null,
      }),
    );

    const result = await service.create(
      {
        targetType: DeleteRequestTargetTypes.CHANGE_TICKET,
        targetNo: 'CT2604010001',
        deleteReason: 'cleanup closed record',
      },
      actor,
    );

    expect(prisma.deleteRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          traceId: 'generated-trace-1',
        }),
      }),
    );
    expect(result.traceId).toBe('generated-trace-1');
    expect(result.traceId).not.toBe(targetRow.traceId);
    randomUUIDSpy.mockRestore();
  });

  it('creates delete requests with a fresh trace even when dto.traceId is provided', async () => {
    const { service, prisma } = buildService();
    const crypto = require('crypto');
    const randomUUIDSpy = jest.spyOn(crypto, 'randomUUID').mockReturnValue('generated-trace-2');
    const targetRow = {
      id: 'change-ticket-1',
      ticketNo: 'CT2604010001',
      status: ChangeTicketStatuses.DONE,
      changeType: 'ADMIN_ACCESS_CHANGE',
      approvalCaseId: 'approval-1',
      approvalNo: 'APR2604010001',
      traceId: 'trace-target-change-ticket',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      deletedAt: null,
      deletedBy: null,
      deleteRequestId: null,
      deleteRequestNo: null,
      deleteReason: null,
    };

    prisma.changeTicket.findFirst.mockResolvedValue(targetRow);
    prisma.deleteRequest.findFirst.mockResolvedValue(null);
    prisma.deleteRequest.create.mockImplementation(async ({ data }: any) =>
      buildDeleteRequestRow({
        ...data,
        approvalCase: null,
      }),
    );

    const result = await service.create(
      {
        targetType: DeleteRequestTargetTypes.CHANGE_TICKET,
        targetNo: 'CT2604010001',
        deleteReason: 'cleanup closed record',
        traceId: 'incoming-trace-should-be-ignored',
      },
      actor,
    );

    expect(prisma.deleteRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          traceId: 'generated-trace-2',
        }),
      }),
    );
    expect(result.traceId).toBe('generated-trace-2');
    expect(result.traceId).not.toBe('incoming-trace-should-be-ignored');
    expect(result.traceId).not.toBe(targetRow.traceId);
    randomUUIDSpy.mockRestore();
  });

  it('rejects submit when the incoming trace differs from the stored trace', async () => {
    const { service, prisma } = buildService();
    prisma.deleteRequest.findUnique.mockResolvedValue(
      buildDeleteRequestRow({
        status: DeleteRequestStatuses.DRAFT,
      }),
    );
    prisma.changeTicket.findUnique.mockResolvedValue({
      id: 'change-ticket-1',
      ticketNo: 'CT2604010001',
      status: ChangeTicketStatuses.DONE,
      changeType: 'ADMIN_ACCESS_CHANGE',
      approvalCaseId: null,
      approvalNo: null,
      traceId: 'trace-1',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      deletedAt: null,
      deletedBy: null,
      deleteRequestId: null,
      deleteRequestNo: null,
      deleteReason: null,
    });

    await expect(
      service.submit(
        'delete-request-1',
        { reason: 'submit now', traceId: 'trace-other' },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects cancel when the incoming trace differs from the stored trace', async () => {
    const { service, prisma } = buildService();
    prisma.deleteRequest.findUnique.mockResolvedValue(
      buildDeleteRequestRow({
        status: DeleteRequestStatuses.DRAFT,
      }),
    );

    await expect(
      service.cancel(
        'delete-request-1',
        { reason: 'cancel now', traceId: 'trace-other' },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects consume when the incoming trace differs from the stored trace', async () => {
    const { service, prisma } = buildService();
    prisma.deleteRequest.findUnique.mockResolvedValue(
      buildDeleteRequestRow({
        status: DeleteRequestStatuses.READY,
        approvalCaseId: 'approval-1',
        approvalNo: 'APR2604010001',
        approvalCase: buildApprovalCase({ status: ApprovalStatuses.APPROVED }),
      }),
    );

    await expect(
      service.consume(
        'delete-request-1',
        { reason: 'consume now', traceId: 'trace-other' },
        reviewer,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('includes requestNo, approvalNo, targetNo, and actor userNo in subjectNos', async () => {
    const { service, prisma, auditLogsService } = buildService();
    const targetRow = {
      id: 'evidence-package-1',
      packageNo: 'EVP-777',
      approvalCaseId: 'approval-1',
      status: 'READY',
      exportMode: 'SELECTED_EVENTS',
      itemCount: 3,
      digest: 'digest-1',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      deletedAt: null,
      deletedBy: null,
      deleteRequestId: null,
      deleteReason: null,
      approvalCase: {
        approvalNo: 'APR2604010001',
        status: ApprovalStatuses.APPROVED,
      },
    };

    prisma.auditEvidencePackage.findFirst.mockResolvedValue(targetRow);
    prisma.deleteRequest.findFirst.mockResolvedValue(null);
    prisma.deleteRequest.create.mockImplementation(async ({ data }: any) =>
      buildDeleteRequestRow({
        ...data,
        targetType: DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE,
        targetId: targetRow.id,
        targetNo: targetRow.packageNo,
        approvalNo: targetRow.approvalCase.approvalNo,
        approvalCase: null,
      }),
    );

    const result = await service.create(
      {
        targetType: DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE,
        targetNo: targetRow.packageNo,
        deleteReason: 'Package retention exception approved for cleanup',
        traceId: 'trace-request-1',
      },
      actor,
    );

    const [auditPayload] = getSingleAuditCall(auditLogsService);

    expect(auditPayload.subjectNos[0].subjectType).toBe(AuditEntityTypes.DELETE_REQUEST);
    expect(auditPayload.subjectNos).toEqual([
      {
        subjectRole: AuditSubjectRole.ENTITY,
        subjectType: AuditEntityTypes.DELETE_REQUEST,
        subjectId: result.id,
        subjectNo: result.requestNo,
      },
      {
        subjectRole: AuditSubjectRole.RELATED,
        subjectType: AuditEntityTypes.APPROVAL_CASE,
        subjectId: result.approvalCaseId || undefined,
        subjectNo: result.approvalNo as string,
      },
      {
        subjectRole: AuditSubjectRole.RELATED,
        subjectType: DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE,
        subjectId: result.targetId,
        subjectNo: result.targetNo,
      },
      {
        subjectRole: AuditSubjectRole.ACTOR,
        subjectType: actor.actorType,
        subjectId: actor.userId,
        subjectNo: actor.userNo,
      },
    ]);
  });

  it.each([
    [ApprovalStatuses.APPROVED, DeleteRequestStatuses.READY],
    [ApprovalStatuses.REJECTED, DeleteRequestStatuses.REJECTED],
    [ApprovalStatuses.EXPIRED, DeleteRequestStatuses.REJECTED],
    [ApprovalStatuses.CANCELLED, DeleteRequestStatuses.REJECTED],
  ])(
    'projects approval status %s to delete request status %s',
    async (approvalStatus, expectedStatus) => {
      const { service, prisma } = buildService();
      const request = buildDeleteRequestRow({
        status: DeleteRequestStatuses.PENDING_APPROVAL,
        approvalCaseId: 'approval-1',
        approvalNo: 'APR2604010001',
        approvalCase: buildApprovalCase(),
      });
      const projected = buildDeleteRequestRow({
        ...request,
        status: expectedStatus,
        approvalCase: buildApprovalCase({ status: approvalStatus }),
      });

      prisma.deleteRequest.findUnique.mockResolvedValue(request);
      prisma.deleteRequest.update.mockResolvedValue(projected);

      const result = await service.syncApprovalProjectionByEvent({
        approvalId: 'approval-1',
        approvalNo: 'APR2604010001',
        entityRef: 'delete-request-1',
        actionType: ApprovalActionTypes.DELETE_REQUEST_APPROVAL,
        status: approvalStatus,
      });

      expect(result).toMatchObject({ status: expectedStatus });
    },
  );

  it('consume success soft deletes the target change ticket', async () => {
    const { service, prisma, approvalsService } = buildService();
    const ready = buildDeleteRequestRow({
      status: DeleteRequestStatuses.READY,
      targetType: DeleteRequestTargetTypes.CHANGE_TICKET,
      targetId: 'change-ticket-1',
      targetNo: 'CT2604010001',
      approvalCaseId: 'approval-1',
      approvalNo: 'APR2604010001',
      approvalCase: buildApprovalCase({ status: ApprovalStatuses.APPROVED }),
    });
    let changeTicketUpdateArgs: Record<string, unknown> | undefined;

    prisma.deleteRequest.findUnique.mockResolvedValue(ready);
    prisma.changeTicket.findUnique.mockResolvedValue({
      id: 'change-ticket-1',
      ticketNo: 'CT2604010001',
      status: ChangeTicketStatuses.DONE,
      changeType: 'ADMIN_ACCESS_CHANGE',
      approvalCaseId: 'approval-1',
      approvalNo: 'APR2604010001',
      traceId: 'trace-1',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      deletedAt: null,
      deletedBy: null,
      deleteRequestId: null,
      deleteRequestNo: null,
      deleteReason: null,
    });
    approvalsService.requireApproved.mockResolvedValue(
      buildApprovalCase({ status: ApprovalStatuses.APPROVED }),
    );

    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        changeTicket: {
          update: jest.fn().mockImplementation(({ data }: any) => {
            changeTicketUpdateArgs = data;
            return Promise.resolve(undefined);
          }),
        },
        deleteRequest: {
          update: jest.fn().mockImplementation(({ data }: any) =>
            Promise.resolve(
              buildDeleteRequestRow({
                ...ready,
                ...data,
                status: DeleteRequestStatuses.DONE,
              }),
            ),
          ),
        },
      }),
    );

    const result = await service.consume(
      'delete-request-1',
      { reason: 'ticket removed', traceId: 'trace-1' },
      reviewer,
    );

    expect(changeTicketUpdateArgs).toMatchObject({
      deletedBy: reviewer.userId,
      deleteRequestId: ready.id,
      deleteRequestNo: ready.requestNo,
      deleteReason: ready.deleteReason,
    });
    expect(changeTicketUpdateArgs?.deletedAt).toBeInstanceOf(Date);
    expect(result).toMatchObject({
      status: DeleteRequestStatuses.DONE,
      consumedByUserId: reviewer.userId,
      consumedByUserNo: reviewer.userNo,
      resultNote: 'ticket removed',
    });
  });

  it('consume records delete-request consumed against the change-ticket deletion business workflow', async () => {
    const { service, prisma, approvalsService, auditLogsService } = buildService();
    const ready = buildDeleteRequestRow({
      status: DeleteRequestStatuses.READY,
      targetType: DeleteRequestTargetTypes.CHANGE_TICKET,
      targetId: 'change-ticket-1',
      targetNo: 'CT2604010001',
      approvalCaseId: 'approval-1',
      approvalNo: 'APR2604010001',
      approvalCase: buildApprovalCase({ status: ApprovalStatuses.APPROVED }),
    });

    prisma.deleteRequest.findUnique.mockResolvedValue(ready);
    prisma.changeTicket.findUnique.mockResolvedValue({
      id: 'change-ticket-1',
      ticketNo: 'CT2604010001',
      status: ChangeTicketStatuses.DONE,
      changeType: 'ADMIN_ACCESS_CHANGE',
      approvalCaseId: 'approval-1',
      approvalNo: 'APR2604010001',
      traceId: 'trace-1',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      deletedAt: null,
      deletedBy: null,
      deleteRequestId: null,
      deleteRequestNo: null,
      deleteReason: null,
    });
    approvalsService.requireApproved.mockResolvedValue(
      buildApprovalCase({ status: ApprovalStatuses.APPROVED }),
    );

    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        changeTicket: {
          update: jest.fn().mockResolvedValue(undefined),
        },
        deleteRequest: {
          update: jest.fn().mockImplementation(({ data }: any) =>
            Promise.resolve(
              buildDeleteRequestRow({
                ...ready,
                ...data,
                status: DeleteRequestStatuses.DONE,
              }),
            ),
          ),
        },
      }),
    );

    await service.consume(
      'delete-request-1',
      { reason: 'ticket removed', traceId: 'trace-1' },
      reviewer,
    );

    const [auditPayload, auditActor] = getSingleAuditCall(auditLogsService);

    expect(auditPayload).toMatchObject({
      action: AuditActions.DELETE_REQUEST_CONSUMED,
      workflowType: AuditBusinessWorkflowTypes.CHANGE_TICKET_DELETION,
      workflowNo: ready.requestNo,
      traceId: ready.traceId,
    });
    expect(auditActor).toMatchObject({
      actorId: reviewer.userId,
      actorNo: reviewer.userNo,
    });
  });

  it('consume success soft deletes the target evidence package', async () => {
    const { service, prisma, approvalsService } = buildService();
    const ready = buildDeleteRequestRow({
      status: DeleteRequestStatuses.READY,
      targetType: DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE,
      targetId: 'evidence-package-1',
      targetNo: 'EVP-777',
      approvalCaseId: 'approval-1',
      approvalNo: 'APR2604010001',
      approvalCase: buildApprovalCase({ status: ApprovalStatuses.APPROVED }),
    });
    let evidencePackageUpdateArgs: Record<string, unknown> | undefined;

    prisma.deleteRequest.findUnique.mockResolvedValue(ready);
    prisma.auditEvidencePackage.findUnique.mockResolvedValue({
      id: 'evidence-package-1',
      packageNo: 'EVP-777',
      approvalCaseId: 'approval-1',
      status: 'READY',
      exportMode: 'SELECTED_EVENTS',
      itemCount: 3,
      digest: 'digest-1',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      deletedAt: null,
      deletedBy: null,
      deleteRequestId: null,
      deleteReason: null,
      approvalCase: {
        approvalNo: 'APR2604010001',
        status: ApprovalStatuses.APPROVED,
      },
    });
    approvalsService.requireApproved.mockResolvedValue(
      buildApprovalCase({ status: ApprovalStatuses.APPROVED }),
    );

    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        auditEvidencePackage: {
          update: jest.fn().mockImplementation(({ data }: any) => {
            evidencePackageUpdateArgs = data;
            return Promise.resolve(undefined);
          }),
        },
        deleteRequest: {
          update: jest.fn().mockImplementation(({ data }: any) =>
            Promise.resolve(
              buildDeleteRequestRow({
                ...ready,
                ...data,
                status: DeleteRequestStatuses.DONE,
              }),
            ),
          ),
        },
      }),
    );

    const result = await service.consume(
      'delete-request-1',
      { reason: 'package removed', traceId: 'trace-1' },
      reviewer,
    );

    expect(evidencePackageUpdateArgs).toMatchObject({
      deletedBy: reviewer.userId,
      deleteRequestId: ready.id,
      deleteReason: ready.deleteReason,
    });
    expect(evidencePackageUpdateArgs?.deletedAt).toBeInstanceOf(Date);
    expect(result).toMatchObject({
      status: DeleteRequestStatuses.DONE,
      consumedByUserId: reviewer.userId,
      consumedByUserNo: reviewer.userNo,
      resultNote: 'package removed',
    });
  });

  it('consume marks the request DONE and records consumed fields on success', async () => {
    const { service, prisma, approvalsService } = buildService();
    const ready = buildDeleteRequestRow({
      status: DeleteRequestStatuses.READY,
      targetType: DeleteRequestTargetTypes.ADMIN_USER,
      targetId: 'admin-user-1',
      targetNo: 'ADM-777',
      approvalCaseId: 'approval-1',
      approvalNo: 'APR2604010001',
      approvalCase: buildApprovalCase({ status: ApprovalStatuses.APPROVED }),
    });
    let updateArgs: Record<string, unknown> | undefined;

    prisma.deleteRequest.findUnique.mockResolvedValue(ready);
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-user-1',
      userNo: 'ADM-777',
      email: 'ops@example.com',
      status: 'ACTIVE',
      role: 'OPS_TREASURY',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      deletedAt: null,
      deletedBy: null,
      deleteRequestId: null,
      deleteReason: null,
      userRoles: [],
    });
    approvalsService.requireApproved.mockResolvedValue(
      buildApprovalCase({ status: ApprovalStatuses.APPROVED }),
    );

    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        user: {
          update: jest.fn().mockResolvedValue(undefined),
        },
        adminUserInvitation: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        deleteRequest: {
          update: jest.fn().mockImplementation(({ data }: any) => {
            updateArgs = data;
            return Promise.resolve(
              buildDeleteRequestRow({
                ...ready,
                ...data,
                status: DeleteRequestStatuses.DONE,
              }),
            );
          }),
        },
      }),
    );

    const result = await service.consume(
      'delete-request-1',
      { reason: 'delete applied', traceId: 'trace-1' },
      reviewer,
    );

    expect(updateArgs).toMatchObject({
      status: DeleteRequestStatuses.DONE,
      consumedByUserId: reviewer.userId,
      consumedByUserNo: reviewer.userNo,
      resultNote: 'delete applied',
      targetSnapshotDigest: expect.any(String),
    });
    expect(updateArgs?.consumedAt).toBeInstanceOf(Date);
    expect(result).toMatchObject({
      status: DeleteRequestStatuses.DONE,
      consumedByUserId: reviewer.userId,
      consumedByUserNo: reviewer.userNo,
      resultNote: 'delete applied',
      targetSnapshotDigest: expect.any(String),
    });
  });

  it('consume marks the request FAILED when target deletion fails', async () => {
    const { service, prisma, approvalsService, auditLogsService } = buildService();
    const ready = buildDeleteRequestRow({
      status: DeleteRequestStatuses.READY,
      targetType: DeleteRequestTargetTypes.ADMIN_USER,
      targetId: 'admin-user-1',
      targetNo: 'ADM-777',
      approvalCaseId: 'approval-1',
      approvalNo: 'APR2604010001',
      approvalCase: buildApprovalCase({ status: ApprovalStatuses.APPROVED }),
    });

    prisma.deleteRequest.findUnique.mockResolvedValue(ready);
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-user-1',
      userNo: 'ADM-777',
      email: 'ops@example.com',
      status: 'ACTIVE',
      role: 'OPS_TREASURY',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      deletedAt: null,
      deletedBy: null,
      deleteRequestId: null,
      deleteReason: null,
      userRoles: [],
    });
    approvalsService.requireApproved.mockResolvedValue(
      buildApprovalCase({ status: ApprovalStatuses.APPROVED }),
    );
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        user: {
          update: jest.fn().mockRejectedValue(new Error('delete failed')),
        },
        adminUserInvitation: {
          updateMany: jest.fn(),
        },
        deleteRequest: {
          update: jest.fn(),
        },
      }),
    );
    prisma.deleteRequest.update.mockResolvedValue(
      buildDeleteRequestRow({
        ...ready,
        status: DeleteRequestStatuses.FAILED,
        consumedByUserId: reviewer.userId,
        consumedByUserNo: reviewer.userNo,
        resultNote: 'delete failed',
      }),
    );

    await expect(
      service.consume('delete-request-1', { reason: 'delete failed' }, reviewer),
    ).rejects.toThrow('delete failed');
    expect(prisma.deleteRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delete-request-1' },
        data: expect.objectContaining({
          status: DeleteRequestStatuses.FAILED,
          consumedByUserId: reviewer.userId,
          consumedByUserNo: reviewer.userNo,
          targetSnapshotDigest: expect.any(String),
        }),
      }),
    );
    const [auditPayload] = getSingleAuditCall(auditLogsService);
    expect(auditPayload.action).toBe(AuditActions.DELETE_REQUEST_EXECUTION_FAILED);
  });

  it('does not allow consuming a FAILED request again', async () => {
    const { service, prisma } = buildService();

    prisma.deleteRequest.findUnique.mockResolvedValue(
      buildDeleteRequestRow({
        status: DeleteRequestStatuses.FAILED,
        consumedByUserId: reviewer.userId,
        consumedByUserNo: reviewer.userNo,
      }),
    );

    await expect(
      service.consume('delete-request-1', { reason: 'retry' }, reviewer),
    ).rejects.toThrow(BadRequestException);
  });
});
