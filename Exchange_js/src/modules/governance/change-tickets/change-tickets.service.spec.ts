import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChangeTicketsService } from './change-tickets.service';
import { ApprovalActionTypes, ApprovalStatuses } from '../approvals/constants/approval.constants';
import { ChangeTicketStatuses, ChangeTicketTypes } from './constants/change-ticket.constants';
import {
  AuditActions,
  AuditBusinessWorkflowTypes,
  AuditWorkflowTypes,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import { sha256Hex } from '../../risk-engine/audit-logs/utils/audit-digest.util';
import { CHANGE_TICKET_CONSUMED } from './events/change-ticket-consumed.event';

const actor = {
  actorType: 'ADMIN' as const,
  userId: 'admin-1',
  userNo: 'ADM-001',
  role: 'TECH_OFFICER',
  roleCodes: ['TECH_OFFICER'],
};

const makeTicket = (overrides: Record<string, any> = {}) => ({
  id: 'ticket-1',
  ticketNo: 'CT2604020001',
  status: ChangeTicketStatuses.DRAFT,
  changeType: ChangeTicketTypes.ADMIN_ACCESS_CHANGE,
  changeReason: 'Emergency access change',
  scopeSummary: 'Rotate privileged access',
  riskLevel: 'HIGH',
  testEvidenceRef: 'TEST-1',
  rollbackPlanRef: 'ROLLBACK-1',
  bindingSnapshotJson: '{}',
  bindingDigest: null,
  approvalCaseId: null,
  approvalNo: null,
  traceId: 'trace-1',
  createdByUserId: 'creator-1',
  createdByUserNo: 'USR-001',
  submittedByUserId: null,
  submittedByUserNo: null,
  consumedByUserId: null,
  consumedByUserNo: null,
  submittedAt: null,
  consumedAt: null,
  resultNote: null,
  createdAt: new Date('2026-04-02T09:00:00.000Z'),
  updatedAt: new Date('2026-04-02T09:00:00.000Z'),
  deletedAt: null,
  approvalCase: null,
  ...overrides,
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const findAuditWrite = (mock: jest.Mock, action: string) =>
  mock.mock.calls
    .map(([event, actor]) => ({ event, actor }))
    .find(({ event }) => event.action === action);

describe('ChangeTicketsService Task 2', () => {
  let service: ChangeTicketsService;
  let prisma: any;
  let approvalsService: any;
  let auditLogsService: any;
  let eventEmitter: EventEmitter2;
  let ticket: any;

  beforeEach(() => {
    ticket = makeTicket();

    prisma = {
      changeTicket: {
        create: jest.fn(async ({ data }: any) => {
          ticket = {
            ...ticket,
            ...data,
          };
          return clone(ticket);
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id !== ticket.id || ticket.deletedAt) {
            return null;
          }
          return clone(ticket);
        }),
        update: jest.fn(async ({ where, data }: any) => {
          if (where.id !== ticket.id || ticket.deletedAt) {
            throw new Error(`Unexpected ticket id ${where.id}`);
          }
          ticket = {
            ...ticket,
            ...data,
            updatedAt: new Date('2026-04-02T10:00:00.000Z'),
            approvalCase:
              data.approvalCaseId || data.approvalNo
                ? {
                    id: data.approvalCaseId ?? ticket.approvalCaseId ?? 'apr-1',
                    approvalNo: data.approvalNo ?? ticket.approvalNo ?? 'APR-001',
                    status: ticket.approvalCase?.status ?? ApprovalStatuses.PENDING,
                    traceId: ticket.traceId,
                  }
                : ticket.approvalCase,
          };
          return clone(ticket);
        }),
      },
      $transaction: jest.fn(async (callback: (tx: any) => Promise<any>) => {
        const snapshot = clone(ticket);
        try {
          return await callback(prisma);
        } catch (error) {
          ticket = snapshot;
          throw error;
        }
      }),
    };

    approvalsService = {
      createAndSubmit: jest.fn(),
      emitSubmittedSideEffects: jest.fn(),
    };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };
    eventEmitter = {
      emit: jest.fn(),
      emitAsync: jest.fn().mockResolvedValue(undefined),
    } as unknown as EventEmitter2;

    service = new ChangeTicketsService(
      prisma,
      approvalsService,
      auditLogsService,
      eventEmitter,
    );
  });

  it('freezes bindingSnapshotJson and bindingDigest on create', async () => {
    const result = await service.create(
      {
        changeType: ChangeTicketTypes.ADMIN_ACCESS_CHANGE,
        changeReason: 'Emergency access change',
        scopeSummary: 'Rotate privileged access',
        testEvidenceRef: 'TEST-1',
        rollbackPlanRef: 'ROLLBACK-1',
        traceId: 'trace-1',
      },
      actor,
    );

    const expectedSnapshot = {
      ticketNo: ticket.ticketNo,
      changeType: ticket.changeType,
      changeReason: ticket.changeReason,
      scopeSummary: ticket.scopeSummary,
      testEvidenceRef: ticket.testEvidenceRef,
      rollbackPlanRef: ticket.rollbackPlanRef,
      traceId: ticket.traceId,
      createdByUserNo: actor.userNo,
    };

    expect(prisma.changeTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-1' },
        data: {
          bindingSnapshotJson: JSON.stringify(expectedSnapshot),
          bindingDigest: sha256Hex(expectedSnapshot),
        },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        bindingSnapshotJson: expectedSnapshot,
        bindingDigest: sha256Hex(expectedSnapshot),
      }),
    );
  });

  it('creates admin member provisioning tickets with ADMIN_ACCESS_CHANGE', async () => {
    const result = await service.createAdminMemberProvisioningTicket(
      {
        email: '  New-Admin@fiatx.com ',
        roleCodes: ['ciso', 'tech_admin'],
        changeReason: 'Need emergency admin coverage',
      },
      actor,
    );
    const expectedSnapshot = {
      ticketNo: result.ticketNo,
      changeType: ChangeTicketTypes.ADMIN_ACCESS_CHANGE,
      traceId: result.traceId,
      intent: 'ADMIN_MEMBER_PROVISIONING',
      email: 'new-admin@fiatx.com',
      roleCodes: ['CISO', 'TECH_OFFICER'],
      requestedByUserId: actor.userId,
      requestedByUserNo: actor.userNo,
      changeReason: 'Need emergency admin coverage',
      scopeSummary: 'Provision admin member new-admin@fiatx.com with roles CISO, TECH_ADMIN',
      testEvidenceRef: 'BUSINESS_PAGE_PROPOSAL',
      rollbackPlanRef: 'BUSINESS_PAGE_PROPOSAL',
    };

    expect(prisma.changeTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changeType: ChangeTicketTypes.ADMIN_ACCESS_CHANGE,
          changeReason: 'Need emergency admin coverage',
          scopeSummary: 'Provision admin member new-admin@fiatx.com with roles CISO, TECH_ADMIN',
          testEvidenceRef: 'BUSINESS_PAGE_PROPOSAL',
          rollbackPlanRef: 'BUSINESS_PAGE_PROPOSAL',
        }),
      }),
    );
    expect(prisma.changeTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-1' },
        data: expect.objectContaining({
          bindingSnapshotJson: JSON.stringify(expectedSnapshot),
          bindingDigest: sha256Hex(expectedSnapshot),
        }),
      }),
    );
    expect(result).toMatchObject({
      id: 'ticket-1',
      ticketNo: ticket.ticketNo,
      changeType: ChangeTicketTypes.ADMIN_ACCESS_CHANGE,
      bindingSnapshotJson: expectedSnapshot,
      bindingDigest: sha256Hex(expectedSnapshot),
    });
  });

  it('projects ADMIN_ACCESS_CHANGE audits to ADMIN_MEMBER_PROVISIONING', async () => {
    const result = await service.createAdminMemberProvisioningTicket(
      {
        email: '  New-Admin@fiatx.com ',
        roleCodes: ['ciso', 'tech_admin'],
        changeReason: 'Need emergency admin coverage',
      },
      actor,
    );

    const auditWrite = findAuditWrite(auditLogsService.recordByActor, AuditActions.CHANGE_TICKET_CREATED);

    expect(auditWrite).toBeDefined();
    expect(auditWrite?.event.workflowType).toBe(AuditBusinessWorkflowTypes.ADMIN_MEMBER_PROVISIONING);
    expect(auditWrite?.event.workflowType).not.toBe(AuditWorkflowTypes.CHANGE_TICKET);
    expect(auditWrite?.event.workflowNo).toBe(result.ticketNo);
    expect(auditWrite?.event.traceId).toBe(result.traceId);
    expect(auditWrite?.event.subjectNos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subjectNo: result.ticketNo }),
      ]),
    );
  });

  it.each(['', '   '])('rejects blank changeReason for admin member provisioning tickets', async (changeReason) => {
    await expect(
      service.createAdminMemberProvisioningTicket(
        {
          email: 'new-admin@fiatx.com',
          roleCodes: ['CISO'],
          changeReason,
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates admin role binding change tickets with RBAC_CATALOG_CHANGE', async () => {
    const targetUser = {
      id: 'user-123',
      userNo: 'USR-123',
      email: 'target@fiatx.com',
    };
    prisma.user = {
      findFirst: jest.fn(async () => targetUser),
    };

    const result = await service.createAdminRoleBindingChangeTicket(
      '  user-123  ',
      {
        roleCodes: ['dpo'],
        changeReason: 'Need DPO access',
      },
      actor,
    );
    const expectedSnapshot = {
      ticketNo: result.ticketNo,
      changeType: ChangeTicketTypes.RBAC_CATALOG_CHANGE,
      traceId: result.traceId,
      intent: 'ADMIN_ROLE_BINDING_CHANGE',
      targetUserId: targetUser.id,
      targetUserNo: targetUser.userNo,
      targetEmail: targetUser.email,
      roleCodes: ['DPO'],
      requestedByUserId: actor.userId,
      requestedByUserNo: actor.userNo,
      changeReason: 'Need DPO access',
      scopeSummary: 'Replace admin role bindings for user user-123 with roles DPO',
      testEvidenceRef: 'BUSINESS_PAGE_PROPOSAL',
      rollbackPlanRef: 'BUSINESS_PAGE_PROPOSAL',
    };

    expect(prisma.changeTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changeType: ChangeTicketTypes.RBAC_CATALOG_CHANGE,
          changeReason: 'Need DPO access',
          scopeSummary: 'Replace admin role bindings for user user-123 with roles DPO',
          testEvidenceRef: 'BUSINESS_PAGE_PROPOSAL',
          rollbackPlanRef: 'BUSINESS_PAGE_PROPOSAL',
        }),
      }),
    );
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'user-123',
          deletedAt: null,
        },
      }),
    );
    expect(prisma.changeTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-1' },
        data: expect.objectContaining({
          bindingSnapshotJson: JSON.stringify(expectedSnapshot),
          bindingDigest: sha256Hex(expectedSnapshot),
        }),
      }),
    );
    expect(result).toMatchObject({
      id: 'ticket-1',
      ticketNo: ticket.ticketNo,
      changeType: ChangeTicketTypes.RBAC_CATALOG_CHANGE,
      bindingSnapshotJson: expectedSnapshot,
      bindingDigest: sha256Hex(expectedSnapshot),
    });
  });

  it('projects RBAC_CATALOG_CHANGE audits to ADMIN_ROLE_BINDING_CHANGE and keeps target user anchors', async () => {
    const targetUser = {
      id: 'user-123',
      userNo: 'USR-123',
      email: 'target@fiatx.com',
    };
    prisma.user = {
      findFirst: jest.fn(async () => targetUser),
    };

    const result = await service.createAdminRoleBindingChangeTicket(
      '  user-123  ',
      {
        roleCodes: ['dpo'],
        changeReason: 'Need DPO access',
      },
      actor,
    );

    const auditWrite = findAuditWrite(auditLogsService.recordByActor, AuditActions.CHANGE_TICKET_CREATED);

    expect(auditWrite).toBeDefined();
    expect(auditWrite?.event.workflowType).toBe(AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE);
    expect(auditWrite?.event.workflowType).not.toBe(AuditWorkflowTypes.CHANGE_TICKET);
    expect(auditWrite?.event.workflowNo).toBe(result.ticketNo);
    expect(auditWrite?.event.traceId).toBe(result.traceId);
    expect(auditWrite?.event.subjectNos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subjectNo: result.ticketNo }),
        expect.objectContaining({ subjectNo: targetUser.userNo }),
      ]),
    );
  });

  it.each(['', '   '])('rejects blank changeReason for role binding change tickets', async (changeReason) => {
    prisma.user = {
      findFirst: jest.fn(async () => ({
        id: 'user-123',
        userNo: 'USR-123',
        email: 'target@fiatx.com',
      })),
    };

    await expect(
      service.createAdminRoleBindingChangeTicket(
        'user-123',
        {
          roleCodes: ['DPO'],
          changeReason,
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rolls back draft writes when snapshot persistence fails', async () => {
    const initialTicket = clone(ticket);
    prisma.changeTicket.update.mockImplementationOnce(async () => {
      throw new Error('snapshot write failed');
    });

    await expect(
      service.createAdminMemberProvisioningTicket(
        {
          email: 'new-admin@fiatx.com',
          roleCodes: ['CISO'],
          changeReason: 'Need emergency admin coverage',
        },
        actor,
      ),
    ).rejects.toThrow('snapshot write failed');

    expect(ticket).toEqual(initialTicket);
    expect(ticket.bindingSnapshotJson).toBe('{}');
    expect(ticket.bindingDigest).toBeNull();
    expect(prisma.changeTicket.create).toHaveBeenCalledTimes(1);
    expect(prisma.changeTicket.update).toHaveBeenCalledTimes(1);
  });

  it('projects approved approvals to READY', async () => {
    ticket = makeTicket({
      status: ChangeTicketStatuses.PENDING_APPROVAL,
      approvalCaseId: 'apr-1',
      approvalNo: 'APR-001',
      approvalCase: {
        id: 'apr-1',
        approvalNo: 'APR-001',
        status: ApprovalStatuses.PENDING,
        traceId: 'trace-1',
      },
    });

    const result = await service.syncApprovalProjectionByEvent({
      approvalId: 'apr-1',
      approvalNo: 'APR-001',
      entityRef: 'ticket-1',
      actionType: ApprovalActionTypes.CHANGE_TICKET_APPROVAL,
      status: ApprovalStatuses.APPROVED,
    });

    expect(prisma.changeTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-1' },
        data: expect.objectContaining({
          status: ChangeTicketStatuses.READY,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'ticket-1',
        status: ChangeTicketStatuses.READY,
        approvalCaseId: 'apr-1',
        approvalNo: 'APR-001',
      }),
    );
  });

  it.each([
    ApprovalStatuses.REJECTED,
    ApprovalStatuses.EXPIRED,
    ApprovalStatuses.CANCELLED,
  ])('projects %s approvals to REJECTED', async (approvalStatus) => {
    ticket = makeTicket({
      status: ChangeTicketStatuses.PENDING_APPROVAL,
      approvalCaseId: 'apr-1',
      approvalNo: 'APR-001',
      approvalCase: {
        id: 'apr-1',
        approvalNo: 'APR-001',
        status: ApprovalStatuses.PENDING,
        traceId: 'trace-1',
      },
    });

    const result = await service.syncApprovalProjectionByEvent({
      approvalId: 'apr-1',
      approvalNo: 'APR-001',
      entityRef: 'ticket-1',
      actionType: ApprovalActionTypes.CHANGE_TICKET_APPROVAL,
      status: approvalStatus,
    });

    expect(prisma.changeTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-1' },
        data: expect.objectContaining({
          status: ChangeTicketStatuses.REJECTED,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'ticket-1',
        status: ChangeTicketStatuses.REJECTED,
        approvalCaseId: 'apr-1',
        approvalNo: 'APR-001',
      }),
    );
  });

  it('submits directly to PENDING_APPROVAL and stores approval identifiers', async () => {
    approvalsService.createAndSubmit.mockResolvedValue({
      id: 'apr-1',
      approvalNo: 'APR-001',
      status: ApprovalStatuses.PENDING,
    });

    const result = await service.submit(
      'ticket-1',
      {
        reason: 'Need approval',
      },
      actor,
    );

    expect(approvalsService.createAndSubmit).toHaveBeenCalledTimes(1);
    expect(prisma.changeTicket.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-1' },
        data: expect.objectContaining({
          status: ChangeTicketStatuses.PENDING_APPROVAL,
          approvalCaseId: 'apr-1',
          approvalNo: 'APR-001',
          submittedByUserId: actor.userId,
          submittedByUserNo: actor.userNo,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: ChangeTicketStatuses.PENDING_APPROVAL,
        approvalCaseId: 'apr-1',
        approvalNo: 'APR-001',
        submittedByUserId: actor.userId,
        submittedByUserNo: actor.userNo,
      }),
    );
  });

  it('consume success dispatches admin member provisioning from frozen snapshot', async () => {
    const bindingSnapshot = {
      intent: 'ADMIN_MEMBER_PROVISIONING',
      email: 'new-admin@fiatx.com',
      roleCodes: ['CISO', 'TECH_OFFICER'],
      requestedByUserId: actor.userId,
      requestedByUserNo: actor.userNo,
      changeReason: 'Need emergency admin coverage',
    };
    ticket = makeTicket({
      status: ChangeTicketStatuses.READY,
      bindingSnapshotJson: JSON.stringify(bindingSnapshot),
      approvalCaseId: 'apr-1',
      approvalNo: 'APR-001',
      approvalCase: {
        id: 'apr-1',
        approvalNo: 'APR-001',
        status: ApprovalStatuses.APPROVED,
        traceId: 'trace-1',
      },
    });

    const result = await service.consume(
      'ticket-1',
      {
        success: true,
        note: 'Applied successfully',
      },
      actor,
    );

    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      CHANGE_TICKET_CONSUMED,
      expect.objectContaining({
        ticketId: 'ticket-1',
        binding: expect.objectContaining({
          intent: 'ADMIN_MEMBER_PROVISIONING',
          email: 'new-admin@fiatx.com',
          roleCodes: ['CISO', 'TECH_OFFICER'],
        }),
        actor: expect.objectContaining({ userId: actor.userId }),
      }),
    );
    expect(prisma.changeTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-1' },
        data: expect.objectContaining({
          status: ChangeTicketStatuses.DONE,
          consumedByUserId: actor.userId,
          consumedByUserNo: actor.userNo,
          resultNote: 'Applied successfully',
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: ChangeTicketStatuses.DONE,
        consumedByUserId: actor.userId,
        consumedByUserNo: actor.userNo,
        resultNote: 'Applied successfully',
      }),
    );
  });

  it('consume success dispatches governed role binding replacement from frozen snapshot', async () => {
    const bindingSnapshot = {
      intent: 'ADMIN_ROLE_BINDING_CHANGE',
      targetUserId: 'user-123',
      targetUserNo: 'USR-123',
      roleCodes: ['DPO'],
      requestedByUserId: actor.userId,
      requestedByUserNo: actor.userNo,
      changeReason: 'Need DPO access',
    };
    ticket = makeTicket({
      status: ChangeTicketStatuses.READY,
      changeType: ChangeTicketTypes.RBAC_CATALOG_CHANGE,
      bindingSnapshotJson: JSON.stringify(bindingSnapshot),
      approvalCaseId: 'apr-1',
      approvalNo: 'APR-001',
      approvalCase: {
        id: 'apr-1',
        approvalNo: 'APR-001',
        status: ApprovalStatuses.APPROVED,
        traceId: 'trace-1',
      },
    });

    const result = await service.consume(
      'ticket-1',
      {
        success: true,
        note: 'Applied successfully',
      },
      actor,
    );

    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      CHANGE_TICKET_CONSUMED,
      expect.objectContaining({
        ticketId: 'ticket-1',
        binding: expect.objectContaining({
          intent: 'ADMIN_ROLE_BINDING_CHANGE',
          targetUserId: 'user-123',
          roleCodes: ['DPO'],
        }),
        actor: expect.objectContaining({ userId: actor.userId }),
      }),
    );
    const auditWrite = findAuditWrite(auditLogsService.recordByActor, AuditActions.CHANGE_TICKET_CONSUMED);
    expect(auditWrite).toBeDefined();
    expect(auditWrite?.event.action).toBe(AuditActions.CHANGE_TICKET_CONSUMED);
    expect(auditWrite?.event.workflowType).toBe(AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE);
    expect(auditWrite?.event.workflowType).not.toBe(AuditWorkflowTypes.CHANGE_TICKET);
    expect(auditWrite?.event.workflowNo).toBe(ticket.ticketNo);
    expect(auditWrite?.event.traceId).toBe(ticket.traceId);
    expect(auditWrite?.event.subjectNos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subjectNo: ticket.ticketNo }),
        expect.objectContaining({ subjectNo: 'APR-001' }),
        expect.objectContaining({ subjectNo: 'USR-123' }),
      ]),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: ChangeTicketStatuses.DONE,
        consumedByUserId: actor.userId,
        consumedByUserNo: actor.userNo,
        resultNote: 'Applied successfully',
      }),
    );
  });

  it('consume failure moves READY ticket to FAILED', async () => {
    ticket = makeTicket({
      status: ChangeTicketStatuses.READY,
      approvalCaseId: 'apr-1',
      approvalNo: 'APR-001',
      approvalCase: {
        id: 'apr-1',
        approvalNo: 'APR-001',
        status: ApprovalStatuses.APPROVED,
        traceId: 'trace-1',
      },
    });

    const result = await service.consume(
      'ticket-1',
      {
        success: false,
        note: 'Automation failed',
      },
      actor,
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: ChangeTicketStatuses.FAILED,
        resultNote: 'Automation failed',
      }),
    );
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });

  it('rejects consuming a FAILED ticket because FAILED is terminal', async () => {
    ticket = makeTicket({
      status: ChangeTicketStatuses.FAILED,
      consumedByUserId: 'admin-0',
      consumedByUserNo: 'ADM-000',
      consumedAt: new Date('2026-04-02T09:30:00.000Z'),
      resultNote: 'Previous failure',
    });

    await expect(
      service.consume(
        'ticket-1',
        {
          success: true,
          note: 'Retry should not be allowed',
        },
        actor,
      ),
    ).rejects.toThrow(new BadRequestException('FAILED change tickets cannot be consumed again'));
    expect(prisma.changeTicket.update).not.toHaveBeenCalled();
  });
});
