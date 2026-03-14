import { BadRequestException } from '@nestjs/common';
import { ChangeTicketsService } from './change-tickets.service';
import {
  ChangeTicketStatuses,
  ChangeTicketRiskLevels,
} from './constants/change-ticket.constants';
import {
  ApprovalActionTypes,
  ApprovalStatuses,
} from '../approvals/constants/approval.constants';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import { ChangeTicketEvents } from './constants/change-ticket.constants';

const baseDate = new Date('2026-03-14T12:00:00.000Z');

const buildTicket = (overrides: Record<string, unknown> = {}) => ({
  id: 'ticket-1',
  ticketNo: 'CT2603140001',
  status: ChangeTicketStatuses.DRAFT,
  changeType: 'SYSTEM',
  scopeSummary: 'Patch release',
  riskLevel: ChangeTicketRiskLevels.HIGH,
  testEvidenceRef: 'TEST-1',
  rollbackPlanRef: 'ROLLBACK-1',
  latestApprovalId: null,
  latestApprovalStatus: null,
  traceId: 'trace-1',
  emergency: false,
  emergencyReason: null,
  postApprovalDueAt: null,
  postApprovalCompletedAt: null,
  createdByUserId: 'maker-1',
  submittedByUserId: null,
  closedByUserId: null,
  submittedAt: null,
  deployedAt: null,
  closedAt: null,
  createdAt: baseDate,
  updatedAt: baseDate,
  latestApproval: null,
  ...overrides,
});

describe('ChangeTicketsService', () => {
  let prisma: any;
  let approvalsService: any;
  let auditLogsService: any;
  let eventEmitter: any;
  let service: ChangeTicketsService;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'tech-admin-1',
    userNo: 'ADM-001',
    role: 'TECH_ADMIN',
    roleCodes: ['TECH_ADMIN'],
  };

  beforeEach(() => {
    prisma = {
      changeTicket: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
      },
      changeTicketGateRun: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: any) => unknown) => cb(prisma)),
    };

    approvalsService = {
      createAndSubmit: jest.fn(),
      emitSubmittedSideEffects: jest.fn().mockResolvedValue(undefined),
    };

    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };

    eventEmitter = {
      emitAsync: jest.fn().mockResolvedValue([]),
      emit: jest.fn(),
    };

    service = new ChangeTicketsService(
      prisma,
      approvalsService,
      auditLogsService,
      eventEmitter,
    );
  });

  it('creates a change ticket with a generated ticketNo and audit record', async () => {
    prisma.changeTicket.create.mockResolvedValue(buildTicket());

    const result = await service.create(
      {
        changeType: 'SYSTEM',
        scopeSummary: 'Patch release',
        testEvidenceRef: 'TEST-1',
        rollbackPlanRef: 'ROLLBACK-1',
      },
      actor,
    );

    expect(result.ticketNo).toBe('CT2603140001');
    expect(prisma.changeTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ticketNo: expect.stringMatching(/^CT\d{10}$/),
          riskLevel: ChangeTicketRiskLevels.HIGH,
        }),
      }),
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.CHANGE_TICKET_CREATED,
        module: AuditModules.GOVERNANCE_CHANGE_TICKETS,
        entityType: AuditEntityTypes.CHANGE_TICKET,
        entityNo: 'CT2603140001',
      }),
      expect.anything(),
    );
  });

  it('submits a draft ticket, links approval, and emits approval side effects', async () => {
    prisma.changeTicket.findUnique
      .mockResolvedValueOnce(buildTicket())
      .mockResolvedValueOnce(buildTicket());
    prisma.changeTicket.update
      .mockResolvedValueOnce(
        buildTicket({
          status: ChangeTicketStatuses.SUBMITTED,
          submittedByUserId: actor.userId,
          submittedAt: baseDate,
        }),
      )
      .mockResolvedValueOnce(
        buildTicket({
          status: ChangeTicketStatuses.APPROVAL_PENDING,
          submittedByUserId: actor.userId,
          submittedAt: baseDate,
          latestApprovalId: 'approval-1',
          latestApprovalStatus: ApprovalStatuses.PENDING,
          latestApproval: {
            id: 'approval-1',
            approvalNo: 'APR2603140001',
            status: ApprovalStatuses.PENDING,
            traceId: 'trace-1',
          },
        }),
      );
    approvalsService.createAndSubmit.mockResolvedValue({
      id: 'approval-1',
      approvalNo: 'APR2603140001',
      status: ApprovalStatuses.PENDING,
    });

    const result = await service.submit('ticket-1', { reason: 'go live' }, actor);

    expect(result.status).toBe(ChangeTicketStatuses.APPROVAL_PENDING);
    expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: ApprovalActionTypes.CHANGE_TICKET_APPROVAL,
        entityRef: 'ticket-1',
      }),
      expect.anything(),
      actor,
      prisma,
      { emitSideEffects: false },
    );
    expect(approvalsService.emitSubmittedSideEffects).toHaveBeenCalledWith(
      'approval-1',
      actor,
      'go live',
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledTimes(2);
  });

  it('projects approved approval to READY_FOR_DEPLOY', async () => {
    prisma.changeTicket.findUnique.mockResolvedValue(
      buildTicket({
        status: ChangeTicketStatuses.APPROVAL_PENDING,
        latestApprovalId: 'approval-1',
        latestApprovalStatus: ApprovalStatuses.PENDING,
        latestApproval: {
          id: 'approval-1',
          approvalNo: 'APR2603140001',
          status: ApprovalStatuses.APPROVED,
          traceId: 'trace-1',
        },
      }),
    );
    prisma.changeTicket.update.mockResolvedValue(
      buildTicket({
        status: ChangeTicketStatuses.READY_FOR_DEPLOY,
        latestApprovalId: 'approval-1',
        latestApprovalStatus: ApprovalStatuses.APPROVED,
        latestApproval: {
          id: 'approval-1',
          approvalNo: 'APR2603140001',
          status: ApprovalStatuses.APPROVED,
          traceId: 'trace-1',
        },
      }),
    );

    const result = await service.syncApprovalProjectionByEvent({
      approvalId: 'approval-1',
      approvalNo: 'APR2603140001',
      entityRef: 'ticket-1',
      actionType: ApprovalActionTypes.CHANGE_TICKET_APPROVAL,
      status: ApprovalStatuses.APPROVED,
    });

    expect(result?.status).toBe(ChangeTicketStatuses.READY_FOR_DEPLOY);
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.CHANGE_TICKET_APPROVED,
        statusTo: ChangeTicketStatuses.READY_FOR_DEPLOY,
      }),
      expect.anything(),
    );
  });

  it('projects expired approval to REJECTED to avoid pending lock', async () => {
    prisma.changeTicket.findUnique.mockResolvedValue(
      buildTicket({
        status: ChangeTicketStatuses.APPROVAL_PENDING,
        latestApprovalId: 'approval-1',
        latestApprovalStatus: ApprovalStatuses.PENDING,
        latestApproval: {
          id: 'approval-1',
          approvalNo: 'APR2603140001',
          status: ApprovalStatuses.EXPIRED,
          traceId: 'trace-1',
        },
      }),
    );
    prisma.changeTicket.update.mockResolvedValue(
      buildTicket({
        status: ChangeTicketStatuses.REJECTED,
        latestApprovalId: 'approval-1',
        latestApprovalStatus: ApprovalStatuses.EXPIRED,
        latestApproval: {
          id: 'approval-1',
          approvalNo: 'APR2603140001',
          status: ApprovalStatuses.EXPIRED,
          traceId: 'trace-1',
        },
      }),
    );

    const result = await service.syncApprovalProjectionByEvent({
      approvalId: 'approval-1',
      approvalNo: 'APR2603140001',
      entityRef: 'ticket-1',
      actionType: ApprovalActionTypes.CHANGE_TICKET_APPROVAL,
      status: ApprovalStatuses.EXPIRED,
    });

    expect(result?.status).toBe(ChangeTicketStatuses.REJECTED);
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.CHANGE_TICKET_REJECTED,
        statusTo: ChangeTicketStatuses.REJECTED,
      }),
      expect.anything(),
    );
  });

  it('blocks close when ticket has not been deployed', async () => {
    prisma.changeTicket.findUnique.mockResolvedValue(buildTicket());

    await expect(service.close('ticket-1', {}, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('emits deploy-marked event after deploy status is recorded', async () => {
    prisma.changeTicket.findUnique.mockResolvedValue(
      buildTicket({
        status: ChangeTicketStatuses.READY_FOR_DEPLOY,
        latestApprovalStatus: ApprovalStatuses.APPROVED,
      }),
    );
    prisma.changeTicketGateRun.findFirst.mockResolvedValue({
      id: 'run-1',
      ticketId: 'ticket-1',
      targetEnv: 'PROD',
      releaseVersion: 'v1.0.0',
      status: 'PASSED',
      createdAt: baseDate,
    });
    prisma.changeTicket.update.mockResolvedValue(
      buildTicket({
        status: ChangeTicketStatuses.DEPLOYED,
        latestApprovalStatus: ApprovalStatuses.APPROVED,
        emergency: true,
        deployedAt: baseDate,
      }),
    );

    await service.markDeployStatus(
      'ticket-1',
      {
        targetEnv: 'PROD',
        releaseVersion: 'v1.0.0',
        deployStatus: 'DEPLOYED',
      },
      actor,
    );

    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      ChangeTicketEvents.DEPLOY_MARKED,
      expect.objectContaining({
        ticketId: 'ticket-1',
        ticketNo: 'CT2603140001',
        status: ChangeTicketStatuses.DEPLOYED,
      }),
    );
  });
});
