import { RiskEngineService } from './risk-engine.service';

describe('RiskEngineService', () => {
  const prismaMock: any = {
    onboardingDecisionRecord: {
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  let service: RiskEngineService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.onboardingDecisionRecord.create.mockResolvedValue({ id: 'dr-1' });
    prismaMock.onboardingDecisionRecord.update.mockResolvedValue({ id: 'dr-1' });
    service = new RiskEngineService(prismaMock);
  });

  it('should return REVIEW with onboarding decision options for CDD LOW_RISK mock input', async () => {
    const result = await service.evaluate({
      contextType: 'ONBOARDING_CDD',
      customerId: 'c1',
      subjectId: 'c1',
      signals: {
        mockDataType: 'LOW_RISK',
        riskScore: 26,
        riskLevel: 'LOW',
      },
    });

    expect(result.decision).toBe('REVIEW');
    expect(result.reasonCodes).toEqual(['CDD_LOW_RISK_CLEAR']);
    expect(result.recommendedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'UPSERT_ALERT',
          payload: expect.objectContaining({
            recommendation: 'REVIEW',
          }),
        }),
        expect.objectContaining({
          type: 'ONBOARDING_RECOMMEND_DECISIONS',
          payload: expect.objectContaining({
            decisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'],
          }),
        }),
      ]),
    );
  });

  it('should return REVIEW with UPSERT_ALERT for CDD MEDIUM_RISK mock input', async () => {
    const result = await service.evaluate({
      contextType: 'ONBOARDING_CDD',
      customerId: 'c1',
      subjectId: 'c1',
      signals: {
        mockDataType: 'MEDIUM_RISK',
        riskScore: 58,
        riskLevel: 'MEDIUM',
      },
    });

    expect(result.decision).toBe('REVIEW');
    expect(result.reasonCodes).toEqual(['CDD_MEDIUM_RISK_REVIEW']);
    expect(result.recommendedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'UPSERT_ALERT',
          payload: expect.objectContaining({
            severity: 'MEDIUM',
            recommendation: 'REVIEW',
          }),
        }),
        expect.objectContaining({
          type: 'ONBOARDING_RECOMMEND_DECISIONS',
          payload: expect.objectContaining({
            decisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'],
          }),
        }),
      ]),
    );
  });

  it('should return REVIEW with onboarding decision options for CDD HIGH_RISK_OR_PEP mock input', async () => {
    const result = await service.evaluate({
      contextType: 'ONBOARDING_CDD',
      customerId: 'c1',
      subjectId: 'c1',
      signals: {
        mockDataType: 'HIGH_RISK_OR_PEP',
        riskScore: 91,
        riskLevel: 'HIGH',
        pepHit: true,
      },
    });

    expect(result.decision).toBe('REVIEW');
    expect(result.reasonCodes).toEqual(['CDD_HIGH_RISK_OR_PEP', 'PEP_HIT']);
    expect(result.recommendedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'UPSERT_ALERT',
          payload: expect.objectContaining({
            severity: 'HIGH',
            recommendation: 'REVIEW',
          }),
        }),
        expect.objectContaining({
          type: 'ONBOARDING_RECOMMEND_DECISIONS',
          payload: expect.objectContaining({
            decisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'],
          }),
        }),
      ]),
    );
  });

  it('should return review-mode recommendation options for legacy non-mock CDD input', async () => {
    const result = await service.evaluate({
      contextType: 'ONBOARDING_CDD',
      customerId: 'c1',
      subjectId: 'c1',
      signals: {
        riskScore: 78,
        riskLevel: 'HIGH',
        pepHit: true,
        sanctionsHit: false,
      },
    });

    expect(result.decision).toBe('REVIEW');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['PEP_HIT', 'HIGH_RISK_SCORE']),
    );
    expect(result.recommendedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'UPSERT_ALERT' }),
        expect.objectContaining({
          type: 'ONBOARDING_RECOMMEND_DECISIONS',
          payload: expect.objectContaining({
            decisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'],
          }),
        }),
      ]),
    );
  });

  it('should return REVIEW with approve/reject options for onboarding EDD input', async () => {
    const result = await service.evaluate({
      contextType: 'ONBOARDING_EDD',
      customerId: 'c1',
      subjectId: 'c1',
      signals: {
        riskScore: 52,
        riskLevel: 'MEDIUM',
        eddSubmitted: true,
      },
    });

    expect(result.decision).toBe('REVIEW');
    expect(result.recommendedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'UPSERT_ALERT' }),
        expect.objectContaining({
          type: 'ONBOARDING_RECOMMEND_DECISIONS',
          payload: expect.objectContaining({
            decisions: ['APPROVE', 'REJECT'],
          }),
        }),
      ]),
    );
  });
});
