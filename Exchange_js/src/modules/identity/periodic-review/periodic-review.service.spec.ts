import { PeriodicReviewService } from './periodic-review.service';

describe('PeriodicReviewService', () => {
  const prismaMock: any = {
    customerMain: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const complianceAlertsServiceMock: any = {};
  const complianceIncidentsServiceMock: any = {};
  const riskEngineServiceMock: any = {};
  const riskDecisionOrchestratorServiceMock: any = {};
  const workflowTransitionServiceMock: any = {};

  let service: PeriodicReviewService;

  beforeEach(() => {
    jest.clearAllMocks();
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
});
