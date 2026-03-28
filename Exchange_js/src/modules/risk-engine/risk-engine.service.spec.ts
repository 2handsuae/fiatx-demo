import { RiskEngineService } from './risk-engine.service';

describe('RiskEngineService', () => {
  const prismaMock: any = {
    workflowDecisionRecord: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  let service: RiskEngineService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.workflowDecisionRecord.create.mockResolvedValue({ id: 'dr-1' });
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      id: 'dr-1',
      policyVersion: 'onboarding-risk-policy/v1',
      status: 'CREATED',
    });
    prismaMock.workflowDecisionRecord.update.mockResolvedValue({ id: 'dr-1' });
    service = new RiskEngineService(prismaMock);
  });

  const buildInput = (overrides?: Partial<Parameters<RiskEngineService['evaluate']>[0]>) => ({
    contextType: 'ONBOARDING_CDD',
    subjectType: 'INDIVIDUAL_CUSTOMER',
    subjectId: 'c1',
    ownerType: 'CUSTOMER',
    ownerId: 'c1',
    signals: {},
    ...overrides,
  });

  it('should return REVIEW with onboarding decision options for CDD LOW_RISK mock input', async () => {
    const result = await service.evaluate(buildInput({
      signals: {
        mockDataType: 'LOW_RISK',
        riskScore: 26,
        riskLevel: 'LOW',
      },
    }));

    expect(result.decision).toBe('REVIEW');
    expect(result.reasonCodes).toEqual(['CDD_LOW_RISK_CLEAR']);
    expect(
      result.recommendedActions.some((action) => action.type === 'UPSERT_ALERT'),
    ).toBe(false);
    expect(result.recommendedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ONBOARDING_RECOMMEND_DECISIONS',
          payload: expect.objectContaining({
            decisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'],
          }),
        }),
      ]),
    );
    expect(prismaMock.workflowDecisionRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: 'c1',
        contextType: 'ONBOARDING_CDD',
        subjectId: 'c1',
        inputPayload: expect.any(String),
      }),
    });
    expect(
      JSON.parse(prismaMock.workflowDecisionRecord.create.mock.calls[0][0].data.inputPayload),
    ).toEqual(
      expect.objectContaining({
        subjectType: 'INDIVIDUAL_CUSTOMER',
        ownerType: 'CUSTOMER',
        ownerId: 'c1',
      }),
    );
  });

  it('should create pending decision record without completing it immediately', async () => {
    const result = await service.createPendingDecisionRecord(buildInput({
      contextType: 'TX_SWAP_FINAL',
      subjectType: 'SWAP',
      subjectId: 'swap-1',
      signals: {
        simulationMode: 'MANUAL_PENDING',
      },
    }));

    expect(result).toEqual(
      expect.objectContaining({
        decisionRecordId: 'dr-1',
        policyVersion: 'transaction-risk-policy/v1',
        inputHash: expect.any(String),
      }),
    );
    expect(prismaMock.workflowDecisionRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: 'c1',
        contextType: 'TX_SWAP_FINAL',
        subjectId: 'swap-1',
        status: 'CREATED',
      }),
    });
    expect(prismaMock.workflowDecisionRecord.update).not.toHaveBeenCalled();
  });

  it('should complete pending swap decision record with manual medium risk reason', async () => {
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      id: 'dr-swap-medium',
      policyVersion: 'transaction-risk-policy/v1',
      status: 'CREATED',
    });

    const result = await service.completeDecisionRecord(
      'dr-swap-medium',
      buildInput({
        contextType: 'TX_SWAP_FINAL',
        subjectType: 'SWAP',
        subjectId: 'swap-1',
        signals: {
          simulationMode: 'MANUAL',
          riskBand: 'MEDIUM',
          riskReason: 'VELOCITY_SPIKE',
          customerAmlRiskTier: 'LOW',
        },
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        decision: 'REVIEW',
        reasonCodes: ['VELOCITY_SPIKE'],
      }),
    );
    expect(prismaMock.workflowDecisionRecord.update).toHaveBeenCalledWith({
      where: { id: 'dr-swap-medium' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        outputDecision: 'REVIEW',
        outputs: expect.any(String),
      }),
    });
    const updatePayload = prismaMock.workflowDecisionRecord.update.mock.calls[0][0].data;
    expect(JSON.parse(updatePayload.outputs)).toEqual(
      expect.objectContaining({
        riskBand: 'MEDIUM',
        riskReason: 'VELOCITY_SPIKE',
        simulationMode: 'MANUAL',
      }),
    );
  });

  it('should return APPROVE for manual low-risk deposit simulation', async () => {
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      id: 'dr-dep-low',
      policyVersion: 'transaction-risk-policy/v1',
      status: 'CREATED',
    });

    const result = await service.completeDecisionRecord(
      'dr-dep-low',
      buildInput({
        contextType: 'TX_DEPOSIT_FINAL',
        subjectType: 'DEPOSIT',
        subjectId: 'dep-1',
        signals: {
          simulationMode: 'MANUAL',
          riskBand: 'LOW',
          kytStatus: 'PASS',
          travelRuleStatus: 'ACCEPTED',
        },
      }),
    );

    expect(result.decision).toBe('APPROVE');
    expect(result.reasonCodes).toEqual(['TX_DEPOSIT_LOW_RISK_AUTO_CLEAR']);
  });

  it('should return REVIEW with UPSERT_ALERT for CDD MEDIUM_RISK mock input', async () => {
    const result = await service.evaluate(buildInput({
      signals: {
        mockDataType: 'MEDIUM_RISK',
        riskScore: 58,
        riskLevel: 'MEDIUM',
      },
    }));

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
    expect(
      result.recommendedActions.some((action) => action.type === 'ESCALATE_INCIDENT'),
    ).toBe(false);
  });

  it('should return REVIEW with onboarding decision options for CDD HIGH_RISK_OR_PEP mock input', async () => {
    const result = await service.evaluate(buildInput({
      signals: {
        mockDataType: 'HIGH_RISK_OR_PEP',
        riskScore: 91,
        riskLevel: 'HIGH',
        pepHit: true,
      },
    }));

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
    expect(
      result.recommendedActions.some((action) => action.type === 'ESCALATE_INCIDENT'),
    ).toBe(false);
  });

  it('should return REVIEW without legacy auto-escalate for CDD SANCTION_AND_OTHER mock input', async () => {
    const result = await service.evaluate(buildInput({
      signals: {
        mockDataType: 'SANCTION_AND_OTHER',
        sanctionsHit: true,
        adverseMediaHit: true,
        riskScore: 96,
        riskLevel: 'CRITICAL',
      },
    }));

    expect(result.decision).toBe('REVIEW');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['SANCTIONS_HIT', 'ADVERSE_MEDIA_HIT']),
    );
    expect(result.recommendedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'UPSERT_ALERT',
          payload: expect.objectContaining({
            severity: 'CRITICAL',
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
    expect(
      result.recommendedActions.some((action) => action.type === 'ESCALATE_INCIDENT'),
    ).toBe(false);
    expect(
      result.recommendedActions.some((action) => action.type === 'AUTO_ESCALATE_CASE'),
    ).toBe(false);
  });

  it('should return review-mode recommendation options for legacy non-mock CDD input', async () => {
    const result = await service.evaluate(buildInput({
      signals: {
        riskScore: 78,
        riskLevel: 'HIGH',
        pepHit: true,
        sanctionsHit: false,
      },
    }));

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
    const result = await service.evaluate(buildInput({
      contextType: 'ONBOARDING_EDD',
      signals: {
        riskScore: 52,
        riskLevel: 'MEDIUM',
        eddSubmitted: true,
      },
    }));

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
    const decisionAction = result.recommendedActions.find(
      (action) => action.type === 'ONBOARDING_RECOMMEND_DECISIONS',
    );
    expect(decisionAction?.payload?.decisions).toEqual(['APPROVE', 'REJECT']);
    expect(decisionAction?.payload?.decisions).not.toContain('REQUIRE_EDD');
  });

  it('should approve terminal PASS for deposit KYT context without alert escalation', async () => {
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValueOnce({
      id: 'dr-1',
      policyVersion: 'transaction-risk-policy/v1',
      status: 'CREATED',
    });
    const result = await service.evaluate(buildInput({
      contextType: 'TX_DEPOSIT_KYT_MAIN',
      subjectType: 'DEPOSIT',
      subjectId: 'dep-1',
      signals: {
        status: 'PASS',
        kytStatus: 'PASS',
        riskScore: 18,
      },
    }));

    expect(result.policyVersion).toBe('transaction-risk-policy/v1');
    expect(result.decision).toBe('APPROVE');
    expect(result.reasonCodes).toEqual(['TX_KYT_PASS']);
    expect(result.recommendedActions).toEqual([]);
  });

  it('should reject travel rule REJECTED and recommend alert plus case escalation', async () => {
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValueOnce({
      id: 'dr-1',
      policyVersion: 'transaction-risk-policy/v1',
      status: 'CREATED',
    });
    const result = await service.evaluate(buildInput({
      contextType: 'TX_DEPOSIT_TRAVEL_RULE',
      subjectType: 'DEPOSIT',
      subjectId: 'dep-2',
      signals: {
        status: 'REJECTED',
        travelRuleStatus: 'REJECTED',
        required: true,
      },
    }));

    expect(result.policyVersion).toBe('transaction-risk-policy/v1');
    expect(result.decision).toBe('REJECT');
    expect(result.reasonCodes).toEqual(['TX_TRAVEL_RULE_REJECTED']);
    expect(result.recommendedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'UPSERT_ALERT',
          payload: expect.objectContaining({
            recommendation: 'REJECT',
            severity: 'CRITICAL',
          }),
        }),
        expect.objectContaining({
          type: 'AUTO_ESCALATE_CASE',
        }),
      ]),
    );
  });

  it('should approve final deposit review when KYT and Travel Rule containers are FINAL', async () => {
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValueOnce({
      id: 'dr-1',
      policyVersion: 'transaction-risk-policy/v1',
      status: 'CREATED',
    });
    const result = await service.evaluate(buildInput({
      contextType: 'TX_DEPOSIT_FINAL',
      subjectType: 'DEPOSIT',
      subjectId: 'dep-3',
      signals: {
        kytStatus: 'FINAL',
        travelRuleStatus: 'FINAL',
        riskScore: 55,
      },
    }));

    expect(result.policyVersion).toBe('transaction-risk-policy/v1');
    expect(result.decision).toBe('APPROVE');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['TX_KYT_FINAL', 'TX_TRAVEL_RULE_FINAL']),
    );
    expect(result.recommendedActions).toEqual([]);
  });

  it('should include large-deposit profile mismatch reason code in final deposit review', async () => {
    const result = await service.evaluate(buildInput({
      contextType: 'TX_DEPOSIT_FINAL',
      subjectType: 'DEPOSIT',
      subjectId: 'dep-4',
      signals: {
        kytStatus: 'FINAL',
        travelRuleStatus: 'FINAL',
        simulationRiskLevel: 'MEDIUM',
        simulationRiskReason: 'LARGE_DEPOSIT_PROFILE_MISMATCH',
      },
    }));

    expect(result.decision).toBe('REVIEW');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        'TX_SIM_LARGE_DEPOSIT_PROFILE_MISMATCH',
        'TX_KYT_FINAL',
        'TX_TRAVEL_RULE_FINAL',
      ]),
    );
    expect(result.recommendedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'UPSERT_ALERT',
          payload: expect.objectContaining({
            recommendation: 'REVIEW',
            riskReason: 'LARGE_DEPOSIT_PROFILE_MISMATCH',
          }),
        }),
      ]),
    );
  });

  it('should reject live evaluation for historical withdraw precheck context', async () => {
    await expect(
      service.evaluate(
        buildInput({
          contextType: 'TX_WITHDRAW_PRECHECK',
          subjectType: 'WITHDRAW',
          subjectId: 'wd-legacy-1',
          signals: {
            preKytStatus: 'FINAL',
          },
        }),
      ),
    ).rejects.toThrow('historical read-only');
  });

  it('should reject non-customer owner type during Phase 2 storage', async () => {
    await expect(
      service.evaluate(
        buildInput({
          ownerType: 'TRANSACTION',
          ownerId: 'tx-1',
        }),
      ),
    ).rejects.toThrow(RiskEngineService.PHASE2_UNSUPPORTED_OWNER_TYPE);

    expect(prismaMock.workflowDecisionRecord.create).not.toHaveBeenCalled();
  });
});
