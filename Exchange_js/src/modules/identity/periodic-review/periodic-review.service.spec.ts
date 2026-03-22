import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
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
    cddResponse: {
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
  const riskEngineServiceMock: any = {};
  const riskDecisionOrchestratorServiceMock: any = {};
  const workflowTransitionServiceMock: any = {};

  let service: PeriodicReviewService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AuditLogsService.prototype, 'recordByActor').mockResolvedValue({} as any);
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
});
