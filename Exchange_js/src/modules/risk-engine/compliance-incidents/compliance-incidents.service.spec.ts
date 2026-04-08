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
    complianceIncidentExternalFiling: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    complianceIncidentExternalFilingEvent: {
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
  const workflowTransitionServiceMock: any = {
    transition: jest.fn(),
  };
  const onboardingFinalApprovalServiceMock: any = {
    ensurePendingApprovalInTransaction: jest.fn(),
    emitSubmittedSideEffects: jest.fn(),
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
    proposedFilingRequired: null,
    proposedFilingType: null,
    proposedFilingAuthority: null,
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
    filings: [],
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
    finalDispositionCode: 'RISK_CONFIRMED',
    finalDispositionReason: 'high risk',
    filingRequired: false,
    filingType: null,
    filingAuthority: null,
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
    prismaMock.complianceAlert.findMany.mockResolvedValue([]);
    prismaMock.complianceAlert.update.mockResolvedValue({ id: 'alert-1' });
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
    prismaMock.complianceIncidentExternalFiling.findUnique.mockResolvedValue(null);
    prismaMock.complianceIncidentExternalFiling.create.mockResolvedValue({
      id: 'filing-1',
    });
    prismaMock.complianceIncidentExternalFiling.update.mockResolvedValue({
      id: 'filing-1',
    });
    prismaMock.complianceIncidentExternalFilingEvent.create.mockResolvedValue({
      id: 'filing-evt-1',
    });
    onboardingFinalApprovalServiceMock.ensurePendingApprovalInTransaction.mockResolvedValue({
      approval: {
        id: 'approval-1',
        approvalNo: 'APR2602010001',
        status: 'PENDING',
      },
      created: true,
      auditAction: 'FINAL_APPROVAL_SUBMITTED',
    });
    onboardingFinalApprovalServiceMock.emitSubmittedSideEffects.mockResolvedValue(
      undefined,
    );

    service = new ComplianceIncidentsService(
      prismaMock,
      workflowTransitionServiceMock,
      onboardingFinalApprovalServiceMock,
    );
  });

  it('should create incident from alert in one transaction', async () => {
    const recordByActorSpy = jest.spyOn(AuditLogsService.prototype, 'recordByActor');
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
    expect(recordByActorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'ONBOARDING:ONB-1',
        workflowType: 'ONBOARDING',
      }),
      expect.anything(),
      expect.anything(),
    );
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

  it('should create TRANSACTION case from transaction review alert', async () => {
    (
      ComplianceAlertsService.prototype.applyAction as jest.Mock
    ).mockResolvedValueOnce({
      id: 'alert-tx-1',
      alertNo: 'ALT2603010009',
      workflow: 'TRANSACTION',
      stage: 'REVIEW_KYT',
      rule: 'TX_KYT_REVIEW_REQUIRED',
      ruleCode: 'TX_KYT_REVIEW_REQUIRED',
      reasonCodes: ['TX_KYT_FAIL'],
      severity: 'CRITICAL',
      status: 'ESCALATED',
      title: 'Transaction KYT Review Required',
      sourceModule: 'risk-engine/transaction-compliance',
      sourceType: 'DEPOSIT',
      sourceId: 'dep-1',
      sourceNo: 'DEP-1',
      entityType: 'KYT_CASE',
      entityId: 'kyt-1',
      entityNo: 'KYT0001',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      customerId: 'customer-1',
      customerNo: 'CU0001',
      firstOccurredAt: new Date('2026-03-24T00:00:00.000Z'),
      lastOccurredAt: new Date('2026-03-24T00:05:00.000Z'),
      dueAt: new Date('2026-03-25T00:00:00.000Z'),
      retainedUntil: new Date('2034-03-24T00:00:00.000Z'),
      metadata: {
        contextType: 'TX_DEPOSIT_KYT_MAIN',
        recommendedActions: ['UPSERT_ALERT', 'AUTO_ESCALATE_CASE'],
      },
    });
    prismaMock.complianceIncidentAlert.findUnique.mockResolvedValue(null);
    prismaMock.complianceIncident.create.mockResolvedValue(
      buildIncident({
        caseType: ComplianceCaseType.TRANSACTION,
        stage: 'REVIEW_KYT',
        ruleCode: 'TX_KYT_REVIEW_REQUIRED',
        sourceModule: 'risk-engine/transaction-compliance',
        sourceType: 'DEPOSIT',
        entityType: 'KYT_CASE',
        entityId: 'kyt-1',
        entityNo: 'KYT0001',
      }),
    );
    prismaMock.complianceIncidentAlert.create.mockResolvedValue({ id: 'link-tx-1' });
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-tx-1' });

    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-tx-1',
      incidentNo: 'CAS2603010001',
      caseType: ComplianceCaseType.TRANSACTION,
      alerts: [],
      events: [],
    } as any);

    await service.createFromAlert(
      'alert-tx-1',
      { reason: 'System escalation for failed deposit KYT' },
      {
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        actorNo: 'SYSTEM',
        actorRole: 'SYSTEM',
      },
    );

    const createArgs =
      prismaMock.complianceIncident.create.mock.calls[
        prismaMock.complianceIncident.create.mock.calls.length - 1
      ][0];
    expect(createArgs.data.caseType).toBe(ComplianceCaseType.TRANSACTION);
    expect(createArgs.data.sourceType).toBe('DEPOSIT');
    expect(createArgs.data.stage).toBe('REVIEW_KYT');
    expect(createArgs.data.ruleCode).toBe('TX_KYT_REVIEW_REQUIRED');
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
          recommendedDecisions: ['CLEAR', 'REJECT', 'REQUIRE_EDD'],
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
            decisionRecommendation: 'CLEAR',
            metadata: JSON.stringify({
              recommendedDecisions: ['CLEAR', 'REJECT'],
            }),
            dueAt: new Date('2026-02-20T00:00:00.000Z'),
            lastOccurredAt: new Date('2026-02-19T01:00:00.000Z'),
          },
        },
      ],
      events: [],
    });

    const result = await service.findOne('inc-1');

    expect(result.recommendedDecisions).toEqual(['CLEAR', 'REJECT']);
    expect(result.recommendedDecisions).not.toContain('REQUIRE_EDD');
  });

  it('should expose canonical case fields only on the active read model', async () => {
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
    expect(result.assigneeUserId).toBe('admin-1');
    expect(result.caseType).toBe(ComplianceCaseType.ONBOARDING);
    expect(result.linkedCaseIds).toEqual(['cdd-1']);
    expect(result.decisionRecordIds).toEqual(['dr-1']);
    expect(result).not.toHaveProperty('incidentNo');
    expect(result).not.toHaveProperty('ownerUserId');
  });

  it('should query cases by canonical caseNo and assigneeUserId fields', async () => {
    prismaMock.complianceIncident.count.mockResolvedValue(0);
    prismaMock.complianceIncident.findMany.mockResolvedValue([]);

    await service.findAll({
      caseNo: 'CAS2602010001',
      assigneeUserId: 'admin-canonical',
    });

    expect(prismaMock.complianceIncident.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        incidentNo: { contains: 'CAS2602010001' },
        ownerUserId: 'admin-canonical',
      }),
    });
    expect(prismaMock.complianceIncident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          incidentNo: { contains: 'CAS2602010001' },
          ownerUserId: 'admin-canonical',
        }),
      }),
    );
  });

  it('should expose Phase 11 case/interim/workflow action groups', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue({
      ...buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
      }),
      alerts: [],
      events: [],
      dispositionRecords: [],
      reports: [],
    });

    const result = await service.findOne('inc-1');

    expect(result.availableCaseActions).toEqual([
      'REASSIGN',
      'LINK_ALERT',
    ]);
    expect(result.availableInterimMeasures).toEqual(['RESTRICT', 'FREEZE']);
    expect(result.availableWorkflowActions).toEqual([
      'CLEAR',
      'REJECT',
      'REQUIRE_EDD',
    ]);
    expect((result as any).availableWorkItemActions).toBeUndefined();
    expect((result as any).availableComplianceActions).toBeUndefined();
  });

  it('should reject generic CLOSE in Phase 12', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({ status: ComplianceIncidentStatus.ASSIGNED }),
    );

    await expect(
      service.applyAction(
        'inc-1',
        {
          action: 'CLOSE' as any,
          reason: 'close',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
        },
      ),
    ).rejects.toThrow('Generic CLOSE is no longer supported');
  });

  it('should reject CLOSE before action validation in Phase 12', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        caseType: ComplianceCaseType.GENERIC,
      }),
    );

    await expect(
      service.applyAction(
        'inc-1',
        {
          action: 'CLOSE' as any,
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
        },
      ),
    ).rejects.toThrow('Generic CLOSE is no longer supported');
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

  it('should reject assigning incident to user without SUPER_ADMIN, COMPLIANCE_OFFICER, or MLRO role', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({ status: ComplianceIncidentStatus.OPEN }),
    );
    prismaMock.user.findUnique.mockResolvedValue({
      userNo: 'US0008',
      role: 'SENIOR_MANAGEMENT_OFFICER',
      status: 'ACTIVE',
      userRoles: [{ role: { code: 'SENIOR_MANAGEMENT_OFFICER' } }],
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
    ).rejects.toThrow('SUPER_ADMIN, COMPLIANCE_OFFICER, or MLRO');
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

  it('should allow repair assignment when case is ASSIGNED but assignee is missing', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        ownerUserId: null,
        ownerUserNo: null,
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
      assigneeUserId: 'admin-2',
      assigneeUserNo: 'US0002',
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
        actorId: 'admin-9',
        actorNo: 'US0009',
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

  it('should reject CLOSE even before assignee ownership checks in Phase 12', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.ASSIGNED,
        caseType: ComplianceCaseType.GENERIC,
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
          action: 'CLOSE' as any,
          reason: 'close',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-9',
          actorNo: 'US0009',
          actorRole: 'MLRO',
        },
      ),
    ).rejects.toThrow('Generic CLOSE is no longer supported');
  });

  it('should reject CLOSE direct path and require MLRO gate instead', async () => {
    await expect(
      service.applyAction(
        'inc-1',
        {
          action: 'CLOSE' as any,
          reason: 'investigation completed',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorRole: 'SUPER_ADMIN',
        },
      ),
    ).rejects.toThrow('Generic CLOSE is no longer supported');
  });

  it('should reject direct FALSE_POSITIVE case action in Phase 12', async () => {
    await expect(
      service.applyAction(
        'inc-1',
        {
          action: 'FALSE_POSITIVE' as any,
          reason: 'false positive hit',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorNo: 'US0001',
          actorRole: 'SUPER_ADMIN',
        },
      ),
    ).rejects.toThrow('FALSE_POSITIVE is no longer a direct case action');
  });

  it('should reject actions on legacy withdraw precheck cases', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        id: 'inc-wd-pre-1',
        caseType: ComplianceCaseType.TRANSACTION,
        sourceModule: 'risk-engine/transaction-compliance',
        sourceType: 'WITHDRAW',
        entityType: 'WITHDRAW_TRANSACTION',
        entityId: 'wd-legacy-1',
        entityNo: 'WD-LEGACY-1',
        stage: 'REVIEW_WITHDRAW_PRECHECK',
        ruleCode: 'TX_WITHDRAW_PRECHECK_REVIEW_REQUIRED',
        status: ComplianceIncidentStatus.OPEN,
      }),
    );

    await expect(
      service.applyAction(
        'inc-wd-pre-1',
        {
          action: ComplianceIncidentAction.ASSIGN,
          assigneeUserId: 'admin-1',
        } as any,
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorNo: 'US0001',
          actorRole: 'COMPLIANCE_OFFICER',
          sourcePlatform: 'ADMIN_API',
        },
      ),
    ).rejects.toThrow('historical read-only');
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
        status: ComplianceIncidentStatus.INVESTIGATING,
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
      status: ComplianceIncidentStatus.INVESTIGATING,
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
          status: ComplianceIncidentStatus.INVESTIGATING,
          freezeStatus: 'FROZEN',
          freezeReason: 'compliance hold',
        }),
      }),
    );
    expect(result.freezeStatus).toBe('FROZEN');
    expect(result.status).toBe(ComplianceIncidentStatus.INVESTIGATING);
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
        caseType: ComplianceCaseType.GENERIC,
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
        status: ComplianceIncidentStatus.INVESTIGATING,
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
      status: ComplianceIncidentStatus.INVESTIGATING,
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
    expect(result.status).toBe(ComplianceIncidentStatus.INVESTIGATING);
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
        status: ComplianceIncidentStatus.INVESTIGATING,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
        currentDispositionCode: 'RESTRICT',
        currentDispositionReason: 'high risk customer restriction',
      }),
    );
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-1' });

    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      status: ComplianceIncidentStatus.INVESTIGATING,
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
          dispositionCode: 'RISK_CONFIRMED',
        }),
      }),
    );
    expect(prismaMock.complianceIncident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ComplianceIncidentStatus.INVESTIGATING,
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
        status: ComplianceIncidentStatus.INVESTIGATING,
        ownerUserId: 'admin-1',
        ownerUserNo: 'US0001',
        currentDispositionCode: 'RESTRICT',
      }),
    );
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-1' });

    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      status: ComplianceIncidentStatus.INVESTIGATING,
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

  it('should reject CLOSE direct path before restriction ownership checks in Phase 12', async () => {
    await expect(
      service.applyAction(
        'inc-1',
        {
          action: 'CLOSE' as any,
          reason: 'investigation completed',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorNo: 'US0001',
          actorRole: 'SUPER_ADMIN',
        },
      ),
    ).rejects.toThrow('Generic CLOSE is no longer supported');
  });

  it('should reject direct REPORT case action in Phase 12', async () => {
    await expect(
      service.applyAction(
        'inc-1',
        {
          action: 'REPORT' as any,
          reason: 'file internal report',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorNo: 'US0001',
          actorRole: 'SUPER_ADMIN',
        },
      ),
    ).rejects.toThrow('REPORT is no longer a direct case action');
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
        finalDispositionCode: 'RISK_CONFIRMED',
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
        recommendedActions: 'ESCALATE',
        finalDispositionCode: 'RISK_CONFIRMED',
        filingRequired: true,
        filingType: 'SUSPICIOUS_ACTIVITY',
        filingAuthority: 'FIU',
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

  it('should finalize current draft report without syncing effective disposition', async () => {
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

    expect(prismaMock.complianceIncidentDispositionRecord.create).not.toHaveBeenCalled();
    expect(prismaMock.complianceIncident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastActionById: 'admin-1',
          lastActionByNo: 'US0001',
        }),
      }),
    );
    expect(result.currentReport.status).toBe('FINALIZED');
  });

  it('should reject REPORT direct action regardless of report state in Phase 12', async () => {
    await expect(
      service.applyAction(
        'inc-1',
        {
          action: 'REPORT' as any,
          reason: 'file internal report',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorNo: 'US0001',
          actorRole: 'SUPER_ADMIN',
        },
      ),
    ).rejects.toThrow('REPORT is no longer a direct case action');
  });

  it('should reject CLOSE direct action even when explicit disposition is provided', async () => {
    await expect(
      service.applyAction(
        'inc-1',
        {
          action: 'CLOSE' as any,
          reason: 'close case',
          dispositionCode: 'RISK_CONFIRMED',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorNo: 'US0001',
          actorRole: 'SUPER_ADMIN',
        },
      ),
    ).rejects.toThrow('Generic CLOSE is no longer supported');
  });

  it('should reject CLOSE direct action even while case is frozen', async () => {
    await expect(
      service.applyAction(
        'inc-1',
        {
          action: 'CLOSE' as any,
          reason: 'close after hold',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorRole: 'SUPER_ADMIN',
        },
      ),
    ).rejects.toThrow('Generic CLOSE is no longer supported');
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

  it('should expose MLRO review actions when actor roleCodes include MLRO', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.PENDING_MLRO_REVIEW,
        alerts: [],
        events: [],
        dispositionRecords: [],
        reports: [buildReport({ status: 'FINALIZED' })],
      }),
    );

    const result = await service.findOne('inc-1', {
      actorType: 'ADMIN',
      actorId: 'admin-1',
      actorNo: 'US0001',
      actorRole: 'SUPER_ADMIN',
      roleCodes: ['SUPER_ADMIN', 'MLRO'],
    });

    expect(result.availableMlroActions).toEqual([
      'APPROVE_FINAL_DISPOSITION',
      'RETURN_FOR_INVESTIGATION',
    ]);
  });

  it('should expose MLRO review actions when actor roleCodes include SUPER_ADMIN', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue({
      ...buildIncident({
        status: ComplianceIncidentStatus.PENDING_MLRO_REVIEW,
        ownerUserId: 'admin-1',
        ownerUserNo: 'ADMIN-001',
      }),
      alerts: [],
      events: [],
      dispositionRecords: [],
      reports: [],
      filings: [],
    });

    const result = await service.findOne('inc-1', {
      actorType: 'ADMIN',
      actorId: 'admin-1',
      actorNo: 'ADMIN-001',
      actorRole: 'SUPER_ADMIN',
      roleCodes: ['SUPER_ADMIN'],
    });

    expect(result.availableMlroActions).toEqual([
      'APPROVE_FINAL_DISPOSITION',
      'RETURN_FOR_INVESTIGATION',
    ]);
  });

  it('should allow SUPER_ADMIN actor fallback to execute MLRO review when roleCodes are missing', async () => {
    prismaMock.complianceIncident.findUnique
      .mockResolvedValueOnce({
        ...buildIncident({
          status: ComplianceIncidentStatus.PENDING_MLRO_REVIEW,
          proposedWorkflowDecision: 'CLEAR',
          proposedWorkflowReason: 'clear after review',
          proposedFinalDispositionCode: 'CLEAR',
          proposedFinalDispositionReason: 'clear after review',
          ownerUserId: 'admin-1',
          ownerUserNo: 'ADMIN-001',
        }),
        reports: [
          buildReport({
            status: 'FINALIZED',
            isCurrent: true,
            finalizedAt: new Date(),
          }),
        ],
      })
      .mockResolvedValueOnce({
        ...buildIncident({
          status: ComplianceIncidentStatus.CLOSED,
          proposedWorkflowDecision: 'CLEAR',
          proposedFinalDispositionCode: 'CLEAR',
          finalDispositionCode: 'CLEAR',
        }),
        alerts: [],
        events: [],
        dispositionRecords: [],
        reports: [],
        filings: [],
      });
    prismaMock.complianceIncident.update.mockResolvedValue(buildIncident({
      status: ComplianceIncidentStatus.CLOSED,
      proposedWorkflowDecision: 'CLEAR',
      proposedFinalDispositionCode: 'CLEAR',
      finalDispositionCode: 'CLEAR',
    }) as any);
    workflowTransitionServiceMock.transition.mockResolvedValue({
      customerStatus: 'ACTIVE',
    });

    await expect(
      service.reviewByMlro(
        'inc-1',
        {
          decision: 'APPROVE_FINAL_DISPOSITION',
          note: 'approved by super admin',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorNo: 'ADMIN-001',
          actorRole: 'SUPER_ADMIN',
        },
      ),
    ).resolves.toBeDefined();
  });

  it('should create REQUIRED filing after MLRO approval when filing is required', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        caseType: ComplianceCaseType.TRANSACTION,
        sourceType: 'DEPOSIT',
        stage: 'REVIEW_TRAVEL_RULE',
        status: ComplianceIncidentStatus.PENDING_MLRO_REVIEW,
        proposedWorkflowDecision: 'REJECT',
        proposedFinalDispositionCode: 'RISK_CONFIRMED',
        proposedFinalDispositionReason: 'Confirmed suspicious activity.',
        proposedFilingRequired: true,
        proposedFilingType: 'SUSPICIOUS_ACTIVITY',
        proposedFilingAuthority: 'FIU',
        metadata: JSON.stringify({ sourceId: 'dep-1' }),
        reports: [
          buildReport({
            status: 'FINALIZED',
            workflow: 'TRANSACTION',
            stage: 'REVIEW_TRAVEL_RULE',
            ruleCode: 'TX_TRAVEL_RULE_REVIEW_REQUIRED',
            finalDispositionCode: 'RISK_CONFIRMED',
            filingRequired: true,
            filingType: 'SUSPICIOUS_ACTIVITY',
            filingAuthority: 'FIU',
          }),
        ],
      }),
    );
    prismaMock.complianceIncident.update.mockResolvedValue(buildIncident());
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-mlro-approved' });
    prismaMock.complianceIncidentExternalFiling.create.mockResolvedValue({
      id: 'filing-1',
      incidentId: 'inc-1',
      filingNo: 'FIL2602010001',
      status: 'REQUIRED',
      filingType: 'SUSPICIOUS_ACTIVITY',
      filingAuthority: 'FIU',
      requiredAt: new Date('2026-02-19T03:00:00.000Z'),
      submittedAt: null,
      submittedById: null,
      submittedByNo: null,
      events: [],
    });
    prismaMock.complianceIncidentExternalFilingEvent.create.mockResolvedValue({
      id: 'filing-evt-1',
    });
    workflowTransitionServiceMock.transition.mockResolvedValue({
      transitionCode: 'TX_DEPOSIT_REJECT_TO_REJECTED',
      executed: true,
    });
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      status: ComplianceIncidentStatus.CLOSED,
      filingStatus: 'REQUIRED',
      currentFiling: {
        id: 'filing-1',
        filingNo: 'FIL2602010001',
        status: 'REQUIRED',
      },
      alerts: [],
      events: [],
    } as any);

    const result = await service.reviewByMlro(
      'inc-1',
      {
        decision: 'APPROVE_FINAL_DISPOSITION',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'SUPER_ADMIN',
        roleCodes: ['SUPER_ADMIN', 'MLRO'],
      },
    );

    expect(prismaMock.complianceIncidentExternalFiling.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: 'inc-1',
          status: 'REQUIRED',
          filingType: 'SUSPICIOUS_ACTIVITY',
          filingAuthority: 'FIU',
        }),
      }),
    );
    expect(prismaMock.complianceIncident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ComplianceIncidentStatus.CLOSED,
          reportStatus: 'NOT_REPORTED',
        }),
      }),
    );
    expect(result.currentFiling?.status).toBe('REQUIRED');
  });

  it('should execute transaction workflow transition after MLRO approves transaction clear', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        caseType: ComplianceCaseType.TRANSACTION,
        sourceType: 'DEPOSIT',
        stage: 'REVIEW_KYT',
        status: ComplianceIncidentStatus.PENDING_MLRO_REVIEW,
        proposedWorkflowDecision: 'CLEAR',
        proposedFinalDispositionCode: 'FALSE_POSITIVE',
        proposedFinalDispositionReason: 'False positive transaction hit.',
        decisionRecordIds: JSON.stringify(['decision-1']),
        metadata: JSON.stringify({ sourceId: 'dep-1' }),
        reports: [
          buildReport({
            status: 'FINALIZED',
            workflow: 'TRANSACTION',
            stage: 'REVIEW_KYT',
            ruleCode: 'TX_KYT_REVIEW_REQUIRED',
            finalDispositionCode: 'FALSE_POSITIVE',
            filingRequired: false,
          }),
        ],
      }),
    );
    prismaMock.complianceIncident.update.mockResolvedValue(buildIncident());
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-mlro-approved' });
    workflowTransitionServiceMock.transition.mockResolvedValue({
      transitionCode: 'TX_DEPOSIT_CLEAR_TO_SUCCESS',
      executed: true,
    });
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      status: ComplianceIncidentStatus.CLOSED,
      alerts: [],
      events: [],
    } as any);

    await service.reviewByMlro(
      'inc-1',
      {
        decision: 'APPROVE_FINAL_DISPOSITION',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'MLRO',
        roleCodes: ['MLRO'],
      },
    );

    expect(workflowTransitionServiceMock.transition).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        workflow: 'TRANSACTION',
        producerType: 'CASE',
        producerId: 'inc-1',
        sourceId: 'dep-1',
        dispositionCode: 'FALSE_POSITIVE',
      }),
    );
  });

  it('should execute swap transaction workflow transition after MLRO approves false positive disposition', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        caseType: ComplianceCaseType.TRANSACTION,
        sourceType: 'SWAP',
        stage: 'REVIEW_SWAP_FINAL',
        status: ComplianceIncidentStatus.PENDING_MLRO_REVIEW,
        entityType: 'SWAP_TRANSACTION',
        entityId: 'swap-1',
        entityNo: 'SWP0001',
        proposedWorkflowDecision: 'CLEAR',
        proposedFinalDispositionCode: 'FALSE_POSITIVE',
        proposedFinalDispositionReason: 'False positive swap hit.',
        decisionRecordIds: JSON.stringify(['decision-swap-1']),
        metadata: JSON.stringify({ sourceId: 'swap-1' }),
        reports: [
          buildReport({
            status: 'FINALIZED',
            workflow: 'TRANSACTION',
            stage: 'REVIEW_SWAP_FINAL',
            ruleCode: 'TX_SWAP_FINAL_REVIEW_REQUIRED',
            finalDispositionCode: 'FALSE_POSITIVE',
            filingRequired: false,
          }),
        ],
      }),
    );
    prismaMock.complianceIncident.update.mockResolvedValue(buildIncident());
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-swap-mlro-clear' });
    workflowTransitionServiceMock.transition.mockResolvedValue({
      transitionCode: 'TX_SWAP_CLEAR_TO_SUCCESS',
      executed: true,
    });
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      status: ComplianceIncidentStatus.CLOSED,
      alerts: [],
      events: [],
    } as any);

    await service.reviewByMlro(
      'inc-1',
      {
        decision: 'APPROVE_FINAL_DISPOSITION',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'MLRO',
        roleCodes: ['MLRO'],
      },
    );

    expect(workflowTransitionServiceMock.transition).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        workflow: 'TRANSACTION',
        stage: 'REVIEW_SWAP_FINAL',
        producerType: 'CASE',
        producerId: 'inc-1',
        sourceId: 'swap-1',
        sourceType: 'SWAP',
        dispositionCode: 'FALSE_POSITIVE',
        latestDecisionRecordId: 'decision-swap-1',
      }),
    );
  });

  it('should execute swap transaction workflow transition after MLRO approves reject disposition', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        caseType: ComplianceCaseType.TRANSACTION,
        sourceType: 'SWAP',
        stage: 'REVIEW_SWAP_FINAL',
        status: ComplianceIncidentStatus.PENDING_MLRO_REVIEW,
        entityType: 'SWAP_TRANSACTION',
        entityId: 'swap-1',
        entityNo: 'SWP0001',
        proposedWorkflowDecision: 'REJECT',
        proposedFinalDispositionCode: 'RISK_CONFIRMED',
        proposedFinalDispositionReason: 'Confirmed suspicious swap activity.',
        decisionRecordIds: JSON.stringify(['decision-swap-2']),
        metadata: JSON.stringify({ sourceId: 'swap-1' }),
        reports: [
          buildReport({
            status: 'FINALIZED',
            workflow: 'TRANSACTION',
            stage: 'REVIEW_SWAP_FINAL',
            ruleCode: 'TX_SWAP_FINAL_REVIEW_REQUIRED',
            finalDispositionCode: 'RISK_CONFIRMED',
            filingRequired: false,
          }),
        ],
      }),
    );
    prismaMock.complianceIncident.update.mockResolvedValue(buildIncident());
    prismaMock.complianceIncidentEvent.create.mockResolvedValue({ id: 'evt-swap-mlro-reject' });
    workflowTransitionServiceMock.transition.mockResolvedValue({
      transitionCode: 'TX_SWAP_REJECT_TO_REJECTED',
      executed: true,
    });
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      status: ComplianceIncidentStatus.CLOSED,
      alerts: [],
      events: [],
    } as any);

    await service.reviewByMlro(
      'inc-1',
      {
        decision: 'APPROVE_FINAL_DISPOSITION',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'MLRO',
        roleCodes: ['MLRO'],
      },
    );

    expect(workflowTransitionServiceMock.transition).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        workflow: 'TRANSACTION',
        stage: 'REVIEW_SWAP_FINAL',
        producerType: 'CASE',
        producerId: 'inc-1',
        sourceId: 'swap-1',
        sourceType: 'SWAP',
        dispositionCode: 'RISK_CONFIRMED',
        latestDecisionRecordId: 'decision-swap-2',
      }),
    );
  });

  it('should mark compatibility report mirror as REPORTED after filing submission', async () => {
    prismaMock.complianceIncident.findUnique.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.CLOSED,
      }),
    );
    prismaMock.complianceIncidentExternalFiling.findUnique.mockResolvedValue({
      id: 'filing-1',
      incidentId: 'inc-1',
      filingNo: 'FIL2602010001',
      status: 'REQUIRED',
      filingType: 'SUSPICIOUS_ACTIVITY',
      filingAuthority: 'FIU',
      externalRefNo: null,
      submittedAt: null,
      submittedById: null,
      submittedByNo: null,
      events: [],
    });
    prismaMock.complianceIncidentExternalFiling.update.mockResolvedValue({
      id: 'filing-1',
    });
    prismaMock.complianceIncidentExternalFilingEvent.create.mockResolvedValue({
      id: 'filing-evt-2',
    });
    prismaMock.complianceIncident.update.mockResolvedValue(buildIncident());
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'inc-1',
      filingStatus: 'SUBMITTED',
      reportStatus: 'REPORTED',
      alerts: [],
      events: [],
    } as any);

    const result = await service.submitExternalFiling(
      'inc-1',
      {
        note: 'Submitted to FIU.',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'MLRO',
        roleCodes: ['MLRO'],
      },
    );

    expect(prismaMock.complianceIncident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reportStatus: 'REPORTED',
          reportRefNo: 'FIL2602010001',
        }),
      }),
    );
    expect(result.reportStatus).toBe('REPORTED');
  });

  it('should exclude compatibility-only legacy filing from canonical filing state', () => {
    const residualLegacyFiling = {
      id: 'filing-legacy-1',
      incidentId: 'inc-1',
      filingNo: 'FIL2602010999',
      status: 'REQUIRED',
      filingType: 'SUSPICIOUS_ACTIVITY',
      filingAuthority: 'FIU',
      requiredAt: new Date('2026-02-19T03:00:00.000Z'),
      requiredById: 'admin-1',
      requiredByNo: 'US0001',
      requiredByRole: 'MLRO',
      submittedAt: null,
      submittedById: null,
      submittedByNo: null,
      submittedByRole: null,
      externalRefNo: null,
      latestFeedback: null,
      latestFeedbackAt: null,
      latestFeedbackById: null,
      latestFeedbackByNo: null,
      latestFeedbackByRole: null,
      closedAt: null,
      closedById: null,
      closedByNo: null,
      closedByRole: null,
      metadata: JSON.stringify({
        source: 'LEGACY_PHASE12_BACKFILL',
        compatibilityOnly: true,
        compatibilityReason: 'LEGACY_HEURISTIC_BACKFILL',
      }),
      createdAt: new Date('2026-02-19T03:00:00.000Z'),
      updatedAt: new Date('2026-02-19T03:00:00.000Z'),
      events: [],
    };

    const mapped = (service as any).mapIncident(
      buildIncident({
        reportStatus: 'REPORTED',
        reportRefNo: 'FIL2602010999',
        filings: [residualLegacyFiling],
      }),
    );

    expect(mapped.currentFiling).toBeNull();
    expect(mapped.filingStatus).toBe('NOT_REQUIRED');
    expect(mapped.filingHistory).toEqual([]);
    expect(
      (service as any).getAvailableFilingActions({
        status: ComplianceIncidentStatus.CLOSED,
        filings: [residualLegacyFiling],
      }),
    ).toEqual([]);
    expect(mapped.reportStatus).toBe('REPORTED');
  });

  it('should create onboarding final approval after MLRO approves onboarding EDD clear', async () => {
    prismaMock.complianceIncident.findUnique
      .mockResolvedValueOnce(
        buildIncident({
          status: ComplianceIncidentStatus.PENDING_MLRO_REVIEW,
          stage: 'REVIEW_EDD',
          sourceType: 'ONBOARDING_JOURNEY',
          proposedWorkflowDecision: 'CLEAR',
          proposedWorkflowReason: 'clear after EDD review',
          proposedFinalDispositionCode: 'CLEAR',
          proposedFinalDispositionReason: 'clear after EDD review',
          reports: [
            buildReport({
              status: 'FINALIZED',
              finalDispositionCode: 'CLEAR',
              finalDispositionReason: 'clear after EDD review',
            }),
          ],
        }),
      )
      .mockResolvedValueOnce({
        ...buildIncident({
          status: ComplianceIncidentStatus.CLOSED,
          stage: 'REVIEW_EDD',
          sourceType: 'ONBOARDING_JOURNEY',
          proposedWorkflowDecision: 'CLEAR',
          proposedFinalDispositionCode: 'CLEAR',
          finalDispositionCode: 'CLEAR',
        }),
        alerts: [],
        events: [],
        dispositionRecords: [],
        reports: [],
        filings: [],
      });
    prismaMock.complianceIncident.update.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.CLOSED,
        stage: 'REVIEW_EDD',
        sourceType: 'ONBOARDING_JOURNEY',
        proposedWorkflowDecision: 'CLEAR',
        proposedFinalDispositionCode: 'CLEAR',
        finalDispositionCode: 'CLEAR',
      }) as any,
    );
    workflowTransitionServiceMock.transition.mockResolvedValue({
      transitionCode: 'EDD_APPROVE_TO_FINAL_APPROVAL',
      toStatus: 'FINAL_APPROVAL',
      createdFinalApprovalId: 'approval-1',
    });

    await service.reviewByMlro(
      'inc-1',
      {
        decision: 'APPROVE_FINAL_DISPOSITION',
        note: 'approve onboarding edd clear',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'ADMIN-001',
        actorRole: 'MLRO',
        roleCodes: ['MLRO'],
      },
    );

    expect(
      onboardingFinalApprovalServiceMock.ensurePendingApprovalInTransaction,
    ).not.toHaveBeenCalled();
    expect(
      onboardingFinalApprovalServiceMock.emitSubmittedSideEffects,
    ).toHaveBeenCalledWith(
      'approval-1',
      'admin-1',
      'MLRO',
      'approve onboarding edd clear',
    );
  });

  it('should emit onboarding approval side effects only after MLRO transaction commits', async () => {
    const callOrder: string[] = [];
    prismaMock.$transaction.mockImplementationOnce(async (callback: any) => {
      callOrder.push('tx:start');
      const result = await callback(prismaMock);
      callOrder.push('tx:end');
      return result;
    });
    prismaMock.complianceIncident.findUnique
      .mockResolvedValueOnce(
        buildIncident({
          status: ComplianceIncidentStatus.PENDING_MLRO_REVIEW,
          stage: 'REVIEW_EDD',
          sourceType: 'ONBOARDING_JOURNEY',
          proposedWorkflowDecision: 'CLEAR',
          proposedWorkflowReason: 'clear after EDD review',
          proposedFinalDispositionCode: 'CLEAR',
          proposedFinalDispositionReason: 'clear after EDD review',
          reports: [
            buildReport({
              status: 'FINALIZED',
              finalDispositionCode: 'CLEAR',
              finalDispositionReason: 'clear after EDD review',
            }),
          ],
        }),
      )
      .mockResolvedValueOnce({
        ...buildIncident({
          status: ComplianceIncidentStatus.CLOSED,
          stage: 'REVIEW_EDD',
          sourceType: 'ONBOARDING_JOURNEY',
          proposedWorkflowDecision: 'CLEAR',
          proposedFinalDispositionCode: 'CLEAR',
          finalDispositionCode: 'CLEAR',
        }),
        alerts: [],
        events: [],
        dispositionRecords: [],
        reports: [],
        filings: [],
      });
    workflowTransitionServiceMock.transition.mockResolvedValue({
      transitionCode: 'EDD_APPROVE_TO_FINAL_APPROVAL',
      toStatus: 'FINAL_APPROVAL',
      createdFinalApprovalId: 'approval-1',
    });
    onboardingFinalApprovalServiceMock.emitSubmittedSideEffects.mockImplementation(
      async () => {
        callOrder.push('emit');
      },
    );

    await service.reviewByMlro(
      'inc-1',
      {
        decision: 'APPROVE_FINAL_DISPOSITION',
        note: 'approve onboarding edd clear',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'ADMIN-001',
        actorRole: 'MLRO',
        roleCodes: ['MLRO'],
      },
    );

    expect(callOrder).toEqual(['tx:start', 'tx:end', 'emit']);
    expect(
      onboardingFinalApprovalServiceMock.ensurePendingApprovalInTransaction,
    ).not.toHaveBeenCalled();
  });

  it('should not create onboarding final approval after MLRO approves onboarding CDD clear', async () => {
    prismaMock.complianceIncident.findUnique
      .mockResolvedValueOnce(
        buildIncident({
          status: ComplianceIncidentStatus.PENDING_MLRO_REVIEW,
          stage: 'REVIEW_CDD',
          sourceType: 'ONBOARDING_JOURNEY',
          proposedWorkflowDecision: 'CLEAR',
          proposedWorkflowReason: 'clear after CDD review',
          proposedFinalDispositionCode: 'CLEAR',
          proposedFinalDispositionReason: 'clear after CDD review',
          reports: [
            buildReport({
              status: 'FINALIZED',
              finalDispositionCode: 'CLEAR',
              finalDispositionReason: 'clear after CDD review',
            }),
          ],
        }),
      )
      .mockResolvedValueOnce({
        ...buildIncident({
          status: ComplianceIncidentStatus.CLOSED,
          stage: 'REVIEW_CDD',
          sourceType: 'ONBOARDING_JOURNEY',
          proposedWorkflowDecision: 'CLEAR',
          proposedFinalDispositionCode: 'CLEAR',
          finalDispositionCode: 'CLEAR',
        }),
        alerts: [],
        events: [],
        dispositionRecords: [],
        reports: [],
        filings: [],
      });
    prismaMock.complianceIncident.update.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.CLOSED,
        stage: 'REVIEW_CDD',
        sourceType: 'ONBOARDING_JOURNEY',
        proposedWorkflowDecision: 'CLEAR',
        proposedFinalDispositionCode: 'CLEAR',
        finalDispositionCode: 'CLEAR',
      }) as any,
    );
    workflowTransitionServiceMock.transition.mockResolvedValue({
      transitionCode: 'CDD_APPROVE_TO_ACTIVE',
      toStatus: 'ACTIVE',
      createdFinalApprovalId: null,
    });

    await service.reviewByMlro(
      'inc-1',
      {
        decision: 'APPROVE_FINAL_DISPOSITION',
        note: 'approve onboarding cdd clear',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'ADMIN-001',
        actorRole: 'MLRO',
        roleCodes: ['MLRO'],
      },
    );

    expect(
      onboardingFinalApprovalServiceMock.ensurePendingApprovalInTransaction,
    ).not.toHaveBeenCalled();
    expect(
      onboardingFinalApprovalServiceMock.emitSubmittedSideEffects,
    ).not.toHaveBeenCalled();
  });

  it('should transition onboarding CDD case to REJECTED after MLRO approves reject proposal', async () => {
    prismaMock.complianceIncident.findUnique
      .mockResolvedValueOnce(
        buildIncident({
          status: ComplianceIncidentStatus.PENDING_MLRO_REVIEW,
          stage: 'REVIEW_CDD',
          sourceType: 'ONBOARDING_JOURNEY',
          proposedWorkflowDecision: 'REJECT',
          proposedWorkflowReason: 'confirmed sanctions exposure',
          proposedFinalDispositionCode: 'RISK_CONFIRMED',
          proposedFinalDispositionReason: 'confirmed sanctions exposure',
          decisionRecordIds: JSON.stringify(['decision-onb-1']),
          reports: [
            buildReport({
              status: 'FINALIZED',
              finalDispositionCode: 'RISK_CONFIRMED',
              finalDispositionReason: 'confirmed sanctions exposure',
            }),
          ],
        }),
      )
      .mockResolvedValueOnce({
        ...buildIncident({
          status: ComplianceIncidentStatus.CLOSED,
          stage: 'REVIEW_CDD',
          sourceType: 'ONBOARDING_JOURNEY',
          proposedWorkflowDecision: 'REJECT',
          proposedFinalDispositionCode: 'RISK_CONFIRMED',
          finalDispositionCode: 'RISK_CONFIRMED',
        }),
        alerts: [],
        events: [],
        dispositionRecords: [],
        reports: [],
        filings: [],
      });
    prismaMock.complianceIncident.update.mockResolvedValue(
      buildIncident({
        status: ComplianceIncidentStatus.CLOSED,
        stage: 'REVIEW_CDD',
        sourceType: 'ONBOARDING_JOURNEY',
        proposedWorkflowDecision: 'REJECT',
        proposedFinalDispositionCode: 'RISK_CONFIRMED',
        finalDispositionCode: 'RISK_CONFIRMED',
      }) as any,
    );
    workflowTransitionServiceMock.transition.mockResolvedValue({
      transitionCode: 'CDD_REJECT_TO_REJECTED',
      toStatus: 'REJECTED',
      createdFinalApprovalId: null,
    });

    await service.reviewByMlro(
      'inc-1',
      {
        decision: 'APPROVE_FINAL_DISPOSITION',
        note: 'approve onboarding cdd reject',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'ADMIN-001',
        actorRole: 'MLRO',
        roleCodes: ['MLRO'],
      },
    );

    expect(workflowTransitionServiceMock.transition).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        workflow: 'ONBOARDING',
        stage: 'REVIEW_CDD',
        producerType: 'CASE',
        producerId: 'inc-1',
        dispositionCode: 'REJECT',
        latestDecisionRecordId: 'decision-onb-1',
      }),
    );
    expect(
      onboardingFinalApprovalServiceMock.ensurePendingApprovalInTransaction,
    ).not.toHaveBeenCalled();
  });
});
