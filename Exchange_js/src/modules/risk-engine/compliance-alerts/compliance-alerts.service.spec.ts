import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ComplianceAlertsService } from './compliance-alerts.service';
import {
  ComplianceAlertAction,
  ComplianceAlertSeverity,
  ComplianceAlertStatus,
} from './constants/compliance-alert-rules.constant';

describe('ComplianceAlertsService', () => {
  const prismaMock: any = {
    complianceAlert: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    complianceAlertEvent: {
      create: jest.fn(),
    },
    complianceAlertDispositionRecord: {
      create: jest.fn(),
    },
    customerMain: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  let service: ComplianceAlertsService;

  const buildAlert = (overrides: Record<string, unknown> = {}) => ({
    id: 'alert-1',
    alertNo: 'ALT2602010001',
    dedupeKey: 'ONB_CDD_REVIEW_REQUIRED:ONBOARDING_JOURNEY:customer-1:journey-1:REVIEW_CDD',
    ruleCode: 'ONB_CDD_REVIEW_REQUIRED',
    capCode: 'CAP-027',
    severity: ComplianceAlertSeverity.CRITICAL,
    status: ComplianceAlertStatus.OPEN,
    title: 'title',
    message: 'message',
    sourceModule: 'identity/onboarding',
    sourceType: 'ONBOARDING_JOURNEY',
    sourceId: 'customer-1:journey-1',
    sourceNo: 'ONB0001',
    entityType: 'CDD_CASE',
    entityId: 'cdd-1',
    entityNo: 'CDD0001',
    ownerType: 'CUSTOMER',
    ownerId: 'customer-1',
    ownerNo: 'CU0001',
    customerId: 'customer-1',
    customerNo: 'CU0001',
    journeyId: 'journey-1',
    stage: 'REVIEW_CDD',
    decisionRecommendation: null,
    decision: null,
    currentDispositionCode: null,
    currentDispositionReason: null,
    currentDispositionAt: null,
    currentDispositionById: null,
    currentDispositionByNo: null,
    currentDispositionByRole: null,
    currentDispositionRecordId: null,
    finalDispositionCode: null,
    finalDispositionReason: null,
    finalDispositionAt: null,
    finalDispositionRecordId: null,
    linkedCaseIds: null,
    decisionRecordIds: null,
    overdueMarkedAt: null,
    firstOccurredAt: new Date('2026-02-19T00:00:00.000Z'),
    lastOccurredAt: new Date('2026-02-19T00:00:00.000Z'),
    dueAt: new Date('2026-02-19T04:00:00.000Z'),
    hitCount: 1,
    assigneeUserId: null,
    assigneeUserNo: null,
    assignedAt: null,
    closedAt: null,
    closeReason: null,
    lastActionById: 'SYSTEM',
    lastActionByNo: 'SYSTEM',
    lastActionByRole: 'SYSTEM',
    lastActionAt: new Date('2026-02-19T00:00:00.000Z'),
    metadata: null,
    retainedUntil: new Date('2034-02-19T00:00:00.000Z'),
    createdAt: new Date('2026-02-19T00:00:00.000Z'),
    updatedAt: new Date('2026-02-19T00:00:00.000Z'),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AuditLogsService.prototype, 'recordSystem').mockResolvedValue({} as any);
    jest.spyOn(AuditLogsService.prototype, 'recordByActor').mockResolvedValue({} as any);
    prismaMock.complianceAlertDispositionRecord.create.mockResolvedValue({
      id: 'alert-disp-1',
    });
    service = new ComplianceAlertsService(prismaMock);
  });

  it('should create a new alert when dedupe key does not exist', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue(null);
    prismaMock.customerMain.findUnique.mockResolvedValue({ customerNo: 'CU0001' });
    prismaMock.complianceAlert.create.mockResolvedValue(buildAlert());

    const result = await service.triggerSystemAlert({
      ruleCode: 'ONB_CDD_REVIEW_REQUIRED',
      sourceModule: 'identity/onboarding',
      sourceType: 'ONBOARDING_JOURNEY',
      sourceId: 'customer-1:journey-1',
      stage: 'REVIEW_CDD',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      metadata: { status: 'FAIL' },
    });

    expect(prismaMock.complianceAlert.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.complianceAlertEvent.create).toHaveBeenCalledTimes(1);
    expect(result.ruleCode).toBe('ONB_CDD_REVIEW_REQUIRED');
    expect(result.status).toBe(ComplianceAlertStatus.OPEN);
  });

  it('should update hitCount when existing open alert is triggered again', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue({
      id: 'alert-1',
      status: ComplianceAlertStatus.OPEN,
      hitCount: 2,
      alertNo: 'ALT2602010001',
    });
    prismaMock.customerMain.findUnique.mockResolvedValue({ customerNo: 'CU0001' });
    prismaMock.complianceAlert.update.mockResolvedValue(buildAlert({ hitCount: 3 }));

    await service.triggerSystemAlert({
      ruleCode: 'ONB_EDD_REVIEW_REQUIRED',
      sourceModule: 'identity/onboarding',
      sourceType: 'ONBOARDING_JOURNEY',
      sourceId: 'customer-1:journey-1',
      stage: 'REVIEW_EDD',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      metadata: { status: 'REVIEW' },
    });

    expect(prismaMock.complianceAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hitCount: 3,
        }),
      }),
    );
  });

  it('should create new alert and rotate dedupe key when existing alert is closed', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue({
      id: 'alert-1',
      status: ComplianceAlertStatus.CLOSED,
      hitCount: 4,
      alertNo: 'ALT2602010001',
    });
    prismaMock.customerMain.findUnique.mockResolvedValue({ customerNo: 'CU0001' });
    prismaMock.complianceAlert.update.mockResolvedValue(buildAlert());
    prismaMock.complianceAlert.create.mockResolvedValue(
      buildAlert({
        id: 'alert-2',
        alertNo: 'ALT2602010002',
        status: ComplianceAlertStatus.OPEN,
        stage: 'REVIEW_EDD',
        ruleCode: 'ONB_EDD_REVIEW_REQUIRED',
        dedupeKey:
          'ONB_EDD_REVIEW_REQUIRED:ONBOARDING_JOURNEY:customer-1:journey-1:REVIEW_EDD',
        hitCount: 1,
      }),
    );

    const result = await service.triggerSystemAlert({
      ruleCode: 'ONB_EDD_REVIEW_REQUIRED',
      sourceModule: 'identity/onboarding',
      sourceType: 'ONBOARDING_JOURNEY',
      sourceId: 'customer-1:journey-1',
      stage: 'REVIEW_EDD',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
    });

    expect(prismaMock.complianceAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dedupeKey: expect.stringContaining(
            'ONB_EDD_REVIEW_REQUIRED:ONBOARDING_JOURNEY:customer-1:journey-1:REVIEW_EDD#closed#alert-1#',
          ),
        }),
      }),
    );
    expect(prismaMock.complianceAlert.create).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('alert-2');
  });

  it('should apply ASSIGN action and set assignee to actor by default', async () => {
    prismaMock.complianceAlert.findUnique
      .mockResolvedValueOnce(buildAlert())
      .mockResolvedValueOnce({
        ...buildAlert({
          status: ComplianceAlertStatus.ASSIGNED,
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
        }),
        events: [],
        dispositionRecords: [],
      });
    prismaMock.user.findUnique.mockResolvedValue({ userNo: 'US0001' });
    prismaMock.complianceAlert.update.mockResolvedValue(
      buildAlert({
        status: ComplianceAlertStatus.ASSIGNED,
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
      }),
    );

    const result = await service.applyAction(
      'alert-1',
      { action: ComplianceAlertAction.ASSIGN },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'ADMIN',
      },
    );

    expect(prismaMock.complianceAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ComplianceAlertStatus.ASSIGNED,
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
        }),
      }),
    );
    expect(result.id).toBe('alert-1');
  });

  it('should allow UNASSIGN from ASSIGNED and move to OPEN', async () => {
    prismaMock.complianceAlert.findUnique
      .mockResolvedValueOnce(
        buildAlert({
          status: ComplianceAlertStatus.ASSIGNED,
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
        }),
      )
      .mockResolvedValueOnce({
        ...buildAlert({
          status: ComplianceAlertStatus.OPEN,
          assigneeUserId: null,
          assigneeUserNo: null,
        }),
        events: [],
        dispositionRecords: [],
      });
    prismaMock.complianceAlert.update.mockResolvedValue(
      buildAlert({
        status: ComplianceAlertStatus.OPEN,
        assigneeUserId: null,
        assigneeUserNo: null,
      }),
    );

    const result = await service.applyAction(
      'alert-1',
      { action: ComplianceAlertAction.UNASSIGN },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
      },
    );

    expect(result.status).toBe(ComplianceAlertStatus.OPEN);
  });

  it('should forbid reassign when actor is not current assignee', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue(
      buildAlert({
        status: ComplianceAlertStatus.ASSIGNED,
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
      }),
    );

    await expect(
      service.applyAction(
        'alert-1',
        {
          action: ComplianceAlertAction.ASSIGN,
          assigneeUserId: 'admin-3',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-2',
          actorNo: 'US0002',
          actorRole: 'ADMIN',
        },
      ),
    ).rejects.toThrow('can reassign');
  });

  it('should allow reassign when actor is current assignee', async () => {
    prismaMock.complianceAlert.findUnique
      .mockResolvedValueOnce(
        buildAlert({
          status: ComplianceAlertStatus.ASSIGNED,
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
        }),
      )
      .mockResolvedValueOnce({
        ...buildAlert({
          status: ComplianceAlertStatus.ASSIGNED,
          assigneeUserId: 'admin-2',
          assigneeUserNo: 'US0002',
        }),
        events: [],
        dispositionRecords: [],
      });
    prismaMock.user.findUnique.mockResolvedValue({ userNo: 'US0002' });
    prismaMock.complianceAlert.update.mockResolvedValue(
      buildAlert({
        status: ComplianceAlertStatus.ASSIGNED,
        assigneeUserId: 'admin-2',
        assigneeUserNo: 'US0002',
      }),
    );

    const result = await service.applyAction(
      'alert-1',
      {
        action: ComplianceAlertAction.ASSIGN,
        assigneeUserId: 'admin-2',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'ADMIN',
      },
    );

    expect(result.status).toBe(ComplianceAlertStatus.ASSIGNED);
    expect(prismaMock.complianceAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assigneeUserId: 'admin-2',
          assigneeUserNo: 'US0002',
        }),
      }),
    );
  });

  it('should forbid ESCALATE when actor is not current assignee in ASSIGNED status', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue(
      buildAlert({
        status: ComplianceAlertStatus.ASSIGNED,
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
      }),
    );

    await expect(
      service.applyAction(
        'alert-1',
        { action: ComplianceAlertAction.ESCALATE, reason: 'handoff' },
        {
          actorType: 'ADMIN',
          actorId: 'admin-2',
          actorNo: 'US0002',
          actorRole: 'ADMIN',
        },
      ),
    ).rejects.toThrow('Only assignee');
  });

  it('should forbid CLOSE when actor is not current assignee in ASSIGNED status', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue(
      buildAlert({
        status: ComplianceAlertStatus.ASSIGNED,
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
      }),
    );

    await expect(
      service.applyAction(
        'alert-1',
        { action: ComplianceAlertAction.CLOSE, reason: 'resolved' },
        {
          actorType: 'ADMIN',
          actorId: 'admin-2',
          actorNo: 'US0002',
          actorRole: 'ADMIN',
        },
      ),
    ).rejects.toThrow('Only assignee');
  });

  it('should allow assignee to ESCALATE from ASSIGNED status', async () => {
    prismaMock.complianceAlert.findUnique
      .mockResolvedValueOnce(
        buildAlert({
          status: ComplianceAlertStatus.ASSIGNED,
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
        }),
      )
      .mockResolvedValueOnce({
        ...buildAlert({
          status: ComplianceAlertStatus.ESCALATED,
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          currentDispositionCode: 'ESCALATE_TO_CASE',
          finalDispositionCode: 'ESCALATE_TO_CASE',
        }),
        events: [],
        dispositionRecords: [],
      });
    prismaMock.complianceAlert.update.mockResolvedValue(
      buildAlert({
        status: ComplianceAlertStatus.ESCALATED,
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
      }),
    );

    const result = await service.applyAction(
      'alert-1',
      { action: ComplianceAlertAction.ESCALATE, reason: 'manual escalate' },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'ADMIN',
      },
    );

    expect(result.status).toBe(ComplianceAlertStatus.ESCALATED);
  });

  it('should return transaction-local ESCALATE disposition detail', async () => {
    prismaMock.complianceAlert.findUnique
      .mockResolvedValueOnce(
        buildAlert({
          status: ComplianceAlertStatus.ASSIGNED,
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
        }),
      )
      .mockResolvedValueOnce({
        ...buildAlert({
          status: ComplianceAlertStatus.ESCALATED,
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          currentDispositionCode: 'ESCALATE_TO_CASE',
          currentDispositionReason: 'manual escalate',
          currentDispositionAt: new Date('2026-02-19T00:10:00.000Z'),
          currentDispositionById: 'admin-1',
          currentDispositionByNo: 'US0001',
          currentDispositionByRole: 'ADMIN',
          currentDispositionRecordId: 'alert-disp-1',
          finalDispositionCode: 'ESCALATE_TO_CASE',
          finalDispositionReason: 'manual escalate',
          finalDispositionAt: new Date('2026-02-19T00:10:00.000Z'),
          finalDispositionRecordId: 'alert-disp-1',
          decision: 'ESCALATE_TO_CASE',
        }),
        events: [],
        dispositionRecords: [
          {
            id: 'alert-disp-1',
            alertId: 'alert-1',
            dispositionCode: 'ESCALATE_TO_CASE',
            reason: 'manual escalate',
            isFinal: true,
            supersedesRecordId: null,
            decisionRecordId: null,
            source: 'ALERT_ACTION',
            sourceRefId: 'alert-1',
            actorType: 'ADMIN',
            actorId: 'admin-1',
            actorNo: 'US0001',
            actorRole: 'ADMIN',
            createdAt: new Date('2026-02-19T00:10:00.000Z'),
          },
        ],
      });
    prismaMock.complianceAlert.update.mockResolvedValue(
      buildAlert({
        status: ComplianceAlertStatus.ESCALATED,
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
        currentDispositionCode: 'ESCALATE_TO_CASE',
        finalDispositionCode: 'ESCALATE_TO_CASE',
      }),
    );

    const result = await service.applyAction(
      'alert-1',
      { action: ComplianceAlertAction.ESCALATE, reason: 'manual escalate' },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'ADMIN',
      },
      prismaMock,
    );

    expect(result.status).toBe(ComplianceAlertStatus.ESCALATED);
    expect(result.currentDispositionCode).toBe('ESCALATE_TO_CASE');
    expect(result.finalDispositionCode).toBe('ESCALATE_TO_CASE');
    expect(result.dispositionHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dispositionCode: 'ESCALATE_TO_CASE',
        }),
      ]),
    );
  });

  it('should keep ASSIGNED status and record decision via ASSIGN action', async () => {
    prismaMock.complianceAlert.findUnique
      .mockResolvedValueOnce(
        buildAlert({
          status: ComplianceAlertStatus.ASSIGNED,
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
        }),
      )
      .mockResolvedValueOnce({
        ...buildAlert({
          status: ComplianceAlertStatus.ASSIGNED,
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          decision: 'APPROVE',
        }),
        events: [],
        dispositionRecords: [],
      });
    prismaMock.user.findUnique.mockResolvedValue({ userNo: 'US0001' });
    prismaMock.complianceAlert.update.mockResolvedValue(
      buildAlert({
        status: ComplianceAlertStatus.ASSIGNED,
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
        decision: 'APPROVE',
      }),
    );

    const result = await service.applyAction(
      'alert-1',
      {
        action: ComplianceAlertAction.ASSIGN,
        assigneeUserId: 'admin-1',
        decision: 'APPROVE',
        note: 'record decision only',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'ADMIN',
      },
    );

    expect(result.status).toBe(ComplianceAlertStatus.ASSIGNED);
    expect(prismaMock.complianceAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ComplianceAlertStatus.ASSIGNED,
          decision: 'APPROVE',
        }),
      }),
    );
  });

  it('should reject CLOSE without reason', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue(buildAlert({ status: 'OPEN' }));

    await expect(
      service.applyAction(
        'alert-1',
        { action: ComplianceAlertAction.CLOSE },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
        },
      ),
    ).rejects.toThrow('requires a reason');
  });

  it('should reject terminal status action', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue(
      buildAlert({ status: ComplianceAlertStatus.CLOSED }),
    );

    await expect(
      service.applyAction(
        'alert-1',
        { action: ComplianceAlertAction.ESCALATE, reason: 'handoff' },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
        },
      ),
    ).rejects.toThrow('is not allowed');
  });

  it('should reject removed action REOPEN', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue(
      buildAlert({ status: ComplianceAlertStatus.CLOSED }),
    );

    await expect(
      service.applyAction(
        'alert-1',
        { action: 'REOPEN' as any },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
        },
      ),
    ).rejects.toThrow('Unsupported action');
  });

  it('should simulate 10 alerts with unique sourceIds', async () => {
    const triggerSpy = jest
      .spyOn(service, 'triggerSystemAlert')
      .mockImplementation(async (input) => ({
        ...buildAlert({
          id: `alert-${input.sourceId}`,
          alertNo: `ALT-SIM-${input.sourceId}`,
          ruleCode: input.ruleCode,
          severity: ComplianceAlertSeverity.HIGH,
          status: ComplianceAlertStatus.OPEN,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          lastOccurredAt: new Date('2026-02-19T00:00:00.000Z'),
        }),
        workflow: 'ONBOARDING',
        stage: input.stage || 'REVIEW_CDD',
        rule: input.ruleCode,
        metadata: {},
        reasonCodes: [],
        linkedCaseIds: null,
        decisionRecordIds: null,
        recommendedDecisions: [],
      }));

    const result = await service.simulateRandomAlerts(10);

    expect(triggerSpy).toHaveBeenCalledTimes(10);
    const sourceIds = triggerSpy.mock.calls.map(([input]) => input.sourceId);
    expect(new Set(sourceIds).size).toBe(10);
    expect(
      triggerSpy.mock.calls.every(([input]) => input.sourcePlatform === 'ADMIN_SIMULATOR'),
    ).toBe(true);
    expect(result.createdCount).toBe(10);
    expect(result.items).toHaveLength(10);
  });
});
