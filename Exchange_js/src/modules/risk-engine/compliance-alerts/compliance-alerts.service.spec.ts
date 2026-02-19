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
    dedupeKey: 'TX_KYT_FAIL:DEPOSIT:dep-1:MAIN',
    ruleCode: 'TX_KYT_FAIL',
    capCode: 'CAP-027',
    severity: ComplianceAlertSeverity.CRITICAL,
    status: ComplianceAlertStatus.NEW,
    title: 'title',
    message: 'message',
    sourceModule: 'risk-engine/transaction-compliance',
    sourceType: 'DEPOSIT',
    sourceId: 'dep-1',
    sourceNo: 'DP0001',
    entityType: 'KYT_CASE',
    entityId: 'kyt-1',
    entityNo: 'KYT0001',
    ownerType: 'CUSTOMER',
    ownerId: 'customer-1',
    ownerNo: 'CU0001',
    customerId: 'customer-1',
    customerNo: 'CU0001',
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
    jest
      .spyOn(AuditLogsService.prototype, 'recordSystem')
      .mockResolvedValue({} as any);
    jest
      .spyOn(AuditLogsService.prototype, 'recordByActor')
      .mockResolvedValue({} as any);
    service = new ComplianceAlertsService(prismaMock);
  });

  it('should create a new alert when dedupe key does not exist', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue(null);
    prismaMock.customerMain.findUnique.mockResolvedValue({
      customerNo: 'CU0001',
    });
    prismaMock.complianceAlert.create.mockResolvedValue(buildAlert());

    const result = await service.triggerSystemAlert({
      ruleCode: 'TX_KYT_FAIL',
      sourceModule: 'risk-engine/transaction-compliance',
      sourceType: 'DEPOSIT',
      sourceId: 'dep-1',
      stage: 'MAIN',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      metadata: { status: 'FAIL' },
    });

    expect(prismaMock.complianceAlert.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.complianceAlertEvent.create).toHaveBeenCalledTimes(1);
    expect(result.ruleCode).toBe('TX_KYT_FAIL');
  });

  it('should update hitCount when existing open alert is triggered again', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue({
      id: 'alert-1',
      status: ComplianceAlertStatus.NEW,
      hitCount: 2,
      alertNo: 'ALT2602010001',
    });
    prismaMock.customerMain.findUnique.mockResolvedValue({
      customerNo: 'CU0001',
    });
    prismaMock.complianceAlert.update.mockResolvedValue(
      buildAlert({ hitCount: 3 }),
    );

    await service.triggerSystemAlert({
      ruleCode: 'TX_KYT_REVIEW',
      sourceModule: 'risk-engine/transaction-compliance',
      sourceType: 'WITHDRAW',
      sourceId: 'wd-1',
      stage: 'MAIN',
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

  it('should create new alert and rotate dedupeKey when existing alert is terminal', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue({
      id: 'alert-1',
      status: ComplianceAlertStatus.RESOLVED,
      hitCount: 4,
      alertNo: 'ALT2602010001',
    });
    prismaMock.customerMain.findUnique.mockResolvedValue({
      customerNo: 'CU0001',
    });
    prismaMock.complianceAlert.update.mockResolvedValue(buildAlert());
    prismaMock.complianceAlert.create.mockResolvedValue(
      buildAlert({
        id: 'alert-2',
        alertNo: 'ALT2602010002',
        status: ComplianceAlertStatus.NEW,
        dedupeKey: 'TX_TRAVEL_RULE_EXPIRED:WITHDRAW:wd-2',
        hitCount: 1,
      }),
    );

    const result = await service.triggerSystemAlert({
      ruleCode: 'TX_TRAVEL_RULE_EXPIRED',
      sourceModule: 'risk-engine/transaction-compliance',
      sourceType: 'WITHDRAW',
      sourceId: 'wd-2',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
    });

    expect(prismaMock.complianceAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dedupeKey: expect.stringContaining(
            'TX_TRAVEL_RULE_EXPIRED:WITHDRAW:wd-2#closed#alert-1#',
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
        ...buildAlert(),
        events: [],
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

  it('should reject RESOLVE without reason', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue(
      buildAlert({ status: ComplianceAlertStatus.IN_REVIEW }),
    );

    await expect(
      service.applyAction(
        'alert-1',
        { action: ComplianceAlertAction.RESOLVE },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
        },
      ),
    ).rejects.toThrow('requires a reason');
  });

  it('should reject START_REVIEW from NEW', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue(
      buildAlert({ status: ComplianceAlertStatus.NEW }),
    );

    await expect(
      service.applyAction(
        'alert-1',
        { action: ComplianceAlertAction.START_REVIEW },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
        },
      ),
    ).rejects.toThrow('is not allowed');
  });

  it('should allow ASSIGN from IN_REVIEW and move back to ASSIGNED', async () => {
    prismaMock.complianceAlert.findUnique
      .mockResolvedValueOnce(
        buildAlert({ status: ComplianceAlertStatus.IN_REVIEW }),
      )
      .mockResolvedValueOnce({
        ...buildAlert({
          status: ComplianceAlertStatus.ASSIGNED,
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
        }),
        events: [],
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
      },
    );

    expect(result.status).toBe(ComplianceAlertStatus.ASSIGNED);
  });

  it('should reject terminal status action', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue(
      buildAlert({ status: ComplianceAlertStatus.ESCALATED }),
    );

    await expect(
      service.applyAction(
        'alert-1',
        { action: ComplianceAlertAction.RESOLVE, reason: 'done' },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
        },
      ),
    ).rejects.toThrow('is not allowed');
  });

  it('should reject removed action REOPEN', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue(
      buildAlert({ status: ComplianceAlertStatus.RESOLVED }),
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
      .mockImplementation(async (input) =>
        buildAlert({
          id: `alert-${input.sourceId}`,
          alertNo: `ALT-SIM-${input.sourceId}`,
          ruleCode: input.ruleCode,
          severity: ComplianceAlertSeverity.HIGH,
          status: ComplianceAlertStatus.NEW,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          lastOccurredAt: new Date('2026-02-19T00:00:00.000Z'),
        }),
      );

    const result = await service.simulateRandomAlerts(10);

    expect(triggerSpy).toHaveBeenCalledTimes(10);
    const sourceIds = triggerSpy.mock.calls.map(([input]) => input.sourceId);
    expect(new Set(sourceIds).size).toBe(10);
    expect(
      triggerSpy.mock.calls.every(
        ([input]) => input.sourcePlatform === 'ADMIN_SIMULATOR',
      ),
    ).toBe(true);
    expect(result.createdCount).toBe(10);
    expect(result.items).toHaveLength(10);
  });
});
