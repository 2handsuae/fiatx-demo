import { NotFoundException } from '@nestjs/common';
import { RiskDecisionRecordsService } from './risk-decision-records.service';

describe('RiskDecisionRecordsService', () => {
  const prismaMock: any = {
    onboardingDecisionRecord: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  let service: RiskDecisionRecordsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RiskDecisionRecordsService(prismaMock);
  });

  it('should list decision records with canonical owner fields and parsed arrays', async () => {
    prismaMock.onboardingDecisionRecord.count.mockResolvedValue(2);
    prismaMock.onboardingDecisionRecord.findMany.mockResolvedValue([
      {
        id: 'dr-1',
        customerId: 'c1',
        contextType: 'ONBOARDING_CDD',
        subjectId: 'sub-1',
        policyVersion: 'risk-policy/v2',
        status: 'COMPLETED',
        inputHash: 'hash-1',
        inputPayload: '{"subjectType":"INDIVIDUAL_CUSTOMER"}',
        outputDecision: 'REVIEW',
        recommendedActions: '[{"type":"UPSERT_ALERT"},{"type":"ESCALATE_INCIDENT"}]',
        outputs:
          '{"orchestration":{"workflow":"ONBOARDING","stage":"REVIEW_CDD","rule":"ONB_CDD_REVIEW_REQUIRED","executedActions":[{"type":"UPSERT_ALERT"}],"skippedActions":[{"type":"AUTO_ESCALATE_CASE","reason":"PHASE7_AUTO_ESCALATE_NOT_ENABLED"}],"alertUpserted":true},"workflowTransition":{"workflow":"ONBOARDING","stage":"REVIEW_CDD","dispositionCode":"REQUIRE_EDD","transitionCode":"CDD_REQUIRE_EDD_TO_PENDING_EDD","fromStatus":"REVIEW_CDD","toStatus":"PENDING_EDD","executed":true,"eddCaseId":"edd-1","activeCaseId":"edd-1"}}',
        reasonCodes: '["CDD_REVIEW_REQUIRED"]',
        errorMessage: null,
        createdAt: new Date('2026-02-20T00:00:00.000Z'),
        completedAt: new Date('2026-02-20T00:01:00.000Z'),
        updatedAt: new Date('2026-02-20T00:01:00.000Z'),
        customer: {
          id: 'c1',
          customerNo: 'CU0001',
          email: 'u1@test.local',
        },
      },
      {
        id: 'dr-legacy',
        customerId: 'c2',
        contextType: 'ONBOARDING_EDD',
        subjectId: 'sub-2',
        policyVersion: 'risk-policy/v1',
        status: 'FAILED',
        inputHash: 'hash-2',
        inputPayload: '{"contextType":"ONBOARDING_EDD"}',
        outputDecision: null,
        recommendedActions: '[]',
        outputs: '{}',
        reasonCodes: '[]',
        errorMessage: 'boom',
        createdAt: new Date('2026-02-21T00:00:00.000Z'),
        completedAt: null,
        updatedAt: new Date('2026-02-21T00:01:00.000Z'),
        customer: null,
      },
    ]);

    const result = await service.listDecisionRecords({
      ownerId: 'c1',
      status: 'COMPLETED',
      skip: -1,
      take: 999,
    });

    expect(prismaMock.onboardingDecisionRecord.count).toHaveBeenCalledWith({
      where: {
        customerId: 'c1',
        status: 'COMPLETED',
      },
    });
    expect(prismaMock.onboardingDecisionRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          customerId: 'c1',
          status: 'COMPLETED',
        },
        skip: 0,
        take: 200,
      }),
    );
    expect(result.total).toBe(2);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        ownerType: 'CUSTOMER',
        ownerId: 'c1',
        subjectType: 'INDIVIDUAL_CUSTOMER',
        recommendedActions: [
          { type: 'UPSERT_ALERT' },
          { type: 'AUTO_ESCALATE_CASE' },
        ],
        reasonCodes: ['CDD_REVIEW_REQUIRED'],
        workflow: 'ONBOARDING',
        stage: 'REVIEW_CDD',
        rule: 'ONB_CDD_REVIEW_REQUIRED',
        orchestration: expect.objectContaining({
          alertUpserted: true,
        }),
        workflowTransition: expect.objectContaining({
          transitionCode: 'CDD_REQUIRE_EDD_TO_PENDING_EDD',
          toStatus: 'PENDING_EDD',
        }),
      }),
    );
    expect(result.items[1]).toEqual(
      expect.objectContaining({
        ownerType: 'CUSTOMER',
        ownerId: 'c2',
        subjectType: 'UNKNOWN',
        workflow: 'ONBOARDING',
        stage: 'REVIEW_EDD',
        rule: 'ONB_EDD_REVIEW_REQUIRED',
      }),
    );
  });

  it('should parse detail payloads and keep compatibility fields', async () => {
    prismaMock.onboardingDecisionRecord.findUnique.mockResolvedValue({
      id: 'dr-2',
      customerId: 'c2',
      contextType: 'ONBOARDING_EDD',
      subjectId: 'corp-1',
      policyVersion: 'risk-policy/v2',
      status: 'COMPLETED',
      inputHash: 'hash-2',
      inputPayload: '{"subjectType":"CORPORATE_ENTITY","riskScore":72}',
      outputDecision: 'REVIEW',
      recommendedActions: '[{"type":"UPSERT_ALERT"}]',
      outputs:
        '{"decision":"REVIEW","orchestration":{"workflow":"ONBOARDING","stage":"REVIEW_EDD","rule":"ONB_EDD_REVIEW_REQUIRED","executedActions":[{"type":"UPSERT_ALERT"},{"type":"ONBOARDING_RECOMMEND_DECISIONS"}],"skippedActions":[],"alertId":"alt-1","alertNo":"ALT0001","alertUpserted":true,"recommendedDecisions":["APPROVE","REJECT"]},"workflowTransition":{"workflow":"ONBOARDING","stage":"REVIEW_EDD","dispositionCode":"APPROVE_STAGE","transitionCode":"EDD_APPROVE_TO_FINAL_APPROVAL","fromStatus":"REVIEW_EDD","toStatus":"FINAL_APPROVAL","executed":true}}',
      reasonCodes: '["HIGH_RISK_SCORE"]',
      errorMessage: null,
      createdAt: new Date('2026-02-20T00:00:00.000Z'),
      completedAt: new Date('2026-02-20T00:01:00.000Z'),
      updatedAt: new Date('2026-02-20T00:01:00.000Z'),
      customer: {
        id: 'c2',
        customerNo: 'CU2',
        email: 'u2@test.local',
        firstName: 'A',
        lastName: 'B',
        customerType: 'INDIVIDUAL',
        companyName: null,
        publicStatus: 'REVIEW_EDD',
      },
    });

    const result = await service.getDecisionRecordDetail('dr-2');

    expect(result).toEqual(
      expect.objectContaining({
        ownerType: 'CUSTOMER',
        ownerId: 'c2',
        customerId: 'c2',
        subjectType: 'CORPORATE_ENTITY',
        inputPayload: expect.objectContaining({
          subjectType: 'CORPORATE_ENTITY',
          riskScore: 72,
        }),
        outputs: expect.objectContaining({ decision: 'REVIEW' }),
        reasonCodes: ['HIGH_RISK_SCORE'],
        recommendedActions: [{ type: 'UPSERT_ALERT' }],
        workflow: 'ONBOARDING',
        stage: 'REVIEW_EDD',
        rule: 'ONB_EDD_REVIEW_REQUIRED',
        orchestration: expect.objectContaining({
          alertId: 'alt-1',
          alertUpserted: true,
        }),
        workflowTransition: expect.objectContaining({
          transitionCode: 'EDD_APPROVE_TO_FINAL_APPROVAL',
          toStatus: 'FINAL_APPROVAL',
        }),
      }),
    );
  });

  it('should throw when detail record does not exist', async () => {
    prismaMock.onboardingDecisionRecord.findUnique.mockResolvedValue(null);

    await expect(service.getDecisionRecordDetail('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
