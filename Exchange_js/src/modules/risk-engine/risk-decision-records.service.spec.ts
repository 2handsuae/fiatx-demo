import { NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import { OnboardingService } from '../identity/onboarding/onboarding.service';
import { PeriodicReviewService } from '../identity/periodic-review/periodic-review.service';
import { RiskDecisionRecordsService } from './risk-decision-records.service';
import { TransactionRiskBridgeService } from './transaction-compliance/transaction-risk-bridge.service';

describe('RiskDecisionRecordsService', () => {
  const prismaMock: any = {
    workflowDecisionRecord: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    swapTransaction: {
      findUnique: jest.fn(),
    },
  };
  const onboardingServiceMock = {
    completeManualCddDecision: jest.fn(),
    completeManualEddDecision: jest.fn(),
  };
  const periodicReviewServiceMock = {
    completeManualCddDecision: jest.fn(),
    completeManualEddDecision: jest.fn(),
  };
  const transactionRiskBridgeServiceMock = {
    simulateDepositFinalReview: jest.fn(),
    simulateSwapFinalReview: jest.fn(),
    simulateWithdrawPrecheckReview: jest.fn(),
    simulateWithdrawFinalReview: jest.fn(),
  };
  const moduleRefMock = {
    get: jest.fn(),
  };

  let service: RiskDecisionRecordsService;
  let recordByActorSpy: jest.SpiedFunction<typeof AuditLogsService.prototype.recordByActor>;

  beforeEach(() => {
    jest.resetAllMocks();
    recordByActorSpy = jest
      .spyOn(AuditLogsService.prototype, 'recordByActor')
      .mockResolvedValue({} as any);
    moduleRefMock.get.mockImplementation((token: unknown) => {
      if (token === OnboardingService) return onboardingServiceMock;
      if (token === PeriodicReviewService) return periodicReviewServiceMock;
      if (token === TransactionRiskBridgeService) return transactionRiskBridgeServiceMock;
      return null;
    });
    service = new RiskDecisionRecordsService(
      prismaMock,
      moduleRefMock as unknown as ModuleRef,
    );
  });

  it('should list decision records with canonical owner fields and parsed arrays', async () => {
    prismaMock.workflowDecisionRecord.count.mockResolvedValue(2);
    prismaMock.workflowDecisionRecord.findMany.mockResolvedValue([
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
          '{"orchestration":{"workflow":"ONBOARDING","stage":"REVIEW_CDD","rule":"ONB_CDD_REVIEW_REQUIRED","executedActions":[{"type":"UPSERT_ALERT"}],"skippedActions":[{"type":"AUTO_ESCALATE_CASE","reason":"PHASE7_AUTO_ESCALATE_NOT_ENABLED"}],"alertUpserted":true},"workflowTransition":{"workflow":"ONBOARDING","stage":"REVIEW_CDD","dispositionCode":"REQUIRE_EDD","transitionCode":"CDD_REQUIRE_EDD_TO_PENDING_EDD","fromStatus":"REVIEW_CDD","toStatus":"PENDING_EDD","executed":true,"eddResponseId":"edd-1","activeCaseId":"edd-1"}}',
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

    expect(prismaMock.workflowDecisionRecord.count).toHaveBeenCalledWith({
      where: {
        customerId: 'c1',
        status: 'COMPLETED',
      },
    });
    expect(prismaMock.workflowDecisionRecord.findMany).toHaveBeenCalledWith(
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

  it('should parse detail payloads and return canonical customer snapshot', async () => {
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue({
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
        '{"decision":"REVIEW","orchestration":{"workflow":"ONBOARDING","stage":"REVIEW_EDD","rule":"ONB_EDD_REVIEW_REQUIRED","executedActions":[{"type":"UPSERT_ALERT"},{"type":"ONBOARDING_RECOMMEND_DECISIONS"}],"skippedActions":[],"alertId":"alt-1","alertNo":"ALT0001","alertUpserted":true,"recommendedDecisions":["CLEAR","REJECT"]},"workflowTransition":{"workflow":"ONBOARDING","stage":"REVIEW_EDD","dispositionCode":"CLEAR","transitionCode":"EDD_APPROVE_TO_FINAL_APPROVAL","fromStatus":"REVIEW_EDD","toStatus":"FINAL_APPROVAL","executed":true}}',
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
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue(null);

    await expect(service.getDecisionRecordDetail('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('should map transaction decision records into transaction workflow metadata', async () => {
    prismaMock.workflowDecisionRecord.count.mockResolvedValue(1);
    prismaMock.workflowDecisionRecord.findMany.mockResolvedValue([
      {
        id: 'dr-tx-1',
        customerId: 'c-tx-1',
        contextType: 'TX_DEPOSIT_FINAL',
        subjectId: 'dep-1',
        policyVersion: 'transaction-risk-policy/v1',
        status: 'COMPLETED',
        inputHash: 'hash-tx-1',
        inputPayload: '{"subjectType":"DEPOSIT"}',
        outputDecision: 'REVIEW',
        recommendedActions: '[{"type":"UPSERT_ALERT"}]',
        outputs:
          '{"orchestration":{"workflow":"TRANSACTION","stage":"REVIEW_DEPOSIT_FINAL","rule":"TX_DEPOSIT_FINAL_REVIEW_REQUIRED","alertId":"alt-tx-1","alertNo":"ALT-TX-1"},"workflowTransition":{"workflow":"TRANSACTION","stage":"REVIEW_DEPOSIT_FINAL","dispositionCode":"CLEAR","transitionCode":"TX_DEPOSIT_CLEAR_TO_SUCCESS","fromStatus":"PENDING_COMPLIANCE","toStatus":"SUCCESS","executed":true,"updatedSubject":{"id":"dep-1","sourceType":"DEPOSIT","subjectNo":"DEP0001","blocked":false,"blockedReason":null}}}',
        reasonCodes: '["TX_KYT_REVIEW"]',
        errorMessage: null,
        createdAt: new Date('2026-03-24T00:00:00.000Z'),
        completedAt: new Date('2026-03-24T00:01:00.000Z'),
        updatedAt: new Date('2026-03-24T00:01:00.000Z'),
        customer: {
          id: 'c-tx-1',
          customerNo: 'CU-TX-1',
          email: 'tx@test.local',
        },
      },
    ]);

    const result = await service.listDecisionRecords({
      contextType: 'TX_DEPOSIT_FINAL',
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        subjectType: 'DEPOSIT',
        workflow: 'TRANSACTION',
        stage: 'REVIEW_DEPOSIT_FINAL',
        rule: 'TX_DEPOSIT_FINAL_REVIEW_REQUIRED',
        orchestration: expect.objectContaining({
          alertId: 'alt-tx-1',
        }),
        workflowTransition: expect.objectContaining({
          transitionCode: 'TX_DEPOSIT_CLEAR_TO_SUCCESS',
          updatedSubject: expect.objectContaining({
            id: 'dep-1',
            sourceType: 'DEPOSIT',
            subjectNo: 'DEP0001',
          }),
        }),
      }),
    );
  });

  it('should map withdraw precheck decision records into withdraw review metadata', async () => {
    prismaMock.workflowDecisionRecord.count.mockResolvedValue(1);
    prismaMock.workflowDecisionRecord.findMany.mockResolvedValue([
      {
        id: 'dr-wd-pre-1',
        customerId: 'c-wd-1',
        contextType: 'TX_WITHDRAW_PRECHECK',
        subjectId: 'wd-1',
        policyVersion: 'transaction-risk-policy/v1',
        status: 'COMPLETED',
        inputHash: 'hash-wd-pre-1',
        inputPayload: '{"subjectType":"WITHDRAW"}',
        outputDecision: 'REVIEW',
        recommendedActions: '[{"type":"UPSERT_ALERT"}]',
        outputs:
          '{"orchestration":{"workflow":"TRANSACTION","stage":"REVIEW_WITHDRAW_PRECHECK","rule":"TX_WITHDRAW_PRECHECK_REVIEW_REQUIRED","alertId":"alt-wd-pre-1","alertNo":"ALT-WD-PRE-1"},"workflowTransition":{"workflow":"TRANSACTION","stage":"REVIEW_WITHDRAW_PRECHECK","dispositionCode":"CLEAR","transitionCode":"TX_WITHDRAW_CLEAR_TO_PENDING_COMPLIANCE","fromStatus":"CREATED","toStatus":"PENDING_COMPLIANCE","executed":true,"updatedSubject":{"id":"wd-1","sourceType":"WITHDRAW","subjectNo":"WD0001","blocked":false,"blockedReason":null}}}',
        reasonCodes: '["TX_WITHDRAW_PRE_KYT_REVIEW"]',
        errorMessage: null,
        createdAt: new Date('2026-03-27T00:00:00.000Z'),
        completedAt: new Date('2026-03-27T00:01:00.000Z'),
        updatedAt: new Date('2026-03-27T00:01:00.000Z'),
        customer: {
          id: 'c-wd-1',
          customerNo: 'CU-WD-1',
          email: 'withdraw@test.local',
        },
      },
    ]);

    const result = await service.listDecisionRecords({
      contextType: 'TX_WITHDRAW_PRECHECK',
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        subjectType: 'WITHDRAW',
        workflow: 'TRANSACTION',
        stage: 'REVIEW_WITHDRAW_PRECHECK',
        rule: 'TX_WITHDRAW_PRECHECK_REVIEW_REQUIRED',
        orchestration: expect.objectContaining({
          alertId: 'alt-wd-pre-1',
        }),
        workflowTransition: expect.objectContaining({
          transitionCode: 'TX_WITHDRAW_CLEAR_TO_PENDING_COMPLIANCE',
          updatedSubject: expect.objectContaining({
            id: 'wd-1',
            sourceType: 'WITHDRAW',
            subjectNo: 'WD0001',
          }),
        }),
      }),
    );
  });

  it('should reject manual simulation for legacy withdraw precheck records', async () => {
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      id: 'dr-wd-pre-legacy-1',
      status: 'CREATED',
      contextType: 'TX_WITHDRAW_PRECHECK',
      customerId: 'c1',
      subjectId: 'wd-legacy-1',
    });

    await expect(
      service.simulateDecisionRecord(
        'dr-wd-pre-legacy-1',
        { riskLevel: 'MEDIUM' },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorNo: 'ADM-1',
          actorRole: 'COMPLIANCE_OFFICER',
          sourcePlatform: 'ADMIN_API',
        },
      ),
    ).rejects.toThrow('historical read-only');

    expect(
      transactionRiskBridgeServiceMock.simulateWithdrawPrecheckReview,
    ).not.toHaveBeenCalled();
  });

  it('should delegate CDD manual simulation and return refreshed detail', async () => {
    prismaMock.workflowDecisionRecord.findUnique
      .mockResolvedValueOnce({
        id: 'dr-cdd-1',
        status: 'CREATED',
        contextType: 'ONBOARDING_CDD',
        customerId: 'c1',
        subjectId: 'c1',
      })
      .mockResolvedValueOnce({
        id: 'dr-cdd-1',
        customerId: 'c1',
        contextType: 'ONBOARDING_CDD',
        subjectId: 'c1',
        policyVersion: 'risk-policy/v2',
        status: 'COMPLETED',
        inputHash: 'hash-cdd-1',
        inputPayload: '{"subjectType":"INDIVIDUAL_CUSTOMER"}',
        outputDecision: 'REVIEW',
        recommendedActions: '[]',
        outputs: '{"riskBand":"MEDIUM","riskReason":"CDD_PROFILE_INCONSISTENT","simulationMode":"MANUAL"}',
        reasonCodes: '["CDD_PROFILE_INCONSISTENT"]',
        errorMessage: null,
        createdAt: new Date('2026-03-26T00:00:00.000Z'),
        completedAt: new Date('2026-03-26T00:01:00.000Z'),
        updatedAt: new Date('2026-03-26T00:01:00.000Z'),
        customer: null,
      });

    const result = await service.simulateDecisionRecord(
      'dr-cdd-1',
      { riskLevel: 'MEDIUM', reasonCode: 'CDD_SOURCE_OF_FUNDS_REVIEW' },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'ADM-1',
        actorRole: 'COMPLIANCE_OFFICER',
        sourcePlatform: 'ADMIN_API',
      },
    );

    expect(onboardingServiceMock.completeManualCddDecision).toHaveBeenCalledWith({
      decisionRecordId: 'dr-cdd-1',
      riskLevel: 'MEDIUM',
      reasonCode: 'CDD_SOURCE_OF_FUNDS_REVIEW',
    });
    expect(result.outputs).toEqual(
      expect.objectContaining({
        riskBand: 'MEDIUM',
        simulationMode: 'MANUAL',
      }),
    );
  });

  it('should require reasonCode for MEDIUM/HIGH manual simulation', async () => {
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      id: 'dr-cdd-2',
      status: 'CREATED',
      contextType: 'ONBOARDING_CDD',
      customerId: 'c1',
      subjectId: 'c1',
    });

    await expect(
      service.simulateDecisionRecord(
        'dr-cdd-2',
        { riskLevel: 'HIGH' },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorNo: 'ADM-1',
          actorRole: 'COMPLIANCE_OFFICER',
          sourcePlatform: 'ADMIN_API',
        },
      ),
    ).rejects.toThrow('reasonCode is required');

    expect(onboardingServiceMock.completeManualCddDecision).not.toHaveBeenCalled();
  });

  it('should delegate onboarding EDD manual simulation with canonical low-risk reason', async () => {
    prismaMock.workflowDecisionRecord.findUnique
      .mockResolvedValueOnce({
        id: 'dr-edd-1',
        status: 'CREATED',
        contextType: 'ONBOARDING_EDD',
        customerId: 'c1',
        subjectId: 'c1',
      })
      .mockResolvedValueOnce({
        id: 'dr-edd-1',
        customerId: 'c1',
        contextType: 'ONBOARDING_EDD',
        subjectId: 'c1',
        policyVersion: 'onboarding-risk-policy/v1',
        status: 'COMPLETED',
        inputHash: 'hash-edd-1',
        inputPayload: '{"subjectType":"INDIVIDUAL_CUSTOMER"}',
        outputDecision: 'CLEAR',
        recommendedActions: '[]',
        outputs: '{"riskBand":"LOW","riskReason":"EDD_CLEAR","simulationMode":"MANUAL"}',
        reasonCodes: '["EDD_CLEAR"]',
        errorMessage: null,
        createdAt: new Date('2026-03-31T00:00:00.000Z'),
        completedAt: new Date('2026-03-31T00:01:00.000Z'),
        updatedAt: new Date('2026-03-31T00:01:00.000Z'),
        customer: null,
      });

    await service.simulateDecisionRecord(
      'dr-edd-1',
      { riskLevel: 'LOW' },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'ADM-1',
        actorRole: 'COMPLIANCE_OFFICER',
        sourcePlatform: 'ADMIN_API',
      },
    );

    expect(onboardingServiceMock.completeManualEddDecision).toHaveBeenCalledWith({
      decisionRecordId: 'dr-edd-1',
      riskLevel: 'LOW',
      reasonCode: 'EDD_CLEAR',
      actorId: 'admin-1',
      actorRole: 'COMPLIANCE_OFFICER',
    });
  });

  it('should require reasonCode for onboarding EDD medium/high manual simulation', async () => {
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      id: 'dr-edd-2',
      status: 'CREATED',
      contextType: 'ONBOARDING_EDD',
      customerId: 'c1',
      subjectId: 'c1',
    });

    await expect(
      service.simulateDecisionRecord(
        'dr-edd-2',
        { riskLevel: 'HIGH' },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorNo: 'ADM-1',
          actorRole: 'COMPLIANCE_OFFICER',
          sourcePlatform: 'ADMIN_API',
        },
      ),
    ).rejects.toThrow('reasonCode is required');

    expect(onboardingServiceMock.completeManualEddDecision).not.toHaveBeenCalled();
  });

  it('should delegate periodic review CDD manual simulation', async () => {
    prismaMock.workflowDecisionRecord.findUnique
      .mockResolvedValueOnce({
        id: 'dr-prr-cdd-1',
        status: 'CREATED',
        contextType: 'PERIODIC_REVIEW_CDD',
        customerId: 'c1',
        subjectId: 'c1',
      })
      .mockResolvedValueOnce({
        id: 'dr-prr-cdd-1',
        customerId: 'c1',
        contextType: 'PERIODIC_REVIEW_CDD',
        subjectId: 'c1',
        policyVersion: 'periodic-review-risk-policy/v1',
        status: 'COMPLETED',
        inputHash: 'hash-prr-cdd-1',
        inputPayload: '{"subjectType":"INDIVIDUAL_CUSTOMER"}',
        outputDecision: 'REVIEW',
        recommendedActions: '[]',
        outputs: '{"riskBand":"MEDIUM","riskReason":"CDD_MEDIUM_RISK_REVIEW","simulationMode":"MANUAL"}',
        reasonCodes: '["CDD_MEDIUM_RISK_REVIEW"]',
        errorMessage: null,
        createdAt: new Date('2026-03-31T00:00:00.000Z'),
        completedAt: new Date('2026-03-31T00:01:00.000Z'),
        updatedAt: new Date('2026-03-31T00:01:00.000Z'),
        customer: null,
      });

    await service.simulateDecisionRecord(
      'dr-prr-cdd-1',
      { riskLevel: 'MEDIUM', reasonCode: 'CDD_MEDIUM_RISK_REVIEW' },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'ADM-1',
        actorRole: 'COMPLIANCE_OFFICER',
        sourcePlatform: 'ADMIN_API',
      },
    );

    expect(periodicReviewServiceMock.completeManualCddDecision).toHaveBeenCalledWith({
      decisionRecordId: 'dr-prr-cdd-1',
      riskLevel: 'MEDIUM',
      reasonCode: 'CDD_MEDIUM_RISK_REVIEW',
    });
  });

  it('should delegate periodic review EDD manual simulation', async () => {
    prismaMock.workflowDecisionRecord.findUnique
      .mockResolvedValueOnce({
        id: 'dr-prr-edd-1',
        status: 'CREATED',
        contextType: 'PERIODIC_REVIEW_EDD',
        customerId: 'c1',
        subjectId: 'c1',
      })
      .mockResolvedValueOnce({
        id: 'dr-prr-edd-1',
        customerId: 'c1',
        contextType: 'PERIODIC_REVIEW_EDD',
        subjectId: 'c1',
        policyVersion: 'periodic-review-risk-policy/v1',
        status: 'COMPLETED',
        inputHash: 'hash-prr-edd-1',
        inputPayload: '{"subjectType":"INDIVIDUAL_CUSTOMER"}',
        outputDecision: 'REVIEW',
        recommendedActions: '[]',
        outputs: '{"riskBand":"HIGH","riskReason":"SANCTIONS_HIT","simulationMode":"MANUAL"}',
        reasonCodes: '["SANCTIONS_HIT"]',
        errorMessage: null,
        createdAt: new Date('2026-03-31T00:00:00.000Z'),
        completedAt: new Date('2026-03-31T00:01:00.000Z'),
        updatedAt: new Date('2026-03-31T00:01:00.000Z'),
        customer: null,
      });

    await service.simulateDecisionRecord(
      'dr-prr-edd-1',
      { riskLevel: 'HIGH', reasonCode: 'SANCTIONS_HIT' },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'ADM-1',
        actorRole: 'COMPLIANCE_OFFICER',
        sourcePlatform: 'ADMIN_API',
      },
    );

    expect(periodicReviewServiceMock.completeManualEddDecision).toHaveBeenCalledWith({
      decisionRecordId: 'dr-prr-edd-1',
      riskLevel: 'HIGH',
      reasonCode: 'SANCTIONS_HIT',
    });
  });

  it('should delegate deposit manual simulation to transaction risk bridge', async () => {
    prismaMock.workflowDecisionRecord.findUnique
      .mockResolvedValueOnce({
        id: 'dr-dep-1',
        status: 'CREATED',
        contextType: 'TX_DEPOSIT_FINAL',
        customerId: 'c1',
        subjectId: 'dep-1',
      })
      .mockResolvedValueOnce({
        id: 'dr-dep-1',
        customerId: 'c1',
        contextType: 'TX_DEPOSIT_FINAL',
        subjectId: 'dep-1',
        policyVersion: 'transaction-risk-policy/v1',
        status: 'COMPLETED',
        inputHash: 'hash-dep-1',
        inputPayload: '{"subjectType":"DEPOSIT"}',
        outputDecision: 'APPROVE',
        recommendedActions: '[]',
        outputs: '{"riskBand":"LOW","riskReason":"TX_DEPOSIT_LOW_RISK_AUTO_CLEAR","simulationMode":"MANUAL"}',
        reasonCodes: '["TX_DEPOSIT_LOW_RISK_AUTO_CLEAR"]',
        errorMessage: null,
        createdAt: new Date('2026-03-26T00:00:00.000Z'),
        completedAt: new Date('2026-03-26T00:01:00.000Z'),
        updatedAt: new Date('2026-03-26T00:01:00.000Z'),
        customer: null,
      });

    await service.simulateDecisionRecord(
      'dr-dep-1',
      { riskLevel: 'LOW' },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'ADM-1',
        actorRole: 'COMPLIANCE_OFFICER',
        sourcePlatform: 'ADMIN_API',
      },
    );

    expect(transactionRiskBridgeServiceMock.simulateDepositFinalReview).toHaveBeenCalledWith({
      decisionRecordId: 'dr-dep-1',
      riskLevel: 'LOW',
      riskReason: 'TX_DEPOSIT_LOW_RISK_AUTO_CLEAR',
    });
  });

  it('should audit swap manual simulation against canonical swap workflow root', async () => {
    prismaMock.workflowDecisionRecord.findUnique
      .mockResolvedValueOnce({
        id: 'dr-swap-1',
        status: 'CREATED',
        contextType: 'TX_SWAP_FINAL',
        customerId: 'c1',
        subjectId: 'swap-1',
      })
      .mockResolvedValueOnce({
        id: 'dr-swap-1',
        customerId: 'c1',
        contextType: 'TX_SWAP_FINAL',
        subjectId: 'swap-1',
        policyVersion: 'transaction-risk-policy/v1',
        status: 'COMPLETED',
        inputHash: 'hash-swap-1',
        inputPayload: '{"subjectType":"SWAP"}',
        outputDecision: 'REVIEW',
        recommendedActions: '[]',
        outputs: '{"riskBand":"MEDIUM","riskReason":"VELOCITY_SPIKE","simulationMode":"MANUAL"}',
        reasonCodes: '["VELOCITY_SPIKE"]',
        errorMessage: null,
        createdAt: new Date('2026-03-26T00:00:00.000Z'),
        completedAt: new Date('2026-03-26T00:01:00.000Z'),
        updatedAt: new Date('2026-03-26T00:01:00.000Z'),
        customer: null,
      });
    prismaMock.swapTransaction.findUnique.mockResolvedValue({
      id: 'swap-1',
      swapNo: 'SWP2603260001',
    });

    await service.simulateDecisionRecord(
      'dr-swap-1',
      { riskLevel: 'MEDIUM', reasonCode: 'VELOCITY_SPIKE' },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'ADM-1',
        actorRole: 'COMPLIANCE_OFFICER',
        sourcePlatform: 'ADMIN_API',
      },
    );

    expect(transactionRiskBridgeServiceMock.simulateSwapFinalReview).toHaveBeenCalledWith({
      decisionRecordId: 'dr-swap-1',
      riskLevel: 'MEDIUM',
      riskReason: 'VELOCITY_SPIKE',
    });
    expect(recordByActorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MANUAL_RISK_DECISION_SIMULATED',
        entityType: 'RISK_DECISION_RECORD',
        entityId: 'dr-swap-1',
        traceId: 'SWAP:swap-1',
        workflowType: 'SWAP',
        metadata: expect.objectContaining({
          decisionRecordId: 'dr-swap-1',
          contextType: 'TX_SWAP_FINAL',
          subjectId: 'swap-1',
          selectedRiskLevel: 'MEDIUM',
          selectedReasonCode: 'VELOCITY_SPIKE',
          simulationMode: 'MANUAL',
        }),
      }),
      expect.objectContaining({
        actorId: 'admin-1',
      }),
    );
  });

  it('should delegate withdraw final manual simulation to transaction risk bridge', async () => {
    prismaMock.workflowDecisionRecord.findUnique
      .mockResolvedValueOnce({
        id: 'dr-wd-final-1',
        status: 'CREATED',
        contextType: 'TX_WITHDRAW_FINAL',
        customerId: 'c1',
        subjectId: 'wd-1',
      })
      .mockResolvedValueOnce({
        id: 'dr-wd-final-1',
        customerId: 'c1',
        contextType: 'TX_WITHDRAW_FINAL',
        subjectId: 'wd-1',
        policyVersion: 'transaction-risk-policy/v1',
        status: 'COMPLETED',
        inputHash: 'hash-wd-final-1',
        inputPayload: '{"subjectType":"WITHDRAW"}',
        outputDecision: 'APPROVE',
        recommendedActions: '[]',
        outputs: '{"riskBand":"LOW","riskReason":"TX_WITHDRAW_FINAL_LOW_RISK_CLEAR","simulationMode":"MANUAL"}',
        reasonCodes: '["TX_WITHDRAW_FINAL_LOW_RISK_CLEAR"]',
        errorMessage: null,
        createdAt: new Date('2026-03-27T00:00:00.000Z'),
        completedAt: new Date('2026-03-27T00:01:00.000Z'),
        updatedAt: new Date('2026-03-27T00:01:00.000Z'),
        customer: null,
      });

    await service.simulateDecisionRecord(
      'dr-wd-final-1',
      { riskLevel: 'LOW' },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'ADM-1',
        actorRole: 'COMPLIANCE_OFFICER',
        sourcePlatform: 'ADMIN_API',
      },
    );

    expect(
      transactionRiskBridgeServiceMock.simulateWithdrawFinalReview,
    ).toHaveBeenCalledWith({
      decisionRecordId: 'dr-wd-final-1',
      riskLevel: 'LOW',
      riskReason: 'TX_WITHDRAW_FINAL_LOW_RISK_CLEAR',
    });
  });

  it('should reject manual simulation for completed records', async () => {
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      id: 'dr-closed-1',
      status: 'COMPLETED',
      contextType: 'TX_SWAP_FINAL',
      customerId: 'c1',
      subjectId: 'swap-1',
    });

    await expect(
      service.simulateDecisionRecord(
        'dr-closed-1',
        { riskLevel: 'HIGH' },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorNo: 'ADM-1',
          actorRole: 'MLRO',
          sourcePlatform: 'ADMIN_API',
        },
      ),
    ).rejects.toThrow('is not pending simulation');
  });
});
