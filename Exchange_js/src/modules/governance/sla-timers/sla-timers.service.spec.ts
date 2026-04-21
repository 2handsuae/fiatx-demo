import { SlaTimersService } from './sla-timers.service';
import {
  ApprovalStatuses,
  ApprovalActionTypes,
} from '../approvals/constants/approval.constants';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import {
  SlaNotificationStatuses,
  SlaNotificationTypes,
  SlaTimerStatuses,
  SlaTimerTypes,
} from './constants/sla-timer.constants';

const baseDate = new Date('2026-03-14T16:00:00.000Z');

const buildTimer = (overrides: Record<string, unknown> = {}) => ({
  id: 'timer-1',
  timerNo: 'TM2603140001',
  workflowType: AuditWorkflowTypes.APPROVAL,
  workflowId: 'approval-1',
  workflowNo: 'APR2603140001',
  subjectType: AuditEntityTypes.APPROVAL_CASE,
  subjectId: 'approval-1',
  subjectNo: 'APR2603140001',
  timerType: SlaTimerTypes.APPROVAL_TIMEOUT,
  ownerUserId: 'maker-1',
  status: SlaTimerStatuses.ACTIVE,
  dueAt: new Date('2026-03-14T17:00:00.000Z'),
  graceSeconds: 120,
  traceId: 'trace-1',
  contextJson: '{}',
  closedAt: null,
  expiredAt: null,
  activeKey: 'APPROVAL|APPROVAL_CASE|approval-1|APPROVAL_TIMEOUT',
  createdAt: baseDate,
  updatedAt: baseDate,
  ...overrides,
});

const buildNotification = (overrides: Record<string, unknown> = {}) => ({
  id: 'notification-1',
  timerId: 'timer-1',
  notificationType: SlaNotificationTypes.DUE_REMINDER,
  status: SlaNotificationStatuses.SCHEDULED,
  scheduledAt: new Date('2026-03-14T17:00:00.000Z'),
  triggeredAt: null,
  reasonCode: 'DUE_REMINDER_REGISTERED',
  message: 'SLA due reminder scheduled',
  metadataJson: '{}',
  createdAt: baseDate,
  updatedAt: baseDate,
  ...overrides,
});

describe('SlaTimersService', () => {
  let prisma: any;
  let auditLogsService: any;
  let approvalsService: any;
  let service: SlaTimersService;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'tech-admin-1',
    userNo: 'ADM-001',
    role: 'TECH_OFFICER',
    roleCodes: ['TECH_OFFICER'],
  };

  beforeEach(() => {
    prisma = {
      slaTimer: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      slaNotification: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      approvalCase: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      changeTicket: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: any) => unknown) => cb(prisma)),
    };

    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };

    approvalsService = {
      expirePendingApprovalCase: jest.fn().mockResolvedValue({ id: 'approval-1' }),
    };

    service = new SlaTimersService(prisma, auditLogsService, approvalsService);
  });

  it('creates approval timeout timer with generated timerNo', async () => {
    prisma.approvalCase.findUnique.mockResolvedValue({
      id: 'approval-1',
      approvalNo: 'APR2603140001',
      actionType: ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
      entityRef: 'pkg-1',
      createdByUserId: 'maker-1',
      status: ApprovalStatuses.PENDING,
      timeoutAt: new Date('2026-03-14T17:00:00.000Z'),
      traceId: 'trace-1',
      deletedAt: null,
    });
    prisma.slaTimer.findFirst.mockResolvedValue(null);
    prisma.slaTimer.create.mockResolvedValue(buildTimer());
    prisma.slaNotification.findFirst.mockResolvedValue(null);
    prisma.slaNotification.create.mockResolvedValue(buildNotification());
    prisma.slaNotification.findMany.mockResolvedValue([buildNotification()]);

    const result = await service.ensureApprovalTimeoutTimer('approval-1');

    expect(result?.timerNo).toBe('TM2603140001');
    expect(prisma.slaTimer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          timerNo: expect.stringMatching(/^TM\d{10}$/),
          timerType: SlaTimerTypes.APPROVAL_TIMEOUT,
          workflowNo: 'APR2603140001',
        }),
      }),
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.SLA_TIMER_CREATED,
        module: AuditModules.GOVERNANCE_SLA_TIMERS,
        entityType: AuditEntityTypes.SLA_TIMER,
      }),
      expect.anything(),
    );
  });

  it('closes active approval timeout timer when approval is resolved', async () => {
    prisma.slaTimer.findFirst.mockResolvedValue(buildTimer());
    prisma.slaNotification.findMany
      .mockResolvedValueOnce([buildNotification()])
      .mockResolvedValueOnce([
        buildNotification({
          status: SlaNotificationStatuses.SKIPPED,
          triggeredAt: baseDate,
        }),
      ]);
    prisma.slaNotification.update.mockResolvedValue(
      buildNotification({
        status: SlaNotificationStatuses.SKIPPED,
        triggeredAt: baseDate,
      }),
    );
    prisma.slaTimer.update.mockResolvedValue(
      buildTimer({
        status: SlaTimerStatuses.CLOSED,
        closedAt: baseDate,
        activeKey: null,
      }),
    );

    const result = await service.closeApprovalTimeoutTimer('approval-1', 'Approval approved');

    expect(result?.status).toBe(SlaTimerStatuses.CLOSED);
    expect(prisma.slaTimer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SlaTimerStatuses.CLOSED,
          activeKey: null,
        }),
      }),
    );
  });

  it('expires overdue approval timeout timers and pushes approval to EXPIRED', async () => {
    prisma.slaTimer.findMany.mockResolvedValue([
      buildTimer({
        dueAt: new Date('2026-03-14T15:00:00.000Z'),
        graceSeconds: 120,
      }),
    ]);
    prisma.approvalCase.findUnique.mockResolvedValue({
      id: 'approval-1',
      status: ApprovalStatuses.PENDING,
      deletedAt: null,
    });
    prisma.slaNotification.findFirst
      .mockResolvedValueOnce(buildNotification())
      .mockResolvedValueOnce(null);
    prisma.slaNotification.update.mockResolvedValue(
      buildNotification({
        status: SlaNotificationStatuses.TRIGGERED,
        triggeredAt: baseDate,
      }),
    );
    prisma.slaNotification.create.mockResolvedValue(
      buildNotification({
        id: 'notification-2',
        notificationType: SlaNotificationTypes.EXPIRE_MARK,
        status: SlaNotificationStatuses.TRIGGERED,
        triggeredAt: baseDate,
      }),
    );
    prisma.slaNotification.findMany.mockResolvedValue([
      buildNotification({
        status: SlaNotificationStatuses.TRIGGERED,
        triggeredAt: baseDate,
      }),
      buildNotification({
        id: 'notification-2',
        notificationType: SlaNotificationTypes.EXPIRE_MARK,
        status: SlaNotificationStatuses.TRIGGERED,
        triggeredAt: baseDate,
      }),
    ]);
    prisma.slaTimer.update.mockResolvedValue(
      buildTimer({
        status: SlaTimerStatuses.EXPIRED,
        expiredAt: baseDate,
        activeKey: null,
      }),
    );

    const result = await service.expireDueTimers();

    expect(result.expiredCount).toBe(1);
    expect(approvalsService.expirePendingApprovalCase).toHaveBeenCalledWith('approval-1');
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.SLA_TIMER_EXPIRED,
        statusTo: SlaTimerStatuses.EXPIRED,
      }),
      expect.anything(),
    );
  });

  it('does not create change follow-up timers under the minimal change-ticket workflow', async () => {
    const result = await service.ensureChangePostApprovalFollowUpTimer('ticket-1');

    expect(result).toBeNull();
    expect(prisma.changeTicket.findUnique).not.toHaveBeenCalled();
    expect(prisma.slaTimer.create).not.toHaveBeenCalled();
  });

  it('closes active follow-up timer without writing back to change ticket', async () => {
    prisma.slaTimer.findUnique.mockResolvedValue(
      buildTimer({
        workflowType: 'CHANGE_TICKET',
        workflowId: 'ticket-1',
        workflowNo: 'CT2603140001',
        subjectType: 'CHANGE_TICKET',
        subjectId: 'ticket-1',
        subjectNo: 'CT2603140001',
        timerType: SlaTimerTypes.CHANGE_POST_APPROVAL_FOLLOWUP,
        traceId: 'trace-ticket-1',
        activeKey: 'CHANGE_TICKET|CHANGE_TICKET|ticket-1|CHANGE_POST_APPROVAL_FOLLOWUP',
      }),
    );
    prisma.slaNotification.findMany
      .mockResolvedValueOnce([buildNotification({ timerId: 'timer-1' })])
      .mockResolvedValueOnce([
        buildNotification({
          timerId: 'timer-1',
          status: SlaNotificationStatuses.SKIPPED,
          triggeredAt: baseDate,
        }),
      ]);
    prisma.slaNotification.update.mockResolvedValue(
      buildNotification({
        timerId: 'timer-1',
        status: SlaNotificationStatuses.SKIPPED,
        triggeredAt: baseDate,
      }),
    );
    prisma.slaTimer.update.mockResolvedValue(
      buildTimer({
        workflowType: 'CHANGE_TICKET',
        workflowId: 'ticket-1',
        workflowNo: 'CT2603140001',
        subjectType: 'CHANGE_TICKET',
        subjectId: 'ticket-1',
        subjectNo: 'CT2603140001',
        timerType: SlaTimerTypes.CHANGE_POST_APPROVAL_FOLLOWUP,
        traceId: 'trace-ticket-1',
        status: SlaTimerStatuses.CLOSED,
        closedAt: baseDate,
        activeKey: null,
      }),
    );

    const result = await service.close('timer-1', { reason: 'done' }, actor);

    expect(result.status).toBe(SlaTimerStatuses.CLOSED);
    expect(prisma.changeTicket.update).not.toHaveBeenCalled();
    expect(prisma.changeTicket.findUnique).not.toHaveBeenCalled();
  });

  it('recalculates existing change follow-up timer without querying change-ticket workflow fields', async () => {
    const nextDueAt = new Date('2026-03-14T18:00:00.000Z');
    prisma.slaTimer.findUnique.mockResolvedValue(
      buildTimer({
        workflowType: 'CHANGE_TICKET',
        workflowId: 'ticket-1',
        workflowNo: 'CT2603140001',
        subjectType: 'CHANGE_TICKET',
        subjectId: 'ticket-1',
        subjectNo: 'CT2603140001',
        timerType: SlaTimerTypes.CHANGE_POST_APPROVAL_FOLLOWUP,
        traceId: 'trace-ticket-1',
        activeKey: 'CHANGE_TICKET|CHANGE_TICKET|ticket-1|CHANGE_POST_APPROVAL_FOLLOWUP',
        contextJson: JSON.stringify({
          ticketNo: 'CT2603140001',
        }),
        notifications: [buildNotification()],
      }),
    );
    prisma.slaTimer.update.mockResolvedValue(
      buildTimer({
        workflowType: 'CHANGE_TICKET',
        workflowId: 'ticket-1',
        workflowNo: 'CT2603140001',
        subjectType: 'CHANGE_TICKET',
        subjectId: 'ticket-1',
        subjectNo: 'CT2603140001',
        timerType: SlaTimerTypes.CHANGE_POST_APPROVAL_FOLLOWUP,
        traceId: 'trace-ticket-1',
        dueAt: nextDueAt,
        graceSeconds: 90,
      }),
    );
    prisma.slaNotification.findFirst.mockResolvedValue(buildNotification());
    prisma.slaNotification.update.mockResolvedValue(
      buildNotification({
        scheduledAt: nextDueAt,
        status: SlaNotificationStatuses.SCHEDULED,
      }),
    );
    prisma.slaNotification.findMany.mockResolvedValue([
      buildNotification({
        scheduledAt: nextDueAt,
        status: SlaNotificationStatuses.SCHEDULED,
      }),
    ]);

    const result = await service.recalc(
      'timer-1',
      {
        dueAt: nextDueAt.toISOString(),
        graceSeconds: 90,
        reason: 'minimal change follow-up recalc',
      },
      actor,
    );

    expect(result.status).toBe(SlaTimerStatuses.ACTIVE);
    expect(prisma.changeTicket.findUnique).not.toHaveBeenCalled();
    expect(prisma.changeTicket.update).not.toHaveBeenCalled();
    expect(prisma.slaTimer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'timer-1' },
        data: expect.objectContaining({
          dueAt: nextDueAt,
          graceSeconds: 90,
        }),
      }),
    );
  });

  it('expires existing change follow-up timers without querying change-ticket workflow fields', async () => {
    prisma.slaTimer.findMany.mockResolvedValue([
      buildTimer({
        workflowType: 'CHANGE_TICKET',
        workflowId: 'ticket-1',
        workflowNo: 'CT2603140001',
        subjectType: 'CHANGE_TICKET',
        subjectId: 'ticket-1',
        subjectNo: 'CT2603140001',
        timerType: SlaTimerTypes.CHANGE_POST_APPROVAL_FOLLOWUP,
        traceId: 'trace-ticket-1',
        dueAt: new Date('2026-03-14T15:00:00.000Z'),
        graceSeconds: 120,
        activeKey: 'CHANGE_TICKET|CHANGE_TICKET|ticket-1|CHANGE_POST_APPROVAL_FOLLOWUP',
      }),
    ]);
    prisma.slaNotification.findFirst
      .mockResolvedValueOnce(buildNotification())
      .mockResolvedValueOnce(null);
    prisma.slaNotification.update.mockResolvedValue(
      buildNotification({
        status: SlaNotificationStatuses.TRIGGERED,
        triggeredAt: baseDate,
      }),
    );
    prisma.slaNotification.create.mockResolvedValue(
      buildNotification({
        id: 'notification-2',
        notificationType: SlaNotificationTypes.EXPIRE_MARK,
        status: SlaNotificationStatuses.TRIGGERED,
        triggeredAt: baseDate,
      }),
    );
    prisma.slaNotification.findMany.mockResolvedValue([
      buildNotification({
        status: SlaNotificationStatuses.TRIGGERED,
        triggeredAt: baseDate,
      }),
      buildNotification({
        id: 'notification-2',
        notificationType: SlaNotificationTypes.EXPIRE_MARK,
        status: SlaNotificationStatuses.TRIGGERED,
        triggeredAt: baseDate,
      }),
    ]);
    prisma.slaTimer.update.mockResolvedValue(
      buildTimer({
        workflowType: 'CHANGE_TICKET',
        workflowId: 'ticket-1',
        workflowNo: 'CT2603140001',
        subjectType: 'CHANGE_TICKET',
        subjectId: 'ticket-1',
        subjectNo: 'CT2603140001',
        timerType: SlaTimerTypes.CHANGE_POST_APPROVAL_FOLLOWUP,
        traceId: 'trace-ticket-1',
        status: SlaTimerStatuses.EXPIRED,
        expiredAt: baseDate,
        activeKey: null,
      }),
    );

    const result = await service.expireDueTimers();

    expect(result.expiredCount).toBe(1);
    expect(prisma.changeTicket.findUnique).not.toHaveBeenCalled();
    expect(prisma.slaTimer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SlaTimerStatuses.EXPIRED,
          activeKey: null,
        }),
      }),
    );
  });

  it('recalculates approval timeout timer and reschedules the due reminder', async () => {
    prisma.slaTimer.findUnique.mockResolvedValue(
      buildTimer({
        notifications: [buildNotification()],
      }),
    );
    prisma.approvalCase.findUnique.mockResolvedValue({
      id: 'approval-1',
      approvalNo: 'APR2603140001',
      timeoutAt: new Date('2026-03-14T17:00:00.000Z'),
      deletedAt: null,
    });
    prisma.approvalCase.update.mockResolvedValue({
      id: 'approval-1',
      timeoutAt: new Date('2026-03-14T17:00:30.000Z'),
    });
    prisma.slaTimer.update.mockResolvedValue(
      buildTimer({
        dueAt: new Date('2026-03-14T17:00:30.000Z'),
        graceSeconds: 30,
      }),
    );
    prisma.slaNotification.findFirst.mockResolvedValue(buildNotification());
    prisma.slaNotification.update.mockResolvedValue(
      buildNotification({
        scheduledAt: new Date('2026-03-14T17:00:30.000Z'),
        status: SlaNotificationStatuses.SCHEDULED,
      }),
    );
    prisma.slaNotification.findMany.mockResolvedValue([
      buildNotification({
        scheduledAt: new Date('2026-03-14T17:00:30.000Z'),
        status: SlaNotificationStatuses.SCHEDULED,
      }),
    ]);

    const result = await service.recalc(
      'timer-1',
      {
        dueInSeconds: 30,
        graceSeconds: 30,
        reason: 'demo recalc',
      },
      actor,
    );

    expect(result.status).toBe(SlaTimerStatuses.ACTIVE);
    expect(prisma.approvalCase.update).toHaveBeenCalled();
    expect(prisma.slaNotification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SlaNotificationStatuses.SCHEDULED,
        }),
      }),
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.SLA_TIMER_RECALCULATED,
      }),
      expect.anything(),
    );
  });
});
