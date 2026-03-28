import { ModuleRef } from '@nestjs/core';
import { WorkflowTransitionService } from '../../identity/onboarding/workflow-transition.service';
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
  const workflowTransitionServiceMock = {
    transition: jest.fn(),
  };
  const onboardingServiceMock = {
    applyOnboardingDecisionFromAlert: jest.fn(),
  };
  const periodicReviewServiceMock = {
    applyDecisionFromAlert: jest.fn(),
  };
  const complianceIncidentsServiceMock = {
    createFromAlert: jest.fn(),
  };
  const moduleRefMock = {
    get: jest.fn(),
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
    jest.resetAllMocks();
    moduleRefMock.get.mockImplementation((token: { name?: string }) => {
      switch (token?.name) {
        case WorkflowTransitionService.name:
          return workflowTransitionServiceMock;
        case 'OnboardingService':
          return onboardingServiceMock;
        case 'PeriodicReviewService':
          return periodicReviewServiceMock;
        case 'ComplianceIncidentsService':
          return complianceIncidentsServiceMock;
        default:
          return undefined;
      }
    });
    jest.spyOn(AuditLogsService.prototype, 'recordSystem').mockResolvedValue({} as any);
    jest.spyOn(AuditLogsService.prototype, 'recordByActor').mockResolvedValue({} as any);
    prismaMock.complianceAlertDispositionRecord.create.mockResolvedValue({
      id: 'alert-disp-1',
    });
    service = new ComplianceAlertsService(
      prismaMock,
      moduleRefMock as unknown as ModuleRef,
    );
  });

  it('should create a new alert when dedupe key does not exist', async () => {
    const recordSystemSpy = jest.spyOn(AuditLogsService.prototype, 'recordSystem');
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
    expect(recordSystemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'ONBOARDING:journey-1',
        workflowType: 'ONBOARDING',
        workflowId: 'journey-1',
        workflowNo: 'journey-1',
      }),
      undefined,
    );
    expect(result.ruleCode).toBe('ONB_CDD_REVIEW_REQUIRED');
    expect(result.status).toBe(ComplianceAlertStatus.OPEN);
  });

  it('should support periodic review rule codes in the alert registry', async () => {
    const recordSystemSpy = jest.spyOn(AuditLogsService.prototype, 'recordSystem');
    prismaMock.complianceAlert.findUnique.mockResolvedValue(null);
    prismaMock.customerMain.findUnique.mockResolvedValue({ customerNo: 'CU0001' });
    prismaMock.complianceAlert.create.mockResolvedValue(
      buildAlert({
        ruleCode: 'PRR_CDD_REVIEW_REQUIRED',
        sourceModule: 'identity/periodic-review',
        sourceType: 'PERIODIC_REVIEW_CYCLE',
        sourceId: 'cycle-1',
        sourceNo: 'PRR0001',
        stage: 'REVIEW_CDD',
        journeyId: null,
        dedupeKey:
          'PRR_CDD_REVIEW_REQUIRED:PERIODIC_REVIEW_CYCLE:cycle-1:REVIEW_CDD',
        title: 'Periodic Review CDD Review Required',
      }),
    );

    const result = await service.triggerSystemAlert({
      ruleCode: 'PRR_CDD_REVIEW_REQUIRED',
      sourceModule: 'identity/periodic-review',
      sourceType: 'PERIODIC_REVIEW_CYCLE',
      sourceId: 'cycle-1',
      sourceNo: 'PRR0001',
      stage: 'REVIEW_CDD',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      customerId: 'customer-1',
      metadata: { status: 'REVIEW' },
    });

    expect(prismaMock.complianceAlert.create).toHaveBeenCalledTimes(1);
    expect(recordSystemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'PERIODIC_REVIEW:cycle-1',
        workflowType: 'PERIODIC_REVIEW',
        workflowId: 'cycle-1',
        workflowNo: 'PRR0001',
      }),
      undefined,
    );
    expect(result.ruleCode).toBe('PRR_CDD_REVIEW_REQUIRED');
  });

  it('should support transaction rule codes and trace context for deposit alerts', async () => {
    const recordSystemSpy = jest.spyOn(AuditLogsService.prototype, 'recordSystem');
    prismaMock.complianceAlert.findUnique.mockResolvedValue(null);
    prismaMock.customerMain.findUnique.mockResolvedValue({ customerNo: 'CU0009' });
    prismaMock.complianceAlert.create.mockResolvedValue(
      buildAlert({
        ruleCode: 'TX_KYT_REVIEW_REQUIRED',
        sourceModule: 'risk-engine/transaction-compliance',
        sourceType: 'DEPOSIT',
        sourceId: 'dep-1',
        sourceNo: 'DEP0001',
        entityType: 'KYT_CASE',
        entityId: 'kyt-1',
        entityNo: 'KYT0001',
        stage: 'REVIEW_KYT',
        journeyId: null,
        dedupeKey: 'TX_KYT_REVIEW_REQUIRED:DEPOSIT:dep-1:REVIEW_KYT',
        title: 'Transaction KYT Review Required',
      }),
    );

    const result = await service.triggerSystemAlert({
      ruleCode: 'TX_KYT_REVIEW_REQUIRED',
      sourceModule: 'risk-engine/transaction-compliance',
      sourceType: 'DEPOSIT',
      sourceId: 'dep-1',
      sourceNo: 'DEP0001',
      stage: 'REVIEW_KYT',
      entityType: 'KYT_CASE',
      entityId: 'kyt-1',
      entityNo: 'KYT0001',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-9',
      customerId: 'customer-9',
      metadata: { triggerStatus: 'REVIEW' },
    });

    expect(prismaMock.complianceAlert.create).toHaveBeenCalledTimes(1);
    expect(recordSystemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'TRANSACTION:dep-1',
        workflowType: 'TRANSACTION',
        workflowId: 'dep-1',
        workflowNo: 'DEP0001',
      }),
      undefined,
    );
    expect(result.ruleCode).toBe('TX_KYT_REVIEW_REQUIRED');
    expect(result.stage).toBe('REVIEW_KYT');
  });

  it('should support transaction rule codes and trace context for swap alerts', async () => {
    const recordSystemSpy = jest.spyOn(AuditLogsService.prototype, 'recordSystem');
    prismaMock.complianceAlert.findUnique.mockResolvedValue(null);
    prismaMock.customerMain.findUnique.mockResolvedValue({ customerNo: 'CU0010' });
    prismaMock.complianceAlert.create.mockResolvedValue(
      buildAlert({
        ruleCode: 'TX_SWAP_FINAL_REVIEW_REQUIRED',
        sourceModule: 'risk-engine/transaction-compliance',
        sourceType: 'SWAP',
        sourceId: 'swap-1',
        sourceNo: 'SWP0001',
        entityType: 'SWAP_TRANSACTION',
        entityId: 'swap-1',
        entityNo: 'SWP0001',
        stage: 'REVIEW_SWAP_FINAL',
        journeyId: null,
        dedupeKey: 'TX_SWAP_FINAL_REVIEW_REQUIRED:SWAP:swap-1:REVIEW_SWAP_FINAL',
        title: 'Transaction Swap Final Review Required',
      }),
    );

    const result = await service.triggerSystemAlert({
      ruleCode: 'TX_SWAP_FINAL_REVIEW_REQUIRED',
      sourceModule: 'risk-engine/transaction-compliance',
      sourceType: 'SWAP',
      sourceId: 'swap-1',
      sourceNo: 'SWP0001',
      stage: 'REVIEW_SWAP_FINAL',
      entityType: 'SWAP_TRANSACTION',
      entityId: 'swap-1',
      entityNo: 'SWP0001',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-10',
      customerId: 'customer-10',
      metadata: { triggerStatus: 'REVIEW' },
    });

    expect(prismaMock.complianceAlert.create).toHaveBeenCalledTimes(1);
    expect(recordSystemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'TRANSACTION:swap-1',
        workflowType: 'TRANSACTION',
        workflowId: 'swap-1',
        workflowNo: 'SWP0001',
      }),
      undefined,
    );
    expect(result.ruleCode).toBe('TX_SWAP_FINAL_REVIEW_REQUIRED');
    expect(result.stage).toBe('REVIEW_SWAP_FINAL');
  });

  it('should support transaction rule codes and trace context for withdraw final alerts', async () => {
    const recordSystemSpy = jest.spyOn(AuditLogsService.prototype, 'recordSystem');
    prismaMock.complianceAlert.findUnique.mockResolvedValue(null);
    prismaMock.customerMain.findUnique.mockResolvedValue({ customerNo: 'CU0011' });
    prismaMock.complianceAlert.create.mockResolvedValue(
      buildAlert({
        ruleCode: 'TX_WITHDRAW_FINAL_REVIEW_REQUIRED',
        sourceModule: 'risk-engine/transaction-compliance',
        sourceType: 'WITHDRAW',
        sourceId: 'wd-1',
        sourceNo: 'WD0001',
        entityType: 'WITHDRAW_TRANSACTION',
        entityId: 'wd-1',
        entityNo: 'WD0001',
        stage: 'REVIEW_WITHDRAW_FINAL',
        journeyId: null,
        dedupeKey:
          'TX_WITHDRAW_FINAL_REVIEW_REQUIRED:WITHDRAW:wd-1:REVIEW_WITHDRAW_FINAL',
        title: 'Transaction Withdraw Final Review Required',
      }),
    );

    const result = await service.triggerSystemAlert({
      ruleCode: 'TX_WITHDRAW_FINAL_REVIEW_REQUIRED',
      sourceModule: 'risk-engine/transaction-compliance',
      sourceType: 'WITHDRAW',
      sourceId: 'wd-1',
      sourceNo: 'WD0001',
      stage: 'REVIEW_WITHDRAW_FINAL',
      entityType: 'WITHDRAW_TRANSACTION',
      entityId: 'wd-1',
      entityNo: 'WD0001',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-11',
      customerId: 'customer-11',
      metadata: { triggerStatus: 'MANUAL_SIMULATION' },
    });

    expect(prismaMock.complianceAlert.create).toHaveBeenCalledTimes(1);
    expect(recordSystemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'TRANSACTION:wd-1',
        workflowType: 'TRANSACTION',
        workflowId: 'wd-1',
        workflowNo: 'WD0001',
      }),
      undefined,
    );
    expect(result.ruleCode).toBe('TX_WITHDRAW_FINAL_REVIEW_REQUIRED');
    expect(result.stage).toBe('REVIEW_WITHDRAW_FINAL');
  });

  it('should include transaction workflow alerts in default findAll query', async () => {
    prismaMock.complianceAlert.count.mockResolvedValue(1);
    prismaMock.complianceAlert.findMany.mockResolvedValue([
      buildAlert({
        ruleCode: 'TX_DEPOSIT_FINAL_REVIEW_REQUIRED',
        sourceModule: 'risk-engine/transaction-compliance',
        sourceType: 'DEPOSIT',
        sourceId: 'dep-1',
        sourceNo: 'DEP0001',
        entityType: 'DEPOSIT_TRANSACTION',
        entityId: 'dep-1',
        entityNo: 'DEP0001',
        stage: 'REVIEW_DEPOSIT_FINAL',
        journeyId: null,
        dedupeKey: 'TX_DEPOSIT_FINAL_REVIEW_REQUIRED:DEPOSIT:dep-1:REVIEW_DEPOSIT_FINAL',
        title: 'Transaction Deposit Final Review Required',
      }),
    ]);

    const result = await service.findAll({});

    expect(prismaMock.complianceAlert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceType: {
            in: ['ONBOARDING_JOURNEY', 'PERIODIC_REVIEW_CYCLE', 'DEPOSIT', 'WITHDRAW', 'SWAP'],
          },
          stage: {
            in: expect.arrayContaining([
              'REVIEW_CDD',
              'REVIEW_EDD',
              'REVIEW_KYT',
              'REVIEW_TRAVEL_RULE',
              'REVIEW_DEPOSIT_FINAL',
              'REVIEW_WITHDRAW_FINAL',
            ]),
          },
        }),
      }),
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        sourceType: 'DEPOSIT',
        workflow: 'TRANSACTION',
        stage: 'REVIEW_DEPOSIT_FINAL',
        ruleCode: 'TX_DEPOSIT_FINAL_REVIEW_REQUIRED',
      }),
    ]);
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

  it('should reject generic CLOSE for workflow-bound alerts', async () => {
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
    ).rejects.toThrow('Workflow-bound alerts must be resolved');
  });

  it('should expose canonical handling actions for OPEN workflow-bound alert detail', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue({
      ...buildAlert({
        status: ComplianceAlertStatus.OPEN,
        assigneeUserId: null,
        assigneeUserNo: null,
      }),
      events: [],
      dispositionRecords: [],
    });

    const result = await service.findOne('alert-1', {
      actorType: 'ADMIN',
      actorId: 'admin-9',
      actorNo: 'US0009',
      actorRole: 'COMPLIANCE_LEAD',
    });

    expect(result.availableHandlingActions).toEqual(['ASSIGN']);
    expect(result.availableDirectProposals).toEqual([]);
    expect(result).not.toHaveProperty('availableAlertActions');
    expect(result).not.toHaveProperty('availableWorkflowActions');
  });

  it('should keep canonical handling empty for non-assignee on ASSIGNED workflow-bound alert detail', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue({
      ...buildAlert({
        status: ComplianceAlertStatus.ASSIGNED,
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
      }),
      events: [],
      dispositionRecords: [],
    });

    const result = await service.findOne('alert-1', {
      actorType: 'ADMIN',
      actorId: 'admin-2',
      actorNo: 'US0002',
      actorRole: 'COMPLIANCE_LEAD',
    });

    expect(result.availableHandlingActions).toEqual([]);
    expect(result.availableDirectProposals).toEqual([]);
    expect(result).not.toHaveProperty('availableAlertActions');
    expect(result).not.toHaveProperty('availableWorkflowActions');
  });

  it('should expose canonical direct proposals for assignee onboarding alert detail', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue({
      ...buildAlert({
        status: ComplianceAlertStatus.ASSIGNED,
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
      }),
      events: [],
      dispositionRecords: [],
    });

    const result = await service.findOne('alert-1', {
      actorType: 'ADMIN',
      actorId: 'admin-1',
      actorNo: 'US0001',
      actorRole: 'COMPLIANCE_LEAD',
    });

    expect(result.availableHandlingActions).toEqual([
      'REASSIGN',
      'FALSE_POSITIVE',
      'DIRECT_DISPOSITION',
      'ESCALATE_TO_CASE',
    ]);
    expect(result.availableDirectProposals).toEqual(['REJECT', 'REQUIRE_EDD']);
    expect(result).not.toHaveProperty('availableAlertActions');
    expect(result).not.toHaveProperty('availableWorkflowActions');
  });

  it('should expose canonical direct proposals for transaction alerts without legacy aliases', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue({
      ...buildAlert({
        status: ComplianceAlertStatus.ASSIGNED,
        sourceModule: 'risk-engine/transaction-compliance',
        sourceType: 'DEPOSIT',
        sourceId: 'dep-1',
        sourceNo: 'DEP0001',
        entityType: 'KYT_CASE',
        entityId: 'kyt-1',
        entityNo: 'KYT0001',
        stage: 'REVIEW_KYT',
        ruleCode: 'TX_KYT_REVIEW_REQUIRED',
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
      }),
      events: [],
      dispositionRecords: [],
    });

    const result = await service.findOne('alert-1', {
      actorType: 'ADMIN',
      actorId: 'admin-1',
      actorNo: 'US0001',
      actorRole: 'COMPLIANCE_LEAD',
    });

    expect(result.availableHandlingActions).toEqual([
      'REASSIGN',
      'FALSE_POSITIVE',
      'DIRECT_DISPOSITION',
      'ESCALATE_TO_CASE',
    ]);
    expect(result.availableDirectProposals).toEqual(['REJECT', 'FREEZE_TRANSACTION']);
    expect(result).not.toHaveProperty('availableAlertActions');
    expect(result).not.toHaveProperty('availableWorkflowActions');
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
          decision: 'CLEAR',
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
        decision: 'CLEAR',
      }),
    );

    const result = await service.applyAction(
      'alert-1',
      {
        action: ComplianceAlertAction.ASSIGN,
        assigneeUserId: 'admin-1',
        decision: 'CLEAR',
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
          decision: 'RESOLVED_BY_WORKFLOW',
          currentDispositionCode: 'RESOLVED_BY_WORKFLOW',
        }),
      }),
    );
  });

  it('should reject generic CLOSE for workflow-bound alerts before reason validation', async () => {
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
    ).rejects.toThrow('Workflow-bound alerts must be resolved');
  });

  it('should allow transaction false positive close and trigger deposit clear callback', async () => {
    prismaMock.complianceAlert.findUnique
      .mockResolvedValueOnce(
        buildAlert({
          status: ComplianceAlertStatus.ASSIGNED,
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'DEPOSIT',
          sourceId: 'dep-1',
          sourceNo: 'DEP0001',
          entityType: 'KYT_CASE',
          entityId: 'kyt-1',
          entityNo: 'KYT0001',
          stage: 'REVIEW_KYT',
          ruleCode: 'TX_KYT_REVIEW_REQUIRED',
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
        }),
      )
      .mockResolvedValueOnce({
        ...buildAlert({
          status: ComplianceAlertStatus.CLOSED,
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'DEPOSIT',
          sourceId: 'dep-1',
          sourceNo: 'DEP0001',
          entityType: 'KYT_CASE',
          entityId: 'kyt-1',
          entityNo: 'KYT0001',
          stage: 'REVIEW_KYT',
          ruleCode: 'TX_KYT_REVIEW_REQUIRED',
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          currentDispositionCode: 'FALSE_POSITIVE',
          finalDispositionCode: 'FALSE_POSITIVE',
          decisionRecordIds: JSON.stringify(['decision-1']),
        }),
        events: [],
        dispositionRecords: [],
      });
    prismaMock.complianceAlert.update.mockResolvedValue(
      buildAlert({
        status: ComplianceAlertStatus.CLOSED,
        sourceModule: 'risk-engine/transaction-compliance',
        sourceType: 'DEPOSIT',
        sourceId: 'dep-1',
        sourceNo: 'DEP0001',
        entityType: 'KYT_CASE',
        entityId: 'kyt-1',
        entityNo: 'KYT0001',
        stage: 'REVIEW_KYT',
        ruleCode: 'TX_KYT_REVIEW_REQUIRED',
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
        currentDispositionCode: 'FALSE_POSITIVE',
        finalDispositionCode: 'FALSE_POSITIVE',
        decisionRecordIds: JSON.stringify(['decision-1']),
      }),
    );
    workflowTransitionServiceMock.transition.mockResolvedValue({
      transitionCode: 'TX_DEPOSIT_CLEAR_TO_SUCCESS',
      executed: true,
    });

    const result = await service.applyAction(
      'alert-1',
      {
        action: ComplianceAlertAction.CLOSE,
        reason: 'false positive',
        dispositionCode: 'FALSE_POSITIVE',
        decision: 'CLEAR',
        finalizeDisposition: true,
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'ADMIN',
      },
      prismaMock,
    );

    expect(result.status).toBe(ComplianceAlertStatus.CLOSED);
    expect(workflowTransitionServiceMock.transition).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        workflow: 'TRANSACTION',
        producerType: 'ALERT',
        producerId: 'alert-1',
        sourceId: 'dep-1',
        sourceType: 'DEPOSIT',
        dispositionCode: 'CLEAR',
      }),
    );
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

  it('should expose primary object and assign-only handling for OPEN alert detail', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue({
      ...buildAlert({
        status: ComplianceAlertStatus.OPEN,
        assigneeUserId: null,
        assigneeUserNo: null,
      }),
      events: [],
      dispositionRecords: [],
    });

    const result = await service.findOne('alert-1', {
      actorType: 'ADMIN',
      actorId: 'admin-9',
      actorNo: 'US0009',
      actorRole: 'COMPLIANCE_LEAD',
    });

    expect(result.primaryObject).toEqual({
      type: 'ONBOARDING_JOURNEY',
      id: 'journey-1',
      no: 'ONB0001',
      label: 'Onboarding Journey',
    });
    expect(result.availableHandlingActions).toEqual(['ASSIGN']);
    expect(result.availableDirectProposals).toEqual([]);
  });

  it('should hide handling actions for non-assignee on ASSIGNED alert detail', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue({
      ...buildAlert({
        status: ComplianceAlertStatus.ASSIGNED,
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
      }),
      events: [],
      dispositionRecords: [],
    });

    const result = await service.findOne('alert-1', {
      actorType: 'ADMIN',
      actorId: 'admin-2',
      actorNo: 'US0002',
      actorRole: 'COMPLIANCE_LEAD',
    });

    expect(result.availableHandlingActions).toEqual([]);
    expect(result.availableDirectProposals).toEqual([]);
  });

  it('should expose direct disposition proposals for assignee on onboarding CDD alert', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue({
      ...buildAlert({
        status: ComplianceAlertStatus.ASSIGNED,
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
      }),
      events: [],
      dispositionRecords: [],
    });

    const result = await service.findOne('alert-1', {
      actorType: 'ADMIN',
      actorId: 'admin-1',
      actorNo: 'US0001',
      actorRole: 'COMPLIANCE_LEAD',
    });

    expect(result.availableHandlingActions).toEqual([
      'REASSIGN',
      'FALSE_POSITIVE',
      'DIRECT_DISPOSITION',
      'ESCALATE_TO_CASE',
    ]);
    expect(result.availableDirectProposals).toEqual(['REJECT', 'REQUIRE_EDD']);
  });

  it('should expose reject-only proposal for periodic review EDD alert', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue({
      ...buildAlert({
        sourceModule: 'identity/periodic-review',
        sourceType: 'PERIODIC_REVIEW_CYCLE',
        sourceId: 'cycle-1',
        sourceNo: 'PRR0001',
        journeyId: null,
        stage: 'REVIEW_EDD',
        ruleCode: 'PRR_EDD_REVIEW_REQUIRED',
        status: ComplianceAlertStatus.ASSIGNED,
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
      }),
      events: [],
      dispositionRecords: [],
    });

    const result = await service.findOne('alert-1', {
      actorType: 'ADMIN',
      actorId: 'admin-1',
      actorNo: 'US0001',
      actorRole: 'COMPLIANCE_LEAD',
    });

    expect(result.primaryObject).toEqual({
      type: 'PERIODIC_REVIEW_CYCLE',
      id: 'cycle-1',
      no: 'PRR0001',
      label: 'Periodic Review Cycle',
    });
    expect(result.availableDirectProposals).toEqual(['REJECT']);
  });

  it('should expose reject and freeze proposals for deposit alert detail', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue({
      ...buildAlert({
        sourceModule: 'risk-engine/transaction-compliance',
        sourceType: 'DEPOSIT',
        sourceId: 'dep-1',
        sourceNo: 'DEP0001',
        entityType: 'DEPOSIT_TRANSACTION',
        entityId: 'dep-1',
        entityNo: 'DEP0001',
        journeyId: null,
        stage: 'REVIEW_DEPOSIT_FINAL',
        ruleCode: 'TX_DEPOSIT_FINAL_REVIEW_REQUIRED',
        status: ComplianceAlertStatus.ASSIGNED,
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
      }),
      events: [],
      dispositionRecords: [],
    });

    const result = await service.findOne('alert-1', {
      actorType: 'ADMIN',
      actorId: 'admin-1',
      actorNo: 'US0001',
      actorRole: 'COMPLIANCE_LEAD',
    });

    expect(result.primaryObject).toEqual({
      type: 'DEPOSIT',
      id: 'dep-1',
      no: 'DEP0001',
      label: 'Deposit',
    });
    expect(result.availableDirectProposals).toEqual(['REJECT', 'FREEZE_TRANSACTION']);
  });

  it('should delegate onboarding false positive resolution to onboarding service', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue(
      buildAlert({
        status: ComplianceAlertStatus.ASSIGNED,
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
      }),
    );
    onboardingServiceMock.applyOnboardingDecisionFromAlert.mockResolvedValue({
      alert: { id: 'alert-1', status: 'CLOSED' },
    });

    const result = await service.resolveAlert(
      'alert-1',
      { resolutionType: 'FALSE_POSITIVE' as any },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'COMPLIANCE_LEAD',
      },
    );

    expect(onboardingServiceMock.applyOnboardingDecisionFromAlert).toHaveBeenCalledWith(
      'alert-1',
      'admin-1',
      'COMPLIANCE_LEAD',
      expect.objectContaining({
        decision: 'CLEAR',
        alertOutcome: 'FALSE_POSITIVE',
      }),
    );
    expect(result).toEqual({ id: 'alert-1', status: 'CLOSED' });
  });

  it('should resolve deposit false positive via canonical resolution helper without routing through applyAction', async () => {
    prismaMock.$transaction = jest.fn(async (callback: (tx: any) => unknown) => callback(prismaMock));
    const applyActionSpy = jest.spyOn(service, 'applyAction');
    prismaMock.complianceAlert.findUnique
      .mockResolvedValueOnce(
        buildAlert({
          status: ComplianceAlertStatus.ASSIGNED,
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'DEPOSIT',
          sourceId: 'dep-1',
          sourceNo: 'DEP0001',
          entityType: 'KYT_CASE',
          entityId: 'kyt-1',
          entityNo: 'KYT0001',
          stage: 'REVIEW_KYT',
          ruleCode: 'TX_KYT_REVIEW_REQUIRED',
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          decisionRecordIds: JSON.stringify(['decision-1']),
        }),
      )
      .mockResolvedValueOnce(
        buildAlert({
          status: ComplianceAlertStatus.ASSIGNED,
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'DEPOSIT',
          sourceId: 'dep-1',
          sourceNo: 'DEP0001',
          entityType: 'KYT_CASE',
          entityId: 'kyt-1',
          entityNo: 'KYT0001',
          stage: 'REVIEW_KYT',
          ruleCode: 'TX_KYT_REVIEW_REQUIRED',
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          decisionRecordIds: JSON.stringify(['decision-1']),
        }),
      )
      .mockResolvedValueOnce({
        ...buildAlert({
          status: ComplianceAlertStatus.CLOSED,
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'DEPOSIT',
          sourceId: 'dep-1',
          sourceNo: 'DEP0001',
          entityType: 'KYT_CASE',
          entityId: 'kyt-1',
          entityNo: 'KYT0001',
          stage: 'REVIEW_KYT',
          ruleCode: 'TX_KYT_REVIEW_REQUIRED',
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          currentDispositionCode: 'FALSE_POSITIVE',
          finalDispositionCode: 'FALSE_POSITIVE',
          decision: 'FALSE_POSITIVE',
          decisionRecordIds: JSON.stringify(['decision-1']),
        }),
        events: [],
        dispositionRecords: [],
      });
    prismaMock.complianceAlert.update.mockResolvedValue(
      buildAlert({
        status: ComplianceAlertStatus.CLOSED,
        sourceModule: 'risk-engine/transaction-compliance',
        sourceType: 'DEPOSIT',
        sourceId: 'dep-1',
        sourceNo: 'DEP0001',
        entityType: 'KYT_CASE',
        entityId: 'kyt-1',
        entityNo: 'KYT0001',
        stage: 'REVIEW_KYT',
        ruleCode: 'TX_KYT_REVIEW_REQUIRED',
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
        currentDispositionCode: 'FALSE_POSITIVE',
        finalDispositionCode: 'FALSE_POSITIVE',
        decision: 'FALSE_POSITIVE',
        decisionRecordIds: JSON.stringify(['decision-1']),
      }),
    );
    workflowTransitionServiceMock.transition.mockResolvedValue({
      transitionCode: 'TX_DEPOSIT_CLEAR_TO_SUCCESS',
      executed: true,
    });

    const result = await service.resolveAlert(
      'alert-1',
      { resolutionType: 'FALSE_POSITIVE' as any },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'COMPLIANCE_LEAD',
      },
    );

    expect(applyActionSpy).not.toHaveBeenCalled();
    expect(workflowTransitionServiceMock.transition).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        workflow: 'TRANSACTION',
        sourceId: 'dep-1',
        sourceType: 'DEPOSIT',
        dispositionCode: 'CLEAR',
        latestDecisionRecordId: 'decision-1',
      }),
    );
    expect(result.status).toBe(ComplianceAlertStatus.CLOSED);
  });

  it('should reject direct disposition without reason', async () => {
    prismaMock.complianceAlert.findUnique.mockResolvedValue(
      buildAlert({
        status: ComplianceAlertStatus.ASSIGNED,
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
      }),
    );

    await expect(
      service.resolveAlert(
        'alert-1',
        {
          resolutionType: 'DIRECT_DISPOSITION' as any,
          proposalCode: 'REJECT',
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorNo: 'US0001',
          actorRole: 'COMPLIANCE_LEAD',
        },
      ),
    ).rejects.toThrow('requires a reason');
  });

  it('should resolve deposit alert by rejecting the deposit and closing the alert', async () => {
    prismaMock.$transaction = jest.fn(async (callback: (tx: any) => unknown) => callback(prismaMock));
    prismaMock.complianceAlert.findUnique
      .mockResolvedValueOnce(
        buildAlert({
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'DEPOSIT',
          sourceId: 'dep-1',
          sourceNo: 'DEP0001',
          entityType: 'DEPOSIT_TRANSACTION',
          entityId: 'dep-1',
          entityNo: 'DEP0001',
          journeyId: null,
          stage: 'REVIEW_DEPOSIT_FINAL',
          ruleCode: 'TX_DEPOSIT_FINAL_REVIEW_REQUIRED',
          status: ComplianceAlertStatus.ASSIGNED,
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          decisionRecordIds: JSON.stringify(['decision-1']),
        }),
      )
      .mockResolvedValueOnce(
        buildAlert({
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'DEPOSIT',
          sourceId: 'dep-1',
          sourceNo: 'DEP0001',
          entityType: 'DEPOSIT_TRANSACTION',
          entityId: 'dep-1',
          entityNo: 'DEP0001',
          journeyId: null,
          stage: 'REVIEW_DEPOSIT_FINAL',
          ruleCode: 'TX_DEPOSIT_FINAL_REVIEW_REQUIRED',
          status: ComplianceAlertStatus.ASSIGNED,
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          decisionRecordIds: JSON.stringify(['decision-1']),
        }),
      )
      .mockResolvedValueOnce({
        ...buildAlert({
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'DEPOSIT',
          sourceId: 'dep-1',
          sourceNo: 'DEP0001',
          entityType: 'DEPOSIT_TRANSACTION',
          entityId: 'dep-1',
          entityNo: 'DEP0001',
          journeyId: null,
          stage: 'REVIEW_DEPOSIT_FINAL',
          ruleCode: 'TX_DEPOSIT_FINAL_REVIEW_REQUIRED',
          status: ComplianceAlertStatus.CLOSED,
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          decision: 'REJECT',
          currentDispositionCode: 'RESOLVED_BY_WORKFLOW',
          finalDispositionCode: 'RESOLVED_BY_WORKFLOW',
          decisionRecordIds: JSON.stringify(['decision-1']),
        }),
        events: [],
        dispositionRecords: [],
      });
    prismaMock.complianceAlert.update.mockResolvedValue(
      buildAlert({
        sourceModule: 'risk-engine/transaction-compliance',
        sourceType: 'DEPOSIT',
        sourceId: 'dep-1',
        sourceNo: 'DEP0001',
        entityType: 'DEPOSIT_TRANSACTION',
        entityId: 'dep-1',
        entityNo: 'DEP0001',
        journeyId: null,
        stage: 'REVIEW_DEPOSIT_FINAL',
        ruleCode: 'TX_DEPOSIT_FINAL_REVIEW_REQUIRED',
        status: ComplianceAlertStatus.CLOSED,
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
        decision: 'REJECT',
        currentDispositionCode: 'RESOLVED_BY_WORKFLOW',
        finalDispositionCode: 'RESOLVED_BY_WORKFLOW',
      }),
    );
    workflowTransitionServiceMock.transition.mockResolvedValue({
      transitionCode: 'TX_DEPOSIT_REJECT_TO_REJECTED',
      executed: true,
    });

    const result = await service.resolveAlert(
      'alert-1',
      {
        resolutionType: 'DIRECT_DISPOSITION' as any,
        proposalCode: 'REJECT',
        reason: 'risk confirmed',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'COMPLIANCE_LEAD',
      },
    );

    expect(prismaMock.complianceAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ComplianceAlertStatus.CLOSED,
          decision: 'REJECT',
          currentDispositionCode: 'RESOLVED_BY_WORKFLOW',
        }),
      }),
    );
    expect(workflowTransitionServiceMock.transition).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        workflow: 'TRANSACTION',
        producerType: 'ALERT',
        producerId: 'alert-1',
        sourceId: 'dep-1',
        sourceType: 'DEPOSIT',
        dispositionCode: 'REJECT',
      }),
    );
    expect(result.status).toBe(ComplianceAlertStatus.CLOSED);
  });

  it('should resolve swap false positive via workflow transition service', async () => {
    prismaMock.$transaction = jest.fn(async (callback: (tx: any) => unknown) => callback(prismaMock));
    prismaMock.complianceAlert.findUnique
      .mockResolvedValueOnce(
        buildAlert({
          status: ComplianceAlertStatus.ASSIGNED,
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'SWAP',
          sourceId: 'swap-1',
          sourceNo: 'SWP0001',
          entityType: 'SWAP_TRANSACTION',
          entityId: 'swap-1',
          entityNo: 'SWP0001',
          journeyId: null,
          stage: 'REVIEW_SWAP_FINAL',
          ruleCode: 'TX_SWAP_FINAL_REVIEW_REQUIRED',
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          decisionRecordIds: JSON.stringify(['decision-swap-1']),
        }),
      )
      .mockResolvedValueOnce(
        buildAlert({
          status: ComplianceAlertStatus.ASSIGNED,
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'SWAP',
          sourceId: 'swap-1',
          sourceNo: 'SWP0001',
          entityType: 'SWAP_TRANSACTION',
          entityId: 'swap-1',
          entityNo: 'SWP0001',
          journeyId: null,
          stage: 'REVIEW_SWAP_FINAL',
          ruleCode: 'TX_SWAP_FINAL_REVIEW_REQUIRED',
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          decisionRecordIds: JSON.stringify(['decision-swap-1']),
        }),
      )
      .mockResolvedValueOnce({
        ...buildAlert({
          status: ComplianceAlertStatus.CLOSED,
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'SWAP',
          sourceId: 'swap-1',
          sourceNo: 'SWP0001',
          entityType: 'SWAP_TRANSACTION',
          entityId: 'swap-1',
          entityNo: 'SWP0001',
          journeyId: null,
          stage: 'REVIEW_SWAP_FINAL',
          ruleCode: 'TX_SWAP_FINAL_REVIEW_REQUIRED',
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          currentDispositionCode: 'FALSE_POSITIVE',
          finalDispositionCode: 'FALSE_POSITIVE',
          decision: 'FALSE_POSITIVE',
          decisionRecordIds: JSON.stringify(['decision-swap-1']),
        }),
        events: [],
        dispositionRecords: [],
      });
    prismaMock.complianceAlert.update.mockResolvedValue(
      buildAlert({
        status: ComplianceAlertStatus.CLOSED,
        sourceModule: 'risk-engine/transaction-compliance',
        sourceType: 'SWAP',
        sourceId: 'swap-1',
        sourceNo: 'SWP0001',
        entityType: 'SWAP_TRANSACTION',
        entityId: 'swap-1',
        entityNo: 'SWP0001',
        journeyId: null,
        stage: 'REVIEW_SWAP_FINAL',
        ruleCode: 'TX_SWAP_FINAL_REVIEW_REQUIRED',
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
        currentDispositionCode: 'FALSE_POSITIVE',
        finalDispositionCode: 'FALSE_POSITIVE',
        decision: 'FALSE_POSITIVE',
        decisionRecordIds: JSON.stringify(['decision-swap-1']),
      }),
    );
    workflowTransitionServiceMock.transition.mockResolvedValue({
      transitionCode: 'TX_SWAP_CLEAR_TO_SUCCESS',
      executed: true,
    });

    const result = await service.resolveAlert(
      'alert-1',
      { resolutionType: 'FALSE_POSITIVE' as any },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'COMPLIANCE_LEAD',
      },
    );

    expect(workflowTransitionServiceMock.transition).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        workflow: 'TRANSACTION',
        stage: 'REVIEW_SWAP_FINAL',
        producerType: 'ALERT',
        producerId: 'alert-1',
        sourceId: 'swap-1',
        sourceType: 'SWAP',
        dispositionCode: 'CLEAR',
        latestDecisionRecordId: 'decision-swap-1',
      }),
    );
    expect(result.status).toBe(ComplianceAlertStatus.CLOSED);
  });

  it('should defer withdraw false positive workflow transition until after transaction commit', async () => {
    let inTransaction = false;
    prismaMock.$transaction = jest.fn(async (callback: (tx: any) => unknown) => {
      inTransaction = true;
      const result = await callback(prismaMock);
      inTransaction = false;
      return result;
    });
    prismaMock.complianceAlert.findUnique
      .mockResolvedValueOnce(
        buildAlert({
          status: ComplianceAlertStatus.ASSIGNED,
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'WITHDRAW',
          sourceId: 'wd-1',
          sourceNo: 'WD0001',
          entityType: 'WITHDRAW_TRANSACTION',
          entityId: 'wd-1',
          entityNo: 'WD0001',
          journeyId: null,
          stage: 'REVIEW_WITHDRAW_FINAL',
          ruleCode: 'TX_WITHDRAW_FINAL_REVIEW_REQUIRED',
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          decisionRecordIds: JSON.stringify(['decision-wd-1']),
        }),
      )
      .mockResolvedValueOnce(
        buildAlert({
          status: ComplianceAlertStatus.ASSIGNED,
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'WITHDRAW',
          sourceId: 'wd-1',
          sourceNo: 'WD0001',
          entityType: 'WITHDRAW_TRANSACTION',
          entityId: 'wd-1',
          entityNo: 'WD0001',
          journeyId: null,
          stage: 'REVIEW_WITHDRAW_FINAL',
          ruleCode: 'TX_WITHDRAW_FINAL_REVIEW_REQUIRED',
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          decisionRecordIds: JSON.stringify(['decision-wd-1']),
        }),
      )
      .mockResolvedValueOnce({
        ...buildAlert({
          status: ComplianceAlertStatus.CLOSED,
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'WITHDRAW',
          sourceId: 'wd-1',
          sourceNo: 'WD0001',
          entityType: 'WITHDRAW_TRANSACTION',
          entityId: 'wd-1',
          entityNo: 'WD0001',
          journeyId: null,
          stage: 'REVIEW_WITHDRAW_FINAL',
          ruleCode: 'TX_WITHDRAW_FINAL_REVIEW_REQUIRED',
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          currentDispositionCode: 'FALSE_POSITIVE',
          finalDispositionCode: 'FALSE_POSITIVE',
          decision: 'FALSE_POSITIVE',
          decisionRecordIds: JSON.stringify(['decision-wd-1']),
        }),
        events: [],
        dispositionRecords: [],
      })
      .mockResolvedValueOnce({
        ...buildAlert({
          status: ComplianceAlertStatus.CLOSED,
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'WITHDRAW',
          sourceId: 'wd-1',
          sourceNo: 'WD0001',
          entityType: 'WITHDRAW_TRANSACTION',
          entityId: 'wd-1',
          entityNo: 'WD0001',
          journeyId: null,
          stage: 'REVIEW_WITHDRAW_FINAL',
          ruleCode: 'TX_WITHDRAW_FINAL_REVIEW_REQUIRED',
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          currentDispositionCode: 'FALSE_POSITIVE',
          finalDispositionCode: 'FALSE_POSITIVE',
          decision: 'FALSE_POSITIVE',
          decisionRecordIds: JSON.stringify(['decision-wd-1']),
        }),
        events: [],
        dispositionRecords: [],
      });
    prismaMock.complianceAlert.update.mockResolvedValue(
      buildAlert({
        status: ComplianceAlertStatus.CLOSED,
        sourceModule: 'risk-engine/transaction-compliance',
        sourceType: 'WITHDRAW',
        sourceId: 'wd-1',
        sourceNo: 'WD0001',
        entityType: 'WITHDRAW_TRANSACTION',
        entityId: 'wd-1',
        entityNo: 'WD0001',
        journeyId: null,
        stage: 'REVIEW_WITHDRAW_FINAL',
        ruleCode: 'TX_WITHDRAW_FINAL_REVIEW_REQUIRED',
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
        currentDispositionCode: 'FALSE_POSITIVE',
        finalDispositionCode: 'FALSE_POSITIVE',
        decision: 'FALSE_POSITIVE',
        decisionRecordIds: JSON.stringify(['decision-wd-1']),
      }),
    );
    const transitionCallStates: boolean[] = [];
    workflowTransitionServiceMock.transition.mockImplementation(async () => {
      transitionCallStates.push(inTransaction);
      return {
        transitionCode: 'TX_WITHDRAW_CLEAR_TO_PAYOUT_PENDING',
        executed: true,
      };
    });

    const result = await service.resolveAlert(
      'alert-1',
      { resolutionType: 'FALSE_POSITIVE' as any },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'COMPLIANCE_LEAD',
      },
    );

    expect(transitionCallStates).toEqual([false]);
    expect(workflowTransitionServiceMock.transition).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        workflow: 'TRANSACTION',
        stage: 'REVIEW_WITHDRAW_FINAL',
        producerType: 'ALERT',
        producerId: 'alert-1',
        sourceId: 'wd-1',
        sourceType: 'WITHDRAW',
        dispositionCode: 'CLEAR',
        latestDecisionRecordId: 'decision-wd-1',
      }),
    );
    expect(result.status).toBe(ComplianceAlertStatus.CLOSED);
  });

  it('should resolve swap alert by rejecting swap through workflow transition service', async () => {
    prismaMock.$transaction = jest.fn(async (callback: (tx: any) => unknown) => callback(prismaMock));
    prismaMock.complianceAlert.findUnique
      .mockResolvedValueOnce(
        buildAlert({
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'SWAP',
          sourceId: 'swap-1',
          sourceNo: 'SWP0001',
          entityType: 'SWAP_TRANSACTION',
          entityId: 'swap-1',
          entityNo: 'SWP0001',
          journeyId: null,
          stage: 'REVIEW_SWAP_FINAL',
          ruleCode: 'TX_SWAP_FINAL_REVIEW_REQUIRED',
          status: ComplianceAlertStatus.ASSIGNED,
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          decisionRecordIds: JSON.stringify(['decision-swap-2']),
        }),
      )
      .mockResolvedValueOnce(
        buildAlert({
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'SWAP',
          sourceId: 'swap-1',
          sourceNo: 'SWP0001',
          entityType: 'SWAP_TRANSACTION',
          entityId: 'swap-1',
          entityNo: 'SWP0001',
          journeyId: null,
          stage: 'REVIEW_SWAP_FINAL',
          ruleCode: 'TX_SWAP_FINAL_REVIEW_REQUIRED',
          status: ComplianceAlertStatus.ASSIGNED,
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          decisionRecordIds: JSON.stringify(['decision-swap-2']),
        }),
      )
      .mockResolvedValueOnce({
        ...buildAlert({
          sourceModule: 'risk-engine/transaction-compliance',
          sourceType: 'SWAP',
          sourceId: 'swap-1',
          sourceNo: 'SWP0001',
          entityType: 'SWAP_TRANSACTION',
          entityId: 'swap-1',
          entityNo: 'SWP0001',
          journeyId: null,
          stage: 'REVIEW_SWAP_FINAL',
          ruleCode: 'TX_SWAP_FINAL_REVIEW_REQUIRED',
          status: ComplianceAlertStatus.CLOSED,
          assigneeUserId: 'admin-1',
          assigneeUserNo: 'US0001',
          decision: 'REJECT',
          currentDispositionCode: 'RESOLVED_BY_WORKFLOW',
          finalDispositionCode: 'RESOLVED_BY_WORKFLOW',
          decisionRecordIds: JSON.stringify(['decision-swap-2']),
        }),
        events: [],
        dispositionRecords: [],
      });
    prismaMock.complianceAlert.update.mockResolvedValue(
      buildAlert({
        sourceModule: 'risk-engine/transaction-compliance',
        sourceType: 'SWAP',
        sourceId: 'swap-1',
        sourceNo: 'SWP0001',
        entityType: 'SWAP_TRANSACTION',
        entityId: 'swap-1',
        entityNo: 'SWP0001',
        journeyId: null,
        stage: 'REVIEW_SWAP_FINAL',
        ruleCode: 'TX_SWAP_FINAL_REVIEW_REQUIRED',
        status: ComplianceAlertStatus.CLOSED,
        assigneeUserId: 'admin-1',
        assigneeUserNo: 'US0001',
        decision: 'REJECT',
        currentDispositionCode: 'RESOLVED_BY_WORKFLOW',
        finalDispositionCode: 'RESOLVED_BY_WORKFLOW',
        decisionRecordIds: JSON.stringify(['decision-swap-2']),
      }),
    );
    workflowTransitionServiceMock.transition.mockResolvedValue({
      transitionCode: 'TX_SWAP_REJECT_TO_REJECTED',
      executed: true,
    });

    const result = await service.resolveAlert(
      'alert-1',
      {
        resolutionType: 'DIRECT_DISPOSITION' as any,
        proposalCode: 'REJECT',
        reason: 'risk confirmed',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'COMPLIANCE_LEAD',
      },
    );

    expect(workflowTransitionServiceMock.transition).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        workflow: 'TRANSACTION',
        stage: 'REVIEW_SWAP_FINAL',
        producerType: 'ALERT',
        producerId: 'alert-1',
        sourceId: 'swap-1',
        sourceType: 'SWAP',
        dispositionCode: 'REJECT',
        latestDecisionRecordId: 'decision-swap-2',
      }),
    );
    expect(result.status).toBe(ComplianceAlertStatus.CLOSED);
  });

  it('should escalate alert to case through compliance incidents service', async () => {
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
          linkedCaseIds: JSON.stringify(['case-1']),
          currentDispositionCode: 'ESCALATE_TO_CASE',
          finalDispositionCode: 'ESCALATE_TO_CASE',
        }),
        events: [],
        dispositionRecords: [],
      });
    complianceIncidentsServiceMock.createFromAlert.mockResolvedValue({ id: 'case-1' });

    const result = await service.resolveAlert(
      'alert-1',
      {
        resolutionType: 'ESCALATE_TO_CASE' as any,
        reason: 'needs formal investigation',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'COMPLIANCE_LEAD',
      },
    );

    expect(complianceIncidentsServiceMock.createFromAlert).toHaveBeenCalledWith(
      'alert-1',
      { reason: 'needs formal investigation' },
      expect.objectContaining({
        actorId: 'admin-1',
      }),
    );
    expect(result.status).toBe(ComplianceAlertStatus.ESCALATED);
  });
});
