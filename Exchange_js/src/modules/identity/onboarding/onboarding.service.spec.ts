import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  const prismaMock: any = {
    $transaction: jest.fn(),
    customerMain: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    cddCase: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    cddCaseReport: {
      create: jest.fn(),
    },
    eddCase: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    complianceSession: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    complianceAlert: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    complianceAlertEvent: {
      create: jest.fn(),
    },
    complianceIncident: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    complianceIncidentEvent: {
      create: jest.fn(),
    },
    onboardingDecisionRecord: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    onboardingAuditLog: {
      create: jest.fn(),
    },
  };

  const riskEngineMock: any = {
    evaluate: jest.fn(),
  };

  const complianceAlertsMock: any = {
    triggerSystemAlert: jest.fn(),
    applyAction: jest.fn(),
    findOne: jest.fn(),
  };

  const complianceIncidentsMock: any = {
    createFromAlert: jest.fn(),
    findOne: jest.fn(),
  };

  let service: OnboardingService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
    service = new OnboardingService(
      prismaMock,
      riskEngineMock,
      complianceAlertsMock,
      complianceIncidentsMock,
    );
  });

  const seedCddMockFlow = () => {
    const now = new Date(Date.now() + 10 * 60 * 1000);
    const session = {
      id: 'ses-1',
      customerId: 'c1',
      caseType: 'CDD',
      caseId: 'cdd-1',
      provider: 'MOCK',
      providerSessionId: 'SES2602010001',
      qrCodeUrl: 'mock://compliance/SES2602010001',
      status: 'PENDING',
      expiresAt: now,
    };
    const customer = {
      id: 'c1',
      customerNo: 'CU0001',
      publicStatus: 'PENDING_CDD',
      activeJourneyId: 'ONB-1',
    };
    const cddCase = {
      id: 'cdd-1',
      customerId: 'c1',
      caseNo: 'CDD2602010001',
      journeyId: 'ONB-1',
      subjectRefId: 'c1',
    };

    prismaMock.complianceSession.findFirst.mockResolvedValue(session);
    prismaMock.complianceSession.update.mockResolvedValue({ id: session.id });
    prismaMock.cddCase.findUnique.mockResolvedValue(cddCase);
    prismaMock.cddCase.update.mockResolvedValue({ id: cddCase.id });
    prismaMock.cddCaseReport.create.mockResolvedValue({ id: 'cdr-1' });
    prismaMock.customerMain.findUnique.mockResolvedValue(customer);
    prismaMock.customerMain.update.mockResolvedValue({
      ...customer,
      publicStatus: 'REVIEW_CDD',
    });
    prismaMock.onboardingAuditLog.create.mockResolvedValue({ id: 'audit-1' });
    prismaMock.complianceAlert.findFirst.mockResolvedValue(null);
    complianceAlertsMock.triggerSystemAlert.mockResolvedValue({ id: 'alert-1' });
    complianceAlertsMock.findOne.mockResolvedValue({
      id: 'alert-1',
      status: 'OPEN',
      sourceType: 'ONBOARDING_JOURNEY',
      recommendedDecisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'],
      linkedCaseIds: ['cdd-1'],
      decisionRecordIds: ['dr-low'],
      events: [],
    });
    complianceIncidentsMock.createFromAlert.mockResolvedValue({ id: 'inc-1' });
    complianceIncidentsMock.findOne.mockResolvedValue({ id: 'inc-1', status: 'ASSIGNED' });

    return { session, customer, cddCase };
  };

  const seedAlertDecisionFlow = (overrides?: {
    alert?: Record<string, unknown>;
    customer?: Record<string, unknown>;
    cddCase?: Record<string, unknown>;
  }) => {
    const alert = {
      id: 'alert-onb-1',
      sourceType: 'ONBOARDING_JOURNEY',
      sourceId: 'c1:ONB-1',
      customerId: 'c1',
      journeyId: 'ONB-1',
      status: 'ASSIGNED',
      assigneeUserId: 'admin-1',
      decision: null,
      linkedCaseIds: '["cdd-1"]',
      decisionRecordIds: '["dr-1"]',
      ...overrides?.alert,
    };
    const customer = {
      id: 'c1',
      customerNo: 'CU0001',
      publicStatus: 'REVIEW_CDD',
      activeJourneyId: 'ONB-1',
      currentCddCaseId: 'cdd-1',
      latestDecisionRecordId: 'dr-1',
      eddRequired: false,
      activeCaseId: 'cdd-1',
      ...overrides?.customer,
    };
    const cddCase = {
      id: 'cdd-1',
      customerId: 'c1',
      journeyId: 'ONB-1',
      status: 'FINAL',
      ...overrides?.cddCase,
    };

    prismaMock.complianceAlert.findUnique.mockResolvedValue(alert);
    prismaMock.complianceAlert.update.mockResolvedValue({
      ...alert,
      decision: 'APPROVE',
    });
    prismaMock.complianceAlertEvent.create.mockResolvedValue({ id: 'alevt-1' });
    prismaMock.customerMain.findUnique.mockResolvedValue(customer);
    prismaMock.cddCase.findUnique.mockResolvedValue(cddCase);
    prismaMock.cddCase.findFirst.mockResolvedValue(cddCase);
    prismaMock.cddCase.update.mockResolvedValue(cddCase);
    prismaMock.customerMain.update.mockResolvedValue({
      ...customer,
      publicStatus: 'ACTIVE',
      cddStatus: 'APPROVED',
      eddRequired: false,
      activeCaseId: null,
    });
    prismaMock.eddCase.findFirst.mockResolvedValue(null);
    prismaMock.eddCase.create.mockResolvedValue({
      id: 'edd-1',
      caseNo: 'EDD2603010001',
      customerId: 'c1',
      cddCaseId: 'cdd-1',
      journeyId: 'ONB-1',
      status: 'CREATED',
    });
    complianceAlertsMock.findOne.mockResolvedValue({
      id: 'alert-onb-1',
      status: 'ASSIGNED',
      sourceType: 'ONBOARDING_JOURNEY',
      assigneeUserId: 'admin-1',
      decision: 'APPROVE',
      recommendedDecisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'],
      linkedCaseIds: ['cdd-1'],
      decisionRecordIds: ['dr-1'],
      events: [],
    });
    prismaMock.onboardingAuditLog.create.mockResolvedValue({ id: 'audit-alert-1' });

    return {
      alert,
      customer,
      cddCase,
    };
  };

  it('should allow trading when public status is ACTIVE', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU1',
      publicStatus: 'ACTIVE',
      complianceStatus: 'ACTIVE',
      cddStatus: 'APPROVED',
      eddStatus: 'NOT_REQUIRED',
      finalApprovalStatus: 'APPROVED',
    });

    await expect(service.assertTradingEligibility('c1', 'SWAP')).resolves.toBeUndefined();
  });

  it('should block trading when public status is not ACTIVE', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU1',
      publicStatus: 'REVIEW_CDD',
      complianceStatus: 'IN_PROGRESS',
      cddStatus: 'PENDING_REVIEW',
      eddStatus: 'NOT_REQUIRED',
      finalApprovalStatus: 'NOT_REQUIRED',
    });

    await expect(service.assertTradingEligibility('c1', 'WITHDRAW')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('should throw when customer does not exist for trading gate', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue(null);

    await expect(service.assertTradingEligibility('missing', 'SWAP')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('should return WAIT_REVIEW action when public status is REVIEW_CDD', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      publicStatus: 'REVIEW_CDD',
      activeCaseId: 'cdd-1',
      eddRequired: false,
    });

    const result = await service.getNextStep('c1');

    expect(result.publicStatus).toBe('REVIEW_CDD');
    expect(result.actions).toEqual([{ type: 'WAIT_REVIEW' }]);
    expect(result.blockedReason).toContain('waiting compliance handling');
    expect(result.activeCaseId).toBe('cdd-1');
    expect(result.requiresEdd).toBe(false);
  });

  it('should return REINITIATE_CDD action when public status is REJECTED', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      publicStatus: 'REJECTED',
      activeCaseId: null,
      eddRequired: false,
    });

    const result = await service.getNextStep('c1');

    expect(result.publicStatus).toBe('REJECTED');
    expect(result.actions).toEqual([{ type: 'REINITIATE_CDD' }]);
    expect(result.blockedReason).toContain('Re-initiate');
  });

  it('should reject creating session for non-created case', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
    });
    prismaMock.cddCase.findUnique.mockResolvedValue({
      id: 'case-1',
      customerId: 'c1',
      status: 'FINAL',
    });

    await expect(
      service.createCaseSession('c1', 'c1', 'case-1', { caseType: 'CDD', provider: 'MOCK' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should reject mock-complete when session is not pending', async () => {
    prismaMock.complianceSession.findFirst.mockResolvedValue({
      id: 'ses-closed',
      customerId: 'c1',
      status: 'COMPLETED',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    await expect(service.mockCompleteSession('c1', 'c1', 'ses-closed')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('should mark expired session and reject mock-complete', async () => {
    prismaMock.complianceSession.findFirst.mockResolvedValue({
      id: 'ses-expired',
      customerId: 'c1',
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    prismaMock.complianceSession.update.mockResolvedValue({});

    await expect(service.mockCompleteSession('c1', 'c1', 'ses-expired')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prismaMock.complianceSession.update).toHaveBeenCalledWith({
      where: { id: 'ses-expired' },
      data: expect.objectContaining({ status: 'EXPIRED' }),
    });
  });

  it('should clear expiry metadata before reinitiate', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      publicStatus: 'REJECTED',
      cddStatus: 'REJECTED',
    });
    prismaMock.customerMain.update.mockResolvedValue({});
    jest.spyOn(service, 'startCddCases').mockResolvedValue({
      journeyId: 'ONB-2',
      currentCddCaseId: 'case-2',
      session: null,
      publicStatus: 'PENDING_CDD',
      actions: [{ type: 'COMPLETE_CDD' }],
    } as any);

    await service.reinitiateCddCases('c1', 'c1');

    expect(prismaMock.customerMain.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        cddDocumentExpiresAt: null,
        finalApprovalReason: null,
        finalApprovalReviewerId: null,
        finalApprovalReviewedAt: null,
      },
    });
  });

  it('should recompute NONE status into baseline legacy snapshot', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      publicStatus: 'NONE',
    });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      publicStatus: 'NONE',
      cddStatus: 'NOT_STARTED',
      eddStatus: 'NOT_REQUIRED',
      complianceStatus: 'NONE',
      finalApprovalStatus: 'NOT_REQUIRED',
    });

    const result = await service.recomputeComplianceSnapshot('c1', 'ONB-1');

    expect(prismaMock.customerMain.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({
        publicStatus: 'NONE',
        cddStatus: 'NOT_STARTED',
        eddStatus: 'NOT_REQUIRED',
        complianceStatus: 'NONE',
      }),
    });
    expect(result.complianceStatus).toBe('NONE');
  });

  it('should list decision records with default pagination and filters', async () => {
    prismaMock.onboardingDecisionRecord.count.mockResolvedValue(1);
    prismaMock.onboardingDecisionRecord.findMany.mockResolvedValue([
      {
        id: 'dr-1',
        customerId: 'c1',
        contextType: 'ONBOARDING_CDD',
        subjectId: 'c1',
        policyVersion: 'onboarding-risk-policy/v1',
        status: 'COMPLETED',
        inputHash: 'hash-1',
        outputDecision: 'APPROVE',
        recommendedActions: '[{"type":"PENDING_FINAL_DECISION"}]',
        reasonCodes: '["CDD_CLEAR"]',
        errorMessage: null,
        createdAt: new Date('2026-02-20T00:00:00.000Z'),
        completedAt: new Date('2026-02-20T00:01:00.000Z'),
        updatedAt: new Date('2026-02-20T00:01:00.000Z'),
        customer: {
          id: 'c1',
          customerNo: 'CU1',
          email: 'u1@test.local',
        },
      },
    ]);

    const result = await service.listDecisionRecords({
      status: 'COMPLETED',
      contextType: 'ONBOARDING_CDD',
      outputDecision: 'APPROVE',
      customerId: 'c1',
      subjectId: 'c1',
      policyVersion: 'risk-policy',
      skip: -3,
      take: 999,
    });

    expect(prismaMock.onboardingDecisionRecord.count).toHaveBeenCalledWith({
      where: {
        status: 'COMPLETED',
        contextType: 'ONBOARDING_CDD',
        outputDecision: 'APPROVE',
        customerId: 'c1',
        subjectId: 'c1',
        policyVersion: { contains: 'risk-policy' },
      },
    });
    expect(prismaMock.onboardingDecisionRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'COMPLETED',
          contextType: 'ONBOARDING_CDD',
          outputDecision: 'APPROVE',
          customerId: 'c1',
          subjectId: 'c1',
          policyVersion: { contains: 'risk-policy' },
        },
        skip: 0,
        take: 200,
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(result.total).toBe(1);
    expect(result.skip).toBe(0);
    expect(result.take).toBe(200);
    expect(result.items[0].reasonCodes).toEqual(['CDD_CLEAR']);
    expect(result.items[0].recommendedActions).toEqual([
      { type: 'PENDING_FINAL_DECISION' },
    ]);
  });

  it('should throw when decision record detail does not exist', async () => {
    prismaMock.onboardingDecisionRecord.findUnique.mockResolvedValue(null);

    await expect(service.getDecisionRecordDetail('missing-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('should parse decision record detail json fields', async () => {
    prismaMock.onboardingDecisionRecord.findUnique.mockResolvedValue({
      id: 'dr-2',
      customerId: 'c2',
      contextType: 'ONBOARDING_EDD',
      subjectId: 'c2',
      policyVersion: 'onboarding-risk-policy/v1',
      status: 'COMPLETED',
      inputPayload: '{"riskScore":72,"pepHit":true}',
      inputHash: 'hash-2',
      outputDecision: 'REVIEW',
      recommendedActions: '[{"type":"UPSERT_ALERT"}]',
      outputs: '{"decision":"REVIEW","reasonCodes":["PEP_HIT"]}',
      reasonCodes: '["PEP_HIT"]',
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

    expect(result.inputPayload).toEqual({ riskScore: 72, pepHit: true });
    expect(result.outputs).toEqual({
      decision: 'REVIEW',
      reasonCodes: ['PEP_HIT'],
    });
    expect(result.reasonCodes).toEqual(['PEP_HIT']);
    expect(result.recommendedActions).toEqual([{ type: 'UPSERT_ALERT' }]);
  });

  it('should reject onboarding alert decision when alert is not onboarding journey', async () => {
    seedAlertDecisionFlow({
      alert: {
        sourceType: 'DEPOSIT',
      },
    });

    await expect(
      service.applyOnboardingDecisionFromAlert(
        'alert-onb-1',
        'admin-1',
        'COMPLIANCE_LEAD',
        { decision: 'APPROVE' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should reject onboarding alert decision when actor is not assignee', async () => {
    seedAlertDecisionFlow({
      alert: {
        assigneeUserId: 'admin-9',
      },
    });

    await expect(
      service.applyOnboardingDecisionFromAlert(
        'alert-onb-1',
        'admin-1',
        'COMPLIANCE_LEAD',
        { decision: 'APPROVE' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('should reject REQUIRE_EDD decision when onboarding is in REVIEW_EDD', async () => {
    seedAlertDecisionFlow({
      customer: {
        publicStatus: 'REVIEW_EDD',
        currentEddCaseId: 'edd-1',
      },
      alert: {
        linkedCaseIds: '["edd-1"]',
      },
    });
    prismaMock.eddCase.findUnique.mockResolvedValue({
      id: 'edd-1',
      customerId: 'c1',
      journeyId: 'ONB-1',
      status: 'FINAL',
    });
    prismaMock.eddCase.findFirst.mockResolvedValue({
      id: 'edd-1',
      customerId: 'c1',
      journeyId: 'ONB-1',
      status: 'FINAL',
    });

    await expect(
      service.applyOnboardingDecisionFromAlert(
        'alert-onb-1',
        'admin-1',
        'COMPLIANCE_LEAD',
        { decision: 'REQUIRE_EDD' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should apply APPROVE decision and move onboarding to ACTIVE', async () => {
    seedAlertDecisionFlow();
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      publicStatus: 'ACTIVE',
      cddStatus: 'APPROVED',
      eddRequired: false,
      activeCaseId: null,
      customerNo: 'CU0001',
    });
    const result = await service.applyOnboardingDecisionFromAlert(
      'alert-onb-1',
      'admin-1',
      'COMPLIANCE_LEAD',
      { decision: 'APPROVE' },
    );

    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          publicStatus: 'ACTIVE',
          cddStatus: 'APPROVED',
        }),
      }),
    );
    expect(prismaMock.cddCase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewerDecision: 'APPROVE',
          requiresEdd: false,
        }),
      }),
    );
    expect(prismaMock.complianceAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decision: 'APPROVE',
          decisionRecommendation: 'APPROVE',
        }),
      }),
    );
    expect(result.customer.publicStatus).toBe('ACTIVE');
    expect(result.alert.status).toBe('ASSIGNED');
  });

  it('should apply REJECT decision and move onboarding to REJECTED', async () => {
    seedAlertDecisionFlow();
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      publicStatus: 'REJECTED',
      cddStatus: 'REJECTED',
      eddRequired: false,
      activeCaseId: null,
      customerNo: 'CU0001',
    });
    const result = await service.applyOnboardingDecisionFromAlert(
      'alert-onb-1',
      'admin-1',
      'COMPLIANCE_LEAD',
      { decision: 'REJECT', reason: 'risk not acceptable' },
    );

    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          publicStatus: 'REJECTED',
          cddStatus: 'REJECTED',
        }),
      }),
    );
    expect(result.customer.publicStatus).toBe('REJECTED');
  });

  it('should apply REQUIRE_EDD decision and create EDD case', async () => {
    seedAlertDecisionFlow();
    prismaMock.eddCase.findFirst.mockResolvedValue(null);
    prismaMock.eddCase.create.mockResolvedValue({
      id: 'edd-1',
      caseNo: 'EDD2603010001',
      customerId: 'c1',
      cddCaseId: 'cdd-1',
      journeyId: 'ONB-1',
      status: 'CREATED',
    });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      publicStatus: 'PENDING_EDD',
      cddStatus: 'APPROVED',
      eddRequired: true,
      activeCaseId: 'edd-1',
      customerNo: 'CU0001',
    });
    const result = await service.applyOnboardingDecisionFromAlert(
      'alert-onb-1',
      'admin-1',
      'COMPLIANCE_LEAD',
      { decision: 'REQUIRE_EDD' },
    );

    expect(prismaMock.eddCase.create).toHaveBeenCalled();
    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          publicStatus: 'PENDING_EDD',
          eddRequired: true,
          activeCaseType: 'EDD',
          activeCaseId: 'edd-1',
        }),
      }),
    );
    expect(result.customer.publicStatus).toBe('PENDING_EDD');
    expect(result.eddCase?.id).toBe('edd-1');
  });

  it('should auto-pass CDD LOW_RISK to ACTIVE without creating onboarding alert', async () => {
    seedCddMockFlow();
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      publicStatus: 'ACTIVE',
      cddStatus: 'APPROVED',
      complianceStatus: 'ACTIVE',
      finalApprovalStatus: 'APPROVED',
    });
    riskEngineMock.evaluate.mockResolvedValue({
      decision: 'REVIEW',
      decisionRecordId: 'dr-low',
      reasonCodes: ['CDD_LOW_RISK_CLEAR'],
      recommendedActions: [
        {
          type: 'UPSERT_ALERT',
          payload: { recommendation: 'REVIEW', severity: 'LOW' },
        },
        {
          type: 'ONBOARDING_RECOMMEND_DECISIONS',
          payload: { decisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'] },
        },
      ],
    });

    const result = await service.mockCompleteSession('c1', 'c1', 'ses-1', {
      mockDataType: 'LOW_RISK',
    });

    const receivedUpdate = prismaMock.cddCase.update.mock.calls[0][0];
    expect(JSON.parse(receivedUpdate.data.inputData)).toEqual(
      expect.objectContaining({
        mockDataType: 'LOW_RISK',
        riskLevel: 'LOW',
        pepHit: false,
        sanctionsHit: false,
      }),
    );
    expect(riskEngineMock.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        signals: expect.objectContaining({
          mockDataType: 'LOW_RISK',
        }),
      }),
    );
    const finalizedUpdate = prismaMock.cddCase.update.mock.calls[1][0];
    expect(finalizedUpdate).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewerDecision: 'APPROVE',
          decisionReason: 'AUTO_LOW_RISK_PASS',
          requiresEdd: false,
        }),
      }),
    );
    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          publicStatus: 'ACTIVE',
          cddStatus: 'APPROVED',
          complianceStatus: 'ACTIVE',
          finalApprovalStatus: 'APPROVED',
          activeCaseType: null,
          activeCaseId: null,
        }),
      }),
    );
    expect(complianceAlertsMock.triggerSystemAlert).not.toHaveBeenCalled();
    expect(result.publicStatus).toBe('ACTIVE');
  });

  it('should create OPEN alert with recommendation for CDD MEDIUM_RISK', async () => {
    seedCddMockFlow();
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      publicStatus: 'REVIEW_CDD',
    });
    riskEngineMock.evaluate.mockResolvedValue({
      decision: 'REVIEW',
      decisionRecordId: 'dr-medium',
      reasonCodes: ['CDD_MEDIUM_RISK_REVIEW'],
      recommendedActions: [
        {
          type: 'UPSERT_ALERT',
          payload: {
            severity: 'MEDIUM',
            recommendation: 'REVIEW',
          },
        },
        {
          type: 'ONBOARDING_RECOMMEND_DECISIONS',
          payload: { decisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'] },
        },
      ],
    });

    const result = await service.mockCompleteSession('c1', 'c1', 'ses-1', {
      mockDataType: 'MEDIUM_RISK',
    });

    expect(complianceAlertsMock.triggerSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'MEDIUM',
        decisionRecommendation: 'REVIEW',
        metadata: expect.objectContaining({
          recommendedDecisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'],
        }),
      }),
    );
    expect(complianceIncidentsMock.createFromAlert).not.toHaveBeenCalled();
    expect(result.publicStatus).toBe('REVIEW_CDD');
  });

  it('should keep high-risk CDD in REVIEW_CDD and not auto-create incident', async () => {
    seedCddMockFlow();
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      publicStatus: 'REVIEW_CDD',
    });
    riskEngineMock.evaluate.mockResolvedValue({
      decision: 'REVIEW',
      decisionRecordId: 'dr-high',
      reasonCodes: ['CDD_HIGH_RISK_OR_PEP', 'PEP_HIT'],
      recommendedActions: [
        {
          type: 'UPSERT_ALERT',
          payload: {
            severity: 'HIGH',
            recommendation: 'REVIEW',
          },
        },
        {
          type: 'ONBOARDING_RECOMMEND_DECISIONS',
          payload: { decisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'] },
        },
      ],
    });

    const result = await service.mockCompleteSession('c1', 'c1', 'ses-1', {
      mockDataType: 'HIGH_RISK_OR_PEP',
    });

    expect(complianceAlertsMock.triggerSystemAlert).toHaveBeenCalled();
    expect(complianceIncidentsMock.createFromAlert).not.toHaveBeenCalled();
    expect(result.publicStatus).toBe('REVIEW_CDD');
  });

  it('should auto-escalate and create incident for SANCTION_AND_OTHER CDD mock', async () => {
    seedCddMockFlow();
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      publicStatus: 'REVIEW_CDD',
    });
    riskEngineMock.evaluate.mockResolvedValue({
      decision: 'REVIEW',
      decisionRecordId: 'dr-sanction',
      reasonCodes: ['SANCTIONS_HIT', 'ADVERSE_MEDIA_HIT'],
      recommendedActions: [
        {
          type: 'UPSERT_ALERT',
          payload: {
            severity: 'CRITICAL',
            recommendation: 'REVIEW',
          },
        },
        {
          type: 'ESCALATE_INCIDENT',
          payload: {
            reasonCode: 'SANCTIONS_HIT',
          },
        },
        {
          type: 'ONBOARDING_RECOMMEND_DECISIONS',
          payload: { decisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'] },
        },
      ],
    });

    const result = await service.mockCompleteSession('c1', 'c1', 'ses-1', {
      mockDataType: 'SANCTION_AND_OTHER',
    });

    expect(complianceAlertsMock.triggerSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'CRITICAL',
        decisionRecommendation: 'REVIEW',
      }),
    );
    expect(complianceIncidentsMock.createFromAlert).toHaveBeenCalledWith(
      'alert-1',
      expect.objectContaining({
        decision: 'REVIEW',
        linkedCaseIds: ['cdd-1'],
        decisionRecordIds: ['dr-sanction'],
        recommendedActions: expect.arrayContaining([
          'UPSERT_ALERT',
          'ESCALATE_INCIDENT',
          'ONBOARDING_RECOMMEND_DECISIONS',
        ]),
      }),
      expect.objectContaining({
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
      }),
    );
    expect(result.publicStatus).toBe('REVIEW_CDD');
  });

  it('should map legacy result=FAIL to SANCTION_AND_OTHER mock data type', async () => {
    seedCddMockFlow();
    riskEngineMock.evaluate.mockResolvedValue({
      decision: 'APPROVE',
      decisionRecordId: 'dr-legacy-fail',
      reasonCodes: ['CDD_CLEAR'],
      recommendedActions: [],
    });

    await service.mockCompleteSession('c1', 'c1', 'ses-1', {
      result: 'FAIL',
    });

    expect(riskEngineMock.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        signals: expect.objectContaining({
          mockDataType: 'SANCTION_AND_OTHER',
        }),
      }),
    );
  });

  it('should map legacy default result to LOW_RISK mock data type', async () => {
    seedCddMockFlow();
    riskEngineMock.evaluate.mockResolvedValue({
      decision: 'APPROVE',
      decisionRecordId: 'dr-legacy-pass',
      reasonCodes: ['CDD_CLEAR'],
      recommendedActions: [],
    });

    await service.mockCompleteSession('c1', 'c1', 'ses-1');

    expect(riskEngineMock.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        signals: expect.objectContaining({
          mockDataType: 'LOW_RISK',
        }),
      }),
    );
  });
});
