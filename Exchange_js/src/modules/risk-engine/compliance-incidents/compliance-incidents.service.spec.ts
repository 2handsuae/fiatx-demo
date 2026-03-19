import { ConflictException } from '@nestjs/common';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ComplianceAlertsService } from '../compliance-alerts/compliance-alerts.service';
import { ComplianceAlertAction } from '../compliance-alerts/constants/compliance-alert-rules.constant';
import { ComplianceIncidentsService } from './compliance-incidents.service';
import {
  ComplianceCaseType,
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
    customerMain: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    complianceIncidentAlert: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    complianceIncidentEvent: {
      create: jest.fn(),
    },
    complianceIncidentDispositionRecord: {
      create: jest.fn(),
    },
    complianceIncidentReport: {
      create: jest.fn(),
      update: jest.fn(),
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
    caseType: ComplianceCaseType.ONBOARDING,
    stage: 'REVIEW_CDD',
    ruleCode: 'ONB_CDD_REVIEW_REQUIRED',
    status: ComplianceIncidentStatus.OPEN,
    severity: ComplianceIncidentSeverity.HIGH,
    title: 'Incident title',
    summary: 'Incident summary',
    primaryAlertId: 'alert-1',
    primaryAlertNo: 'ALT2602010001',
    customerId: 'customer-1',
    customerNo: 'CU0001',
    entityType: 'CDD_CASE',
    entityId: 'cdd-1',
    entityNo: 'CDD0001',
    sourceModule: 'identity/onboarding',
    sourceType: 'ONBOARDING_JOURNEY',
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
    freezeStatus: 'ACTIVE',
    frozenAt: null,
    freezeReason: null,
    reportStatus: 'NOT_REPORTED',
    reportRefNo: null,
    reportedAt: null,
    reportReason: null,
    reportedByUserId: null,
    reportedByUserNo: null,
    overdueMarkedAt: null,
    closureChecklist: null,
    lastActionById: 'admin-1',
    lastActionByNo: 'US0001',
    lastActionByRole: 'ADMIN',
    lastActionAt: new Date('2026-02-19T01:00:00.000Z'),
    metadata: null,
    retainedUntil: new Date('2034-02-19T00:00:00.000Z'),
    createdAt: new Date('2026-02-19T00:00:00.000Z'),
    updatedAt: new Date('2026-02-19T00:00:00.000Z'),
    reports: [],
    ...overrides,
  });

  const buildReport = (overrides: Record<string, unknown> = {}) => ({
    id: 'report-1',
    incidentId: 'inc-1',
    version: 1,
    isCurrent: true,
    status: 'DRAFT',
    workflow: 'ONBOARDING',
    stage: 'REVIEW_CDD',
    ruleCode: 'ONB_CDD_REVIEW_REQUIRED',
    factsSummary: 'facts',
    investigationScope: 'scope',
    evidenceSummary: 'evidence',
    containmentSummary: 'containment',
    analystConclusion: 'conclusion',
    recommendedActions: JSON.stringify(['FREEZE']),
    finalDispositionCode: 'RESTRICT',
    finalDispositionReason: 'high risk',
    linkedAlertSnapshot: '[]',
    decisionRecordSnapshot: '{}',
    providerResponseSnapshot: '{}',
    createdByUserId: 'admin-1',
    createdByUserNo: 'US0001',
    finalizedByUserId: null,
    finalizedByUserNo: null,
    finalizedAt: null,
    supersededAt: null,
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
      workflow: 'ONBOARDING',
      stage: 'REVIEW_CDD',
      rule: 'ONB_CDD_REVIEW_REQUIRED',
      ruleCode: 'ONB_CDD_REVIEW_REQUIRED',
      reasonCodes: ['CDD_REQUIRED'],
      severity: 'HIGH',
      status: 'ESCALATED',
      title: 'Alert title',
      sourceModule: 'identity/onboarding',
      sourceType: 'ONBOARDING_JOURNEY',
      sourceId: 'customer-1:journey-1',
      sourceNo: 'ONB-1',
      entityType: 'CDD_CASE',
      entityId: 'cdd-1',
      entityNo: 'CDD0001',
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
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'customer-1',
      restrictionStatus: 'CLEAR',
      restrictionCaseId: null,
      restrictionReason: null,
      restrictionSetAt: null,
      restrictionReleasedAt: null,
      complianceHoldStatus: 'ACTIVE',
      complianceHoldCaseId: null,
      complianceHoldReason: null,
      complianceHoldSetAt: null,
      complianceHoldReleasedAt: null,
    });
    prismaMock.customerMain.update.mockResolvedValue({ id: 'customer-1' });
    prismaMock.complianceIncidentDispositionRecord.create.mockResolvedValue({
      id: 'case-disp-1',
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

  it('should create new cases with CAS prefix and derived caseType', async () => {
    prismaMock.complianceIncidentAlert.findUnique.mockResolvedValue(null);
    prismaMock.complianceIncident.create.mockResolvedValue(
      buildIncident({ incidentNo: 'CAS2602010001' }),
    );
    prismaMock.complianceIncidentAlert.create.mockResolvedValue({ id: 'link-1' });
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-1' });

    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      caseNo: 'CAS2602010001',
      caseType: ComplianceCaseType.ONBOARDING,
      alerts: [],
      events: [],
    } as any);

    await service.createFromAlert(
      'alert-1',
      { reason: 'Escalate for investigation' },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
      },
    );

    const createArgs = prismaMock.complianceIncident.create.mock.calls[0][0];
    expect(createArgs.data.incidentNo).toMatch(/^CAS/);
    expect(createArgs.data.caseType).toBe(ComplianceCaseType.ONBOARDING);
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

  it('should prioritize primary alert recommendation over incident metadata snapshot', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue({
      ...buildIncident({
        metadata: JSON.stringify({
          recommendedDecisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'],
        }),
      }),
      alerts: [
        {
          incidentId: 'inc-1',
          alertId: 'alert-1',
          relationType: 'PRIMARY',
          linkedAt: new Date('2026-02-19T00:00:00.000Z'),
          linkedById: 'admin-1',
          linkedByNo: 'US0001',
          linkedByRole: 'SUPER_ADMIN',
          alert: {
            id: 'alert-1',
            alertNo: 'ALT2602010001',
            ruleCode: 'ONB_CDD_REVIEW_REQUIRED',
            stage: 'REVIEW_CDD',
            severity: 'HIGH',
            status: 'ASSIGNED',
            title: 'Onboarding review alert',
            sourceType: 'ONBOARDING_JOURNEY',
            sourceId: 'c1:ONB-1',
            sourceNo: 'ONB-1',
            decisionRecommendation: 'APPROVE',
            metadata: JSON.stringify({
              recommendedDecisions: ['APPROVE', 'REJECT'],
            }),
            dueAt: new Date('2026-02-20T00:00:00.000Z'),
            lastOccurredAt: new Date('2026-02-19T01:00:00.000Z'),
          },
        },
      ],
      events: [],
    });

    const result = await service.findOne('inc-1');

    expect(result.recommendedDecisions).toEqual(['APPROVE', 'REJECT']);
    expect(result.recommendedDecisions).not.toContain('REQUIRE_EDD');
  });

  it('should expose canonical case fields while keeping compatibility fields', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue({
      ...buildIncident({
        incidentNo: 'CAS2602010001',
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
        linkedCaseIds: '["cdd-1"]',
        decisionRecordIds: '["dr-1"]',
      }),
      alerts: [],
      events: [],
    });

    const result = await service.findOne('inc-1');

    expect(result.caseNo).toBe('CAS2602010001');
    expect(result.incidentNo).toBe('CAS2602010001');
    expect(result.assigneeUserId).toBe('admin-1');
    expect(result.ownerUserId).toBe('admin-1');
    expect(result.caseType).toBe(ComplianceCaseType.ONBOARDING);
    expect(result.linkedCaseIds).toEqual(['cdd-1']);
    expect(result.decisionRecordIds).toEqual(['dr-1']);
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

  it('should reject assigning incident to user without SUPER_ADMIN, COMPLIANCE_LEAD, or MLRO role', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({ status: ComplianceIncidentStatus.OPEN }),
    );
    prismaMock.user.findUnique.mockResolvedValue({
      userNo: 'US0008',
      role: 'RI',
      status: 'ACTIVE',
      userRoles: [{ role: { code: 'RI' } }],
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
    ).rejects.toThrow('SUPER_ADMIN, COMPLIANCE_LEAD, or MLRO');
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
        reports: [
          buildReport({
            status: 'FINALIZED',
            finalizedAt: new Date('2026-02-19T02:30:00.000Z'),
          }),
        ],
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
    ).rejects.toThrow('can execute action CLOSE');
  });

  it('should close linked alerts when closing incident', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        reports: [
          buildReport({
            status: 'FINALIZED',
            finalizedAt: new Date('2026-02-19T02:30:00.000Z'),
            finalDispositionCode: 'REPORT',
          }),
        ],
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

  it('should freeze customer when FREEZE action is applied', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
      }),
    );
    prismaMock.complianceIncident.update.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
        freezeStatus: 'FROZEN',
        freezeReason: 'compliance hold',
        frozenAt: new Date('2026-02-19T02:00:00.000Z'),
      }),
    );
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-1' });

    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      status: ComplianceIncidentStatus.ASSIGNED,
      freezeStatus: 'FROZEN',
      alerts: [],
      events: [],
    } as any);

    const result = await service.applyAction(
      'inc-1',
      {
        action: ComplianceIncidentAction.FREEZE,
        reason: 'compliance hold',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'SUPER_ADMIN',
      },
    );

    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'customer-1' },
        data: expect.objectContaining({
          complianceHoldStatus: 'FROZEN',
          complianceHoldCaseId: 'inc-1',
          complianceHoldReason: 'compliance hold',
        }),
      }),
    );
    expect(prismaMock.complianceIncident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          freezeStatus: 'FROZEN',
          freezeReason: 'compliance hold',
        }),
      }),
    );
    expect(result.freezeStatus).toBe('FROZEN');
  });

  it('should reject FREEZE when case has no customer binding', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.OPEN,
        customerId: null,
        customerNo: null,
      }),
    );

    await expect(
      service.applyAction(
        'inc-1',
        {
          action: ComplianceIncidentAction.FREEZE,
          reason: 'hold',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
        },
      ),
    ).rejects.toThrow('Only customer-bound cases support FREEZE');
  });

  it('should unfreeze customer when UNFREEZE action is applied', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
        freezeStatus: 'FROZEN',
        freezeReason: 'hold',
      }),
    );
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'customer-1',
      complianceHoldStatus: 'FROZEN',
      complianceHoldCaseId: 'inc-1',
      complianceHoldReason: 'hold',
      complianceHoldSetAt: new Date('2026-02-19T02:00:00.000Z'),
      complianceHoldReleasedAt: null,
    });
    prismaMock.complianceIncident.update.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
        freezeStatus: 'ACTIVE',
        freezeReason: null,
        frozenAt: null,
      }),
    );
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-1' });

    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      status: ComplianceIncidentStatus.ASSIGNED,
      freezeStatus: 'ACTIVE',
      alerts: [],
      events: [],
    } as any);

    const result = await service.applyAction(
      'inc-1',
      {
        action: ComplianceIncidentAction.UNFREEZE,
        reason: 'release hold',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'SUPER_ADMIN',
      },
    );

    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          complianceHoldStatus: 'ACTIVE',
          complianceHoldCaseId: null,
          complianceHoldReason: null,
        }),
      }),
    );
    expect(result.freezeStatus).toBe('ACTIVE');
  });

  it('should restrict customer when RESTRICT action is applied', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
      }),
    );
    prismaMock.complianceIncident.update.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
        currentDispositionCode: 'RESTRICT',
        currentDispositionReason: 'high risk customer restriction',
      }),
    );
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-1' });

    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      status: ComplianceIncidentStatus.ASSIGNED,
      currentDispositionCode: 'RESTRICT',
      alerts: [],
      events: [],
    } as any);

    await service.applyAction(
      'inc-1',
      {
        action: ComplianceIncidentAction.RESTRICT,
        reason: 'high risk customer restriction',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'SUPER_ADMIN',
      },
    );

    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'customer-1' },
        data: expect.objectContaining({
          restrictionStatus: 'RESTRICTED',
          restrictionCaseId: 'inc-1',
          restrictionReason: 'high risk customer restriction',
        }),
      }),
    );
    expect(prismaMock.complianceIncidentDispositionRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: 'inc-1',
          dispositionCode: 'RESTRICT',
        }),
      }),
    );
  });

  it('should unrestrict customer only when current case owns the restriction', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
      }),
    );
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'customer-1',
      restrictionStatus: 'RESTRICTED',
      restrictionCaseId: 'inc-1',
      restrictionReason: 'high risk customer restriction',
      restrictionSetAt: new Date('2026-02-19T02:00:00.000Z'),
      restrictionReleasedAt: null,
      complianceHoldStatus: 'ACTIVE',
      complianceHoldCaseId: null,
      complianceHoldReason: null,
      complianceHoldSetAt: null,
      complianceHoldReleasedAt: null,
    });
    prismaMock.complianceIncident.update.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
        currentDispositionCode: 'RESTRICT',
      }),
    );
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-1' });

    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      status: ComplianceIncidentStatus.ASSIGNED,
      currentDispositionCode: 'RESTRICT',
      alerts: [],
      events: [],
    } as any);

    await service.applyAction(
      'inc-1',
      {
        action: ComplianceIncidentAction.UNRESTRICT,
        reason: 'restriction cleared after review',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'SUPER_ADMIN',
      },
    );

    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'customer-1' },
        data: expect.objectContaining({
          restrictionStatus: 'CLEAR',
          restrictionCaseId: null,
          restrictionReason: null,
        }),
      }),
    );
  });

  it('should reject UNRESTRICT when another case owns the restriction', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
      }),
    );
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'customer-1',
      restrictionStatus: 'RESTRICTED',
      restrictionCaseId: 'inc-other',
      restrictionReason: 'high risk customer restriction',
      restrictionSetAt: new Date('2026-02-19T02:00:00.000Z'),
      restrictionReleasedAt: null,
      complianceHoldStatus: 'ACTIVE',
      complianceHoldCaseId: null,
      complianceHoldReason: null,
      complianceHoldSetAt: null,
      complianceHoldReleasedAt: null,
    });

    await expect(
      service.applyAction(
        'inc-1',
        {
          action: ComplianceIncidentAction.UNRESTRICT,
          reason: 'restriction cleared after review',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorNo: 'US0001',
          actorRole: 'SUPER_ADMIN',
        },
      ),
    ).rejects.toThrow('Customer customer-1 is restricted by another case inc-other');
  });

  it('should reject CLOSE when current case still owns an active restriction', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
        reports: [buildReport({ status: 'FINALIZED', finalizedAt: new Date('2026-02-19T02:30:00.000Z') })],
      }),
    );
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'customer-1',
      restrictionStatus: 'RESTRICTED',
      restrictionCaseId: 'inc-1',
      restrictionReason: 'high risk customer restriction',
      restrictionSetAt: new Date('2026-02-19T02:00:00.000Z'),
      restrictionReleasedAt: null,
      complianceHoldStatus: 'ACTIVE',
      complianceHoldCaseId: null,
      complianceHoldReason: null,
      complianceHoldSetAt: null,
      complianceHoldReleasedAt: null,
    });

    await expect(
      service.applyAction(
        'inc-1',
        {
          action: ComplianceIncidentAction.CLOSE,
          reason: 'investigation completed',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorNo: 'US0001',
          actorRole: 'SUPER_ADMIN',
        },
      ),
    ).rejects.toThrow('Case inc-1 must be unrestricted before it can be closed');
  });

  it('should create report record when REPORT action is applied', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
        reports: [buildReport({ status: 'FINALIZED', finalizedAt: new Date('2026-02-19T02:30:00.000Z') })],
      }),
    );
    prismaMock.complianceIncident.update.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
        reportStatus: 'REPORTED',
        reportRefNo: 'RPT2602010001',
        reportReason: 'file internal report',
        reportedByUserId: 'admin-1',
        reportedByUserNo: 'US0001',
        reportedAt: new Date('2026-02-19T03:00:00.000Z'),
      }),
    );
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-1' });

    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      status: ComplianceIncidentStatus.ASSIGNED,
      reportStatus: 'REPORTED',
      reportRefNo: 'RPT2602010001',
      alerts: [],
      events: [],
    } as any);

    const result = await service.applyAction(
      'inc-1',
      {
        action: ComplianceIncidentAction.REPORT,
        reason: 'file internal report',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'SUPER_ADMIN',
      },
    );

    expect(prismaMock.complianceIncident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reportStatus: 'REPORTED',
          reportReason: 'file internal report',
          reportedByUserId: 'admin-1',
          reportedByUserNo: 'US0001',
          reportRefNo: expect.stringMatching(/^RPT/),
        }),
      }),
    );
    expect(result.reportStatus).toBe('REPORTED');
  });

  it('should create version 1 report draft for new case report', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        alerts: [],
        reports: [],
      }),
    );
    prismaMock.complianceIncidentReport.create.mockResolvedValue(buildReport());
    prismaMock.complianceIncident.update.mockResolvedValue(buildIncident());
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-report-1' });
    jest.spyOn(service, 'getReport').mockResolvedValue({
      id: 'inc-1',
      currentReport: { id: 'report-1', version: 1, status: 'DRAFT' },
      reportHistory: [{ id: 'report-1', version: 1, status: 'DRAFT' }],
      reportLocked: false,
    } as any);

    const result = await service.saveReportDraft(
      'inc-1',
      {
        factsSummary: 'facts',
        investigationScope: 'scope',
        evidenceSummary: 'evidence',
        analystConclusion: 'conclusion',
        recommendedActions: 'FREEZE',
        finalDispositionCode: 'RESTRICT',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'SUPER_ADMIN',
      },
    );

    expect(prismaMock.complianceIncidentReport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: 'inc-1',
          version: 1,
          status: 'DRAFT',
          isCurrent: true,
        }),
      }),
    );
    expect(prismaMock.complianceIncident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resolutionSummary: 'conclusion',
          containmentSummary: 'containment',
          closureChecklist: expect.any(String),
        }),
      }),
    );
    expect(result.currentReport.version).toBe(1);
  });

  it('should create next draft version from finalized current report', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        reports: [
          buildReport({
            status: 'FINALIZED',
            finalizedAt: new Date('2026-02-19T02:00:00.000Z'),
          }),
        ],
      }),
    );
    prismaMock.complianceIncidentReport.update.mockResolvedValue(buildReport({
      id: 'report-1',
      version: 1,
      status: 'SUPERSEDED',
      isCurrent: false,
    }));
    prismaMock.complianceIncidentReport.create.mockResolvedValue(
      buildReport({ id: 'report-2', version: 2, status: 'DRAFT' }),
    );
    prismaMock.complianceIncident.update.mockResolvedValue(buildIncident());
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-report-2' });
    jest.spyOn(service, 'getReport').mockResolvedValue({
      id: 'inc-1',
      currentReport: { id: 'report-2', version: 2, status: 'DRAFT' },
      reportHistory: [
        { id: 'report-2', version: 2, status: 'DRAFT' },
        { id: 'report-1', version: 1, status: 'SUPERSEDED' },
      ],
      reportLocked: false,
    } as any);

    await service.saveReportDraft(
      'inc-1',
      {
        factsSummary: 'facts v2',
        investigationScope: 'scope v2',
        evidenceSummary: 'evidence v2',
        analystConclusion: 'conclusion v2',
        recommendedActions: 'REPORT',
        finalDispositionCode: 'REPORT',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'SUPER_ADMIN',
      },
    );

    expect(prismaMock.complianceIncidentReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'report-1' },
        data: expect.objectContaining({
          isCurrent: false,
          status: 'SUPERSEDED',
        }),
      }),
    );
    expect(prismaMock.complianceIncidentReport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 2,
          status: 'DRAFT',
          isCurrent: true,
        }),
      }),
    );
  });

  it('should finalize current draft report and sync current disposition', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        reports: [buildReport()],
      }),
    );
    prismaMock.complianceIncidentReport.update.mockResolvedValue(
      buildReport({
        status: 'FINALIZED',
        finalizedAt: new Date('2026-02-19T03:00:00.000Z'),
        finalizedByUserId: 'admin-1',
        finalizedByUserNo: 'US0001',
      }),
    );
    prismaMock.complianceIncidentDispositionRecord.create.mockResolvedValue({
      id: 'case-disp-finalized',
    });
    prismaMock.complianceIncident.update.mockResolvedValue(buildIncident());
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-report-finalized' });
    jest.spyOn(service, 'getReport').mockResolvedValue({
      id: 'inc-1',
      currentReport: { id: 'report-1', version: 1, status: 'FINALIZED' },
      reportHistory: [{ id: 'report-1', version: 1, status: 'FINALIZED' }],
      reportLocked: false,
    } as any);

    const result = await service.finalizeReport(
      'inc-1',
      {},
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'SUPER_ADMIN',
      },
    );

    expect(prismaMock.complianceIncidentDispositionRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dispositionCode: 'RESTRICT',
          source: 'CASE_REPORT_FINALIZED',
          sourceRefId: 'report-1',
        }),
      }),
    );
    expect(prismaMock.complianceIncident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentDispositionCode: 'RESTRICT',
          decision: 'RESTRICT',
        }),
      }),
    );
    expect(result.currentReport.status).toBe('FINALIZED');
  });

  it('should reject REPORT without finalized current report', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
        reports: [buildReport({ status: 'DRAFT' })],
      }),
    );

    await expect(
      service.applyAction(
        'inc-1',
        {
          action: ComplianceIncidentAction.REPORT,
          reason: 'file internal report',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorNo: 'US0001',
          actorRole: 'SUPER_ADMIN',
        },
      ),
    ).rejects.toThrow('requires a finalized case report before REPORT');
  });

  it('should reject CLOSE when explicit disposition conflicts with finalized report', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
        reports: [
          buildReport({
            status: 'FINALIZED',
            finalDispositionCode: 'REPORT',
            finalizedAt: new Date('2026-02-19T02:30:00.000Z'),
          }),
        ],
      }),
    );

    await expect(
      service.applyAction(
        'inc-1',
        {
          action: ComplianceIncidentAction.CLOSE,
          reason: 'close case',
          dispositionCode: 'RESTRICT',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorNo: 'US0001',
          actorRole: 'SUPER_ADMIN',
        },
      ),
    ).rejects.toThrow('does not match finalized report disposition');
  });

  it('should block CLOSE while case is frozen', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
        freezeStatus: 'FROZEN',
        reports: [
          buildReport({
            status: 'FINALIZED',
            finalizedAt: new Date('2026-02-19T02:30:00.000Z'),
          }),
        ],
      }),
    );

    await expect(
      service.applyAction(
        'inc-1',
        {
          action: ComplianceIncidentAction.CLOSE,
          reason: 'close after hold',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorRole: 'SUPER_ADMIN',
        },
      ),
    ).rejects.toThrow('must be unfrozen before it can be closed');
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
