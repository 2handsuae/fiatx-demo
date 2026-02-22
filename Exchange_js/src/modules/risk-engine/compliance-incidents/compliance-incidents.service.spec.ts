import { ConflictException } from '@nestjs/common';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ComplianceAlertsService } from '../compliance-alerts/compliance-alerts.service';
import { ComplianceAlertAction } from '../compliance-alerts/constants/compliance-alert-rules.constant';
import { ComplianceIncidentsService } from './compliance-incidents.service';
import {
  ComplianceIncidentAction,
  ComplianceIncidentSeverity,
  ComplianceIncidentStatus,
} from './constants/compliance-incident-rules.constant';

describe('ComplianceIncidentsService', () => {
  const prismaMock: any = {
    $transaction: jest.fn(),
    complianceIncident: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    complianceIncidentAlert: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    complianceIncidentEvent: {
      create: jest.fn(),
    },
    complianceAlert: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    complianceAlertEvent: {
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  const buildIncident = (overrides: Record<string, unknown> = {}) => ({
    id: 'inc-1',
    incidentNo: 'INC2602010001',
    status: ComplianceIncidentStatus.OPEN,
    severity: ComplianceIncidentSeverity.HIGH,
    title: 'Incident title',
    summary: 'Incident summary',
    primaryAlertId: 'alert-1',
    primaryAlertNo: 'ALT2602010001',
    customerId: 'customer-1',
    customerNo: 'CU0001',
    entityType: 'KYT_CASE',
    entityId: 'kyt-1',
    entityNo: 'KYT0001',
    sourceModule: 'risk-engine/transaction-compliance',
    sourceType: 'DEPOSIT',
    ownerUserId: null,
    ownerUserNo: null,
    assignedAt: null,
    alertCount: 1,
    firstAlertAt: new Date('2026-02-19T00:00:00.000Z'),
    lastAlertAt: new Date('2026-02-19T01:00:00.000Z'),
    dueAt: new Date('2026-02-20T00:00:00.000Z'),
    resolvedAt: null,
    closedAt: null,
    closeReason: null,
    decision: null,
    linkedCaseIds: null,
    decisionRecordIds: null,
    closureChecklist: null,
    lastActionById: 'admin-1',
    lastActionByNo: 'US0001',
    lastActionByRole: 'ADMIN',
    lastActionAt: new Date('2026-02-19T01:00:00.000Z'),
    metadata: null,
    retainedUntil: new Date('2034-02-19T00:00:00.000Z'),
    createdAt: new Date('2026-02-19T00:00:00.000Z'),
    updatedAt: new Date('2026-02-19T00:00:00.000Z'),
    ...overrides,
  });

  let service: ComplianceIncidentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
    jest.spyOn(AuditLogsService.prototype, 'recordByActor').mockResolvedValue({} as any);
    jest.spyOn(ComplianceAlertsService.prototype, 'applyAction').mockResolvedValue({
      id: 'alert-1',
      alertNo: 'ALT2602010001',
      severity: 'HIGH',
      status: 'ESCALATED',
      title: 'Alert title',
      sourceModule: 'risk-engine/transaction-compliance',
      sourceType: 'DEPOSIT',
      sourceId: 'dep-1',
      sourceNo: 'DP0001',
      entityType: 'KYT_CASE',
      entityId: 'kyt-1',
      entityNo: 'KYT0001',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      customerId: 'customer-1',
      customerNo: 'CU0001',
      firstOccurredAt: new Date('2026-02-19T00:00:00.000Z'),
      lastOccurredAt: new Date('2026-02-19T01:00:00.000Z'),
      dueAt: new Date('2026-02-20T00:00:00.000Z'),
      retainedUntil: new Date('2034-02-19T00:00:00.000Z'),
    } as any);
    prismaMock.user.findUnique.mockResolvedValue({
      userNo: 'US0001',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      userRoles: [{ role: { code: 'SUPER_ADMIN' } }],
    });

    service = new ComplianceIncidentsService(prismaMock);
  });

  it('should create incident from alert in one transaction', async () => {
    prismaMock.complianceIncidentAlert.findUnique.mockResolvedValue(null);
    prismaMock.complianceIncident.create.mockResolvedValue(buildIncident());
    prismaMock.complianceIncidentAlert.create.mockResolvedValue({ id: 'link-1' });
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-1' });

    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      incidentNo: 'INC2602010001',
      alerts: [],
      events: [],
    } as any);

    const result = await service.createFromAlert(
      'alert-1',
      { reason: 'Escalate for investigation' },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'ADMIN',
      },
    );

    expect(ComplianceAlertsService.prototype.applyAction).toHaveBeenCalledWith(
      'alert-1',
      expect.objectContaining({
        action: ComplianceAlertAction.ESCALATE,
      }),
      expect.objectContaining({ actorId: 'admin-1' }),
      expect.anything(),
    );
    expect(prismaMock.complianceIncident.create).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('inc-1');
  });

  it('should persist decision and recommended action fields when creating incident from alert', async () => {
    prismaMock.complianceIncidentAlert.findUnique.mockResolvedValue(null);
    prismaMock.complianceIncident.create.mockResolvedValue(buildIncident());
    prismaMock.complianceIncidentAlert.create.mockResolvedValue({ id: 'link-1' });
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-1' });

    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      incidentNo: 'INC2602010001',
      alerts: [],
      events: [],
    } as any);

    await service.createFromAlert(
      'alert-1',
      {
        reason: 'System escalation for mock high risk',
        decision: 'REVIEW',
        linkedCaseIds: ['cdd-1'],
        decisionRecordIds: ['dr-1'],
        recommendedActions: ['UPSERT_ALERT', 'ESCALATE_INCIDENT'],
      },
      {
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        actorNo: 'SYSTEM',
        actorRole: 'SYSTEM',
      },
    );

    const createArgs = prismaMock.complianceIncident.create.mock.calls[0][0];
    expect(createArgs.data.decision).toBe('REVIEW');
    expect(createArgs.data.linkedCaseIds).toBe('["cdd-1"]');
    expect(createArgs.data.decisionRecordIds).toBe('["dr-1"]');
    expect(JSON.parse(createArgs.data.metadata)).toEqual(
      expect.objectContaining({
        decision: 'REVIEW',
        linkedCaseIds: ['cdd-1'],
        decisionRecordIds: ['dr-1'],
        engineRecommendedActions: ['UPSERT_ALERT', 'ESCALATE_INCIDENT'],
      }),
    );
  });

  it('should reject createFromAlert when alert already linked', async () => {
    prismaMock.complianceIncidentAlert.findUnique.mockResolvedValue({
      incidentId: 'inc-existing',
    });

    await expect(
      service.createFromAlert(
        'alert-1',
        { reason: 'Escalate for investigation' },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
        },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('should require reason for CLOSE action', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({ status: ComplianceIncidentStatus.ASSIGNED }),
    );

    await expect(
      service.applyAction(
        'inc-1',
        {
          action: ComplianceIncidentAction.CLOSE,
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
        },
      ),
    ).rejects.toThrow('requires a reason');
  });

  it('should reject terminal status actions', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({ status: ComplianceIncidentStatus.CLOSED }),
    );

    await expect(
      service.applyAction(
        'inc-1',
        {
          action: ComplianceIncidentAction.ASSIGN,
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
        },
      ),
    ).rejects.toThrow('terminal status');
  });

  it('should assign incident to actor by default', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({ status: ComplianceIncidentStatus.OPEN }),
    );
    prismaMock.user.findUnique.mockResolvedValue({
      userNo: 'US0001',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      userRoles: [{ role: { code: 'SUPER_ADMIN' } }],
    });
    prismaMock.complianceIncident.update.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
      }),
    );

    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      status: ComplianceIncidentStatus.ASSIGNED,
      alerts: [],
      events: [],
    } as any);

    const result = await service.applyAction(
      'inc-1',
      {
        action: ComplianceIncidentAction.ASSIGN,
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
      },
    );

    expect(prismaMock.complianceIncident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ComplianceIncidentStatus.ASSIGNED,
          ownerUserId: 'admin-1',
          ownerUserNo: 'US0001',
        }),
      }),
    );
    expect(result.status).toBe(ComplianceIncidentStatus.ASSIGNED);
  });

  it('should reject assigning incident to user without SUPER_ADMIN or MLRO role', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({ status: ComplianceIncidentStatus.OPEN }),
    );
    prismaMock.user.findUnique.mockResolvedValue({
      userNo: 'US0008',
      role: 'ALERT_ANALYST',
      status: 'ACTIVE',
      userRoles: [{ role: { code: 'ALERT_ANALYST' } }],
    });

    await expect(
      service.applyAction(
        'inc-1',
        {
          action: ComplianceIncidentAction.ASSIGN,
          assigneeUserId: 'admin-8',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
        },
      ),
    ).rejects.toThrow('SUPER_ADMIN or MLRO');
  });

  it('should reject reassign in ASSIGNED when actor is not current assignee', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
      }),
    );

    await expect(
      service.applyAction(
        'inc-1',
        {
          action: ComplianceIncidentAction.ASSIGN,
          assigneeUserId: 'admin-2',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-9',
          actorNo: 'US0009',
          actorRole: 'MLRO',
        },
      ),
    ).rejects.toThrow('can reassign');
  });

  it('should allow assignee to reassign in ASSIGNED status', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
      }),
    );
    prismaMock.user.findUnique.mockResolvedValue({
      userNo: 'US0002',
      role: 'MLRO',
      status: 'ACTIVE',
      userRoles: [{ role: { code: 'MLRO' } }],
    });
    prismaMock.complianceIncident.update.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-2',
        ownerUserNo: 'US0002',
      }),
    );
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-1' });

    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      status: ComplianceIncidentStatus.ASSIGNED,
      ownerUserId: 'admin-2',
      ownerUserNo: 'US0002',
      alerts: [],
      events: [],
    } as any);

    const result = await service.applyAction(
      'inc-1',
      {
        action: ComplianceIncidentAction.ASSIGN,
        assigneeUserId: 'admin-2',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'SUPER_ADMIN',
      },
    );

    expect(result.status).toBe(ComplianceIncidentStatus.ASSIGNED);
    expect(prismaMock.complianceIncident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerUserId: 'admin-2',
          ownerUserNo: 'US0002',
        }),
      }),
    );
  });

  it('should reject close in ASSIGNED when actor is not current assignee', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
      }),
    );

    await expect(
      service.applyAction(
        'inc-1',
        {
          action: ComplianceIncidentAction.CLOSE,
          reason: 'close',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-9',
          actorNo: 'US0009',
          actorRole: 'MLRO',
        },
      ),
    ).rejects.toThrow('can close');
  });

  it('should close linked alerts when closing incident', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
      }),
    );
    prismaMock.complianceIncident.update.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.CLOSED,
        ownerUserId: 'admin-1',
      }),
    );
    prismaMock.complianceAlert.findMany.mockResolvedValue([
      { id: 'alert-1', status: 'ASSIGNED' },
      { id: 'alert-2', status: 'ESCALATED' },
    ]);
    prismaMock.complianceAlert.update.mockResolvedValue({});
    prismaMock.complianceAlertEvent.create.mockResolvedValue({});
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-1' });

    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      status: ComplianceIncidentStatus.CLOSED,
      alerts: [],
      events: [],
    } as any);

    const result = await service.applyAction(
      'inc-1',
      {
        action: ComplianceIncidentAction.CLOSE,
        reason: 'investigation completed',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorRole: 'SUPER_ADMIN',
      },
    );

    expect(prismaMock.complianceAlert.findMany).toHaveBeenCalled();
    expect(prismaMock.complianceAlert.update).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(ComplianceIncidentStatus.CLOSED);
  });

  it('should reject duplicate linked alert', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({ status: ComplianceIncidentStatus.ASSIGNED }),
    );
    prismaMock.complianceIncidentAlert.findUnique.mockResolvedValue({
      incidentId: 'inc-2',
    });

    await expect(
      service.linkAlert(
        'inc-1',
        { alertId: 'alert-2' },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
        },
      ),
    ).rejects.toThrow(ConflictException);
  });
});
