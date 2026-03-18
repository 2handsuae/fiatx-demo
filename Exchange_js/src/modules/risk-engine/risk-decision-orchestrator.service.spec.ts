import { RiskDecisionOrchestratorService } from './risk-decision-orchestrator.service';

describe('RiskDecisionOrchestratorService', () => {
  const prismaMock: any = {
    onboardingDecisionRecord: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    complianceAlert: {
      findFirst: jest.fn(),
    },
  };

  const complianceAlertsMock: any = {
    triggerSystemAlert: jest.fn(),
    applyAction: jest.fn(),
    findOne: jest.fn(),
  };

  let service: RiskDecisionOrchestratorService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.onboardingDecisionRecord.findUnique.mockResolvedValue({
      id: 'dr-1',
      outputs: '{"decision":"REVIEW"}',
    });
    prismaMock.onboardingDecisionRecord.update.mockResolvedValue({ id: 'dr-1' });
    prismaMock.complianceAlert.findFirst.mockResolvedValue(null);
    complianceAlertsMock.triggerSystemAlert.mockResolvedValue({
      id: 'alt-1',
      alertNo: 'ALT0001',
    });
    complianceAlertsMock.findOne.mockResolvedValue({ id: 'alt-1', alertNo: 'ALT0001' });
    service = new RiskDecisionOrchestratorService(prismaMock, complianceAlertsMock);
  });

  it('should map REVIEW_CDD to canonical rule and upsert alert', async () => {
    const result = await service.orchestrate({
      workflow: 'ONBOARDING',
      stage: 'REVIEW_CDD',
      customerId: 'c1',
      customerNo: 'CU0001',
      journeyId: 'ONB-1',
      linkedCaseIds: ['cdd-1'],
      decisionRecordId: 'dr-1',
      decision: 'REVIEW',
      reasonCodes: ['CDD_MEDIUM_RISK_REVIEW'],
      recommendedActions: [
        {
          type: 'UPSERT_ALERT',
          payload: { severity: 'MEDIUM', recommendation: 'REVIEW' },
        },
        {
          type: 'ONBOARDING_RECOMMEND_DECISIONS',
          payload: { decisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'] },
        },
      ],
      contextType: 'ONBOARDING_CDD',
    });

    expect(complianceAlertsMock.triggerSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleCode: 'ONB_CDD_REVIEW_REQUIRED',
        stage: 'REVIEW_CDD',
        sourceType: 'ONBOARDING_JOURNEY',
        metadata: expect.objectContaining({
          recommendedDecisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'],
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        workflow: 'ONBOARDING',
        stage: 'REVIEW_CDD',
        rule: 'ONB_CDD_REVIEW_REQUIRED',
        alertId: 'alt-1',
        alertNo: 'ALT0001',
        alertUpserted: true,
      }),
    );
    expect(prismaMock.onboardingDecisionRecord.update).toHaveBeenCalledWith({
      where: { id: 'dr-1' },
      data: {
        outputs: expect.any(String),
      },
    });
  });

  it('should record AUTO_ESCALATE_CASE as skipped in onboarding runtime', async () => {
    const result = await service.orchestrate({
      workflow: 'ONBOARDING',
      stage: 'REVIEW_EDD',
      customerId: 'c1',
      customerNo: 'CU0001',
      journeyId: 'ONB-1',
      decisionRecordId: 'dr-1',
      decision: 'REVIEW',
      reasonCodes: ['SANCTIONS_HIT'],
      recommendedActions: [
        {
          type: 'UPSERT_ALERT',
          payload: { severity: 'CRITICAL', recommendation: 'REVIEW' },
        },
        {
          type: 'ESCALATE_INCIDENT',
          payload: { reasonCode: 'SANCTIONS_HIT' },
        },
      ],
      contextType: 'ONBOARDING_EDD',
    });

    expect(result.skippedActions).toEqual([
      {
        type: 'AUTO_ESCALATE_CASE',
        reason: 'PHASE7_AUTO_ESCALATE_NOT_ENABLED',
      },
    ]);
  });

  it('should not upsert alert when only advisory recommendations exist', async () => {
    const result = await service.orchestrate({
      workflow: 'ONBOARDING',
      stage: 'REVIEW_CDD',
      customerId: 'c1',
      customerNo: 'CU0001',
      journeyId: 'ONB-1',
      decisionRecordId: 'dr-1',
      decision: 'REVIEW',
      reasonCodes: ['CDD_LOW_RISK_CLEAR'],
      recommendedActions: [
        {
          type: 'ONBOARDING_RECOMMEND_DECISIONS',
          payload: { decisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'] },
        },
      ],
      contextType: 'ONBOARDING_CDD',
    });

    expect(complianceAlertsMock.triggerSystemAlert).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        alertUpserted: false,
        recommendedDecisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'],
      }),
    );
  });
});
