import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import { AuditTriggerType } from '../../risk-engine/audit-logs/dto/audit-log.dto';
import { PeriodicReviewService } from './periodic-review.service';

describe('PeriodicReviewService', () => {
  const prismaMock: any = {
    customerMain: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    periodicReviewCycle: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    complianceSession: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    cddResponse: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    eddResponse: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    cddResponseReport: {
      create: jest.fn(),
    },
    eddResponseReport: {
      create: jest.fn(),
    },
    onboardingAuditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const complianceAlertsServiceMock: any = {
    triggerSystemAlert: jest.fn(),
  };
  const complianceIncidentsServiceMock: any = {
    createFromAlertInTransaction: jest.fn(),
    applyActionInTransaction: jest.fn(),
  };
  const riskEngineServiceMock: any = {
    evaluate: jest.fn(),
    createPendingDecisionRecord: jest.fn(),
    completeDecisionRecord: jest.fn(),
  };
  const riskDecisionOrchestratorServiceMock: any = {
    orchestrate: jest.fn(),
  };
  const workflowTransitionServiceMock: any = {};

  let service: PeriodicReviewService;
  let recordByActorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    recordByActorSpy = jest
      .spyOn(AuditLogsService.prototype, 'recordByActor')
      .mockResolvedValue({} as any);
    prismaMock.$transaction.mockImplementation(async (callback: (tx: any) => unknown) =>
      callback(prismaMock),
    );
    service = new PeriodicReviewService(
      prismaMock,
      complianceAlertsServiceMock,
      complianceIncidentsServiceMock,
      riskEngineServiceMock,
      riskDecisionOrchestratorServiceMock,
      workflowTransitionServiceMock,
    );
  });

  it('should derive WAIT_REVIEW next step for periodic review under review state', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      activePeriodicReviewCycle: {
        id: 'prr-1',
        status: 'CDD_UNDER_REVIEW',
        currentCddResponseId: 'cdd-1',
        currentEddResponseId: null,
      },
    });

    const result = await service.getNextStep('c1');

    expect(result.status).toBe('CDD_UNDER_REVIEW');
    expect(result.actions).toEqual([{ type: 'WAIT_REVIEW' }]);
    expect(result.blockedReason).toBe('WAIT_COMPLIANCE_REVIEW');
    expect(result.activeCaseId).toBe('cdd-1');
    expect(result.requiresEdd).toBe(false);
  });

  it('should aggregate created and blocked counts during sweep', async () => {
    prismaMock.customerMain.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    const createSpy = jest
      .spyOn(service as any, 'createPeriodicReviewCycle')
      .mockResolvedValueOnce({ created: true, blocked: false })
      .mockResolvedValueOnce({ created: false, blocked: true });

    const result = await service.sweepDueCustomers(new Date('2026-03-18T00:00:00.000Z'));

    expect(prismaMock.customerMain.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          onboardingStatus: 'APPROVED',
          operatingStatus: 'ACTIVE',
          activePeriodicReviewCycleId: null,
        }),
      }),
    );
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ createdCount: 1, blockedCount: 1 });
  });

  it('should create periodic review case and restriction inside the same transaction chain', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'APPROVED',
      operatingStatus: 'ACTIVE',
      restrictionStatus: 'CLEAR',
      complianceHoldStatus: 'ACTIVE',
      activePeriodicReviewCycleId: null,
      nextReviewAt: new Date('2026-03-21T08:00:00.000Z'),
      periodicReviewOverdueAt: null,
      periodicReviewOverdueReason: null,
    });
    prismaMock.periodicReviewCycle.create.mockResolvedValue({
      id: 'cycle-1',
      cycleNo: 'PRR0001',
      status: 'PENDING_CDD_INPUT',
    });
    prismaMock.cddResponse.create.mockResolvedValue({ id: 'cdd-1' });
    complianceAlertsServiceMock.triggerSystemAlert.mockResolvedValue({ id: 'alert-1' });
    complianceIncidentsServiceMock.createFromAlertInTransaction.mockResolvedValue('case-1');
    complianceIncidentsServiceMock.applyActionInTransaction.mockResolvedValue('case-1');
    prismaMock.periodicReviewCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      cycleNo: 'PRR0001',
      status: 'PENDING_CDD_INPUT',
    });

    const result = await service.triggerPeriodicReview('c1', 'admin-1', 'COMPLIANCE_LEAD', 'due');

    expect(complianceIncidentsServiceMock.createFromAlertInTransaction).toHaveBeenCalledWith(
      prismaMock,
      'alert-1',
      expect.objectContaining({ reason: 'due' }),
      expect.objectContaining({ actorId: 'SYSTEM' }),
    );
    expect(complianceIncidentsServiceMock.applyActionInTransaction).toHaveBeenCalledWith(
      prismaMock,
      'case-1',
      expect.objectContaining({ action: 'RESTRICT', reason: 'due' }),
      expect.objectContaining({ actorId: 'SYSTEM' }),
    );
    expect(prismaMock.periodicReviewCycle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          primaryAlertId: 'alert-1',
          primaryIncidentId: 'case-1',
        }),
      }),
    );
    expect(result.created).toBe(true);
  });

  it('should record periodic review session creation as DATA_CREATE audit', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({ id: 'c1', customerNo: 'CU0001' });
    prismaMock.cddResponse.findUnique.mockResolvedValue({
      id: 'case-1',
      customerId: 'c1',
      workflow: 'PERIODIC_REVIEW',
      status: 'CREATED',
      periodicReviewCycleId: 'cycle-1',
      journeyId: 'PRR0001',
    });
    prismaMock.complianceSession.findFirst.mockResolvedValue(null);
    prismaMock.complianceSession.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.complianceSession.create.mockResolvedValue({
      id: 'ses-1',
      providerSessionId: 'SES2602010001',
      caseType: 'CDD',
      caseId: 'case-1',
      qrCodeUrl: 'mock://compliance/SES2602010001',
      expiresAt: new Date('2026-03-02T00:00:00.000Z'),
      status: 'PENDING',
    });

    const result = await service.createResponseSession('c1', 'c1', 'case-1', {
      responseType: 'CDD',
      provider: 'MOCK',
    });

    expect(result).toEqual(
      expect.objectContaining({
        responseType: 'CDD',
      }),
    );
    expect(recordByActorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CDD_PERIODIC_REVIEW_SESSION_CREATED',
        triggerType: AuditTriggerType.DATA_CREATE,
      }),
      expect.anything(),
    );
  });

  it('should abort the periodic review transaction when case creation fails', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'APPROVED',
      operatingStatus: 'ACTIVE',
      restrictionStatus: 'CLEAR',
      complianceHoldStatus: 'ACTIVE',
      activePeriodicReviewCycleId: null,
      nextReviewAt: new Date('2026-03-21T08:00:00.000Z'),
      periodicReviewOverdueAt: null,
      periodicReviewOverdueReason: null,
    });
    prismaMock.periodicReviewCycle.create.mockResolvedValue({
      id: 'cycle-1',
      cycleNo: 'PRR0001',
      status: 'PENDING_CDD_INPUT',
    });
    prismaMock.cddResponse.create.mockResolvedValue({ id: 'cdd-1' });
    complianceAlertsServiceMock.triggerSystemAlert.mockResolvedValue({ id: 'alert-1' });
    complianceIncidentsServiceMock.createFromAlertInTransaction.mockRejectedValue(
      new Error('case create failed'),
    );

    await expect(
      service.triggerPeriodicReview('c1', 'admin-1', 'COMPLIANCE_LEAD', 'due'),
    ).rejects.toThrow('case create failed');

    expect(complianceIncidentsServiceMock.applyActionInTransaction).not.toHaveBeenCalled();
    expect(prismaMock.periodicReviewCycle.update).not.toHaveBeenCalled();
    expect(prismaMock.customerMain.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          activePeriodicReviewCycleId: expect.anything(),
        }),
      }),
    );
  });

  it('should queue periodic review CDD response for manual simulation instead of evaluating immediately', async () => {
    const now = new Date(Date.now() + 10 * 60 * 1000);
    prismaMock.complianceSession.findFirst.mockResolvedValue({
      id: 'ses-cdd-1',
      customerId: 'c1',
      caseType: 'CDD',
      caseId: 'cdd-1',
      provider: 'MOCK',
      providerSessionId: 'SES2603310001',
      status: 'PENDING',
      expiresAt: now,
    });
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      activePeriodicReviewCycleId: 'cycle-1',
      activePeriodicReviewCycle: {
        id: 'cycle-1',
        cycleNo: 'PRR0001',
        status: 'PENDING_CDD_INPUT',
        currentCddResponseId: 'cdd-1',
        currentEddResponseId: null,
      },
    });
    prismaMock.cddResponse.findUnique.mockResolvedValue({
      id: 'cdd-1',
      customerId: 'c1',
      caseNo: 'CDD2603310001',
      workflow: 'PERIODIC_REVIEW',
      subjectKind: 'INDIVIDUAL_CUSTOMER',
      subjectRefId: 'c1',
      periodicReviewCycleId: 'cycle-1',
      journeyId: 'PRR0001',
    });
    riskEngineServiceMock.createPendingDecisionRecord.mockResolvedValue({
      decisionRecordId: 'dr-prr-cdd-1',
      status: 'CREATED',
    });
    prismaMock.periodicReviewCycle.update.mockResolvedValue({
      id: 'cycle-1',
      cycleNo: 'PRR0001',
      status: 'CDD_UNDER_REVIEW',
      currentCddResponseId: 'cdd-1',
      currentEddResponseId: null,
    });

    const result = await service.mockCompleteSession('c1', 'c1', 'ses-cdd-1', {
      mockDataType: 'MEDIUM_RISK',
    });

    expect(riskEngineServiceMock.createPendingDecisionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        contextType: 'PERIODIC_REVIEW_CDD',
        ownerId: 'c1',
        policyVersion: 'periodic-review-risk-policy/v1',
      }),
    );
    expect(riskEngineServiceMock.evaluate).not.toHaveBeenCalled();
    expect(riskDecisionOrchestratorServiceMock.orchestrate).not.toHaveBeenCalled();
    expect(prismaMock.cddResponse.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cdd-1' },
        data: expect.objectContaining({
          status: 'RECEIVED',
        }),
      }),
    );
    expect(prismaMock.periodicReviewCycle.update).toHaveBeenCalledWith({
      where: { id: 'cycle-1' },
      data: {
        status: 'CDD_UNDER_REVIEW',
        latestDecisionRecordId: 'dr-prr-cdd-1',
        currentCddResponseId: 'cdd-1',
      },
    });
    expect(result.decision).toEqual({
      decisionRecordId: 'dr-prr-cdd-1',
      status: 'CREATED',
      decision: null,
    });
    expect(result.status).toBe('CDD_UNDER_REVIEW');
    expect(result.actions).toEqual([{ type: 'WAIT_REVIEW' }]);
  });

  it('should queue periodic review EDD response for manual simulation instead of evaluating immediately', async () => {
    const now = new Date(Date.now() + 10 * 60 * 1000);
    prismaMock.complianceSession.findFirst.mockResolvedValue({
      id: 'ses-edd-1',
      customerId: 'c1',
      caseType: 'EDD',
      caseId: 'edd-1',
      provider: 'MOCK',
      providerSessionId: 'SES2603310002',
      status: 'PENDING',
      expiresAt: now,
    });
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      activePeriodicReviewCycleId: 'cycle-1',
      activePeriodicReviewCycle: {
        id: 'cycle-1',
        cycleNo: 'PRR0001',
        status: 'PENDING_EDD_INPUT',
        currentCddResponseId: 'cdd-1',
        currentEddResponseId: 'edd-1',
      },
    });
    prismaMock.eddResponse.findUnique.mockResolvedValue({
      id: 'edd-1',
      customerId: 'c1',
      caseNo: 'EDD2603310001',
      workflow: 'PERIODIC_REVIEW',
      subjectKind: 'INDIVIDUAL_CUSTOMER',
      subjectRefId: 'c1',
      periodicReviewCycleId: 'cycle-1',
      journeyId: 'PRR0001',
    });
    riskEngineServiceMock.createPendingDecisionRecord.mockResolvedValue({
      decisionRecordId: 'dr-prr-edd-1',
      status: 'CREATED',
    });
    prismaMock.periodicReviewCycle.update.mockResolvedValue({
      id: 'cycle-1',
      cycleNo: 'PRR0001',
      status: 'EDD_UNDER_REVIEW',
      currentCddResponseId: 'cdd-1',
      currentEddResponseId: 'edd-1',
    });

    const result = await service.mockCompleteSession('c1', 'c1', 'ses-edd-1', {
      result: 'FAIL',
    });

    expect(riskEngineServiceMock.createPendingDecisionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        contextType: 'PERIODIC_REVIEW_EDD',
        ownerId: 'c1',
        policyVersion: 'periodic-review-risk-policy/v1',
      }),
    );
    expect(riskEngineServiceMock.evaluate).not.toHaveBeenCalled();
    expect(riskDecisionOrchestratorServiceMock.orchestrate).not.toHaveBeenCalled();
    expect(prismaMock.eddResponse.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'edd-1' },
        data: expect.objectContaining({
          status: 'RECEIVED',
        }),
      }),
    );
    expect(prismaMock.periodicReviewCycle.update).toHaveBeenCalledWith({
      where: { id: 'cycle-1' },
      data: {
        status: 'EDD_UNDER_REVIEW',
        latestDecisionRecordId: 'dr-prr-edd-1',
        currentEddResponseId: 'edd-1',
      },
    });
    expect(result.decision).toEqual({
      decisionRecordId: 'dr-prr-edd-1',
      status: 'CREATED',
      decision: null,
    });
    expect(result.status).toBe('EDD_UNDER_REVIEW');
    expect(result.actions).toEqual([{ type: 'WAIT_REVIEW' }]);
  });
});
