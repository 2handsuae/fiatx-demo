import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { WORKFLOW_TRANSITION_CODES } from './onboarding-workflow-transition.service';

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
    eddCaseReport: {
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
    complianceAlertDispositionRecord: {
      create: jest.fn(),
    },
    complianceIncident: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    complianceIncidentEvent: {
      create: jest.fn(),
    },
    complianceIncidentDispositionRecord: {
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

  const orchestratorMock: any = {
    orchestrate: jest.fn(),
    upsertOnboardingReviewAlert: jest.fn(),
    closeLatestJourneyAlertIfAny: jest.fn(),
    findAlertDetail: jest.fn(),
  };

  const workflowTransitionServiceMock: any = {
    transition: jest.fn(),
  };

  const complianceIncidentsMock: any = {
    createFromAlert: jest.fn(),
    findOne: jest.fn(),
  };

  let service: OnboardingService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
    prismaMock.complianceAlertDispositionRecord.create.mockResolvedValue({
      id: 'alert-disp-1',
    });
    prismaMock.complianceIncidentDispositionRecord.create.mockResolvedValue({
      id: 'case-disp-1',
    });
    service = new OnboardingService(
      prismaMock,
      riskEngineMock,
      orchestratorMock,
      workflowTransitionServiceMock,
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
      subjectKind: 'INDIVIDUAL_CUSTOMER',
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
    orchestratorMock.orchestrate.mockResolvedValue({
      workflow: 'ONBOARDING',
      stage: 'REVIEW_CDD',
      rule: 'ONB_CDD_REVIEW_REQUIRED',
      recommendedDecisions: ['APPROVE', 'REJECT', 'REQUIRE_EDD'],
      executedActions: [{ type: 'UPSERT_ALERT' }],
      skippedActions: [],
      alertId: 'alert-1',
      alertNo: 'ALT0001',
      alertUpserted: true,
    });
    orchestratorMock.upsertOnboardingReviewAlert.mockResolvedValue({ id: 'alert-1' });
    orchestratorMock.findAlertDetail.mockResolvedValue({
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
    orchestratorMock.findAlertDetail.mockResolvedValue({
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
    workflowTransitionServiceMock.transition.mockResolvedValue({
      workflow: 'ONBOARDING',
      stage: 'REVIEW_CDD',
      dispositionCode: 'APPROVE_STAGE',
      transitionCode: WORKFLOW_TRANSITION_CODES.CDD_APPROVE_TO_ACTIVE,
      fromStatus: 'REVIEW_CDD',
      toStatus: 'ACTIVE',
      executed: true,
      updatedCustomer: {
        ...customer,
        publicStatus: 'ACTIVE',
        cddStatus: 'APPROVED',
        eddRequired: false,
        activeCaseId: null,
      },
      eddCase: null,
      activeCaseId: null,
      finalApprovalStatus: 'APPROVED',
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
      complianceHoldStatus: 'ACTIVE',
      complianceHoldCaseId: null,
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
      complianceHoldStatus: 'ACTIVE',
      complianceHoldCaseId: null,
      complianceStatus: 'IN_PROGRESS',
      cddStatus: 'PENDING_REVIEW',
      eddStatus: 'NOT_REQUIRED',
      finalApprovalStatus: 'NOT_REQUIRED',
    });

    await expect(service.assertTradingEligibility('c1', 'WITHDRAW')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('should block trading when compliance hold is FROZEN', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU1',
      publicStatus: 'ACTIVE',
      complianceHoldStatus: 'FROZEN',
      complianceHoldCaseId: 'inc-1',
      complianceStatus: 'ACTIVE',
      cddStatus: 'APPROVED',
      eddStatus: 'NOT_REQUIRED',
      finalApprovalStatus: 'APPROVED',
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

  it('should auto-expire ACTIVE customer to PENDING_CDD when cddDocumentExpiresAt passed', async () => {
    prismaMock.customerMain.findUnique
      .mockResolvedValueOnce({
        id: 'c1',
        publicStatus: 'ACTIVE',
        cddDocumentExpiresAt: new Date(Date.now() - 60 * 1000),
      })
      .mockResolvedValueOnce({
        id: 'c1',
        publicStatus: 'PENDING_CDD',
        activeCaseId: null,
        eddRequired: false,
      });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      publicStatus: 'PENDING_CDD',
    });

    const result = await service.getNextStep('c1');

    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({
          publicStatus: 'PENDING_CDD',
          cddStatus: 'EXPIRED',
          complianceStatus: 'EXPIRED',
        }),
      }),
    );
    expect(result.publicStatus).toBe('PENDING_CDD');
    expect(result.actions).toEqual([{ type: 'COMPLETE_CDD' }]);
  });

  it('should auto-expire and block DEPOSIT trading when CDD is expired', async () => {
    prismaMock.customerMain.findUnique
      .mockResolvedValueOnce({
        id: 'c1',
        publicStatus: 'ACTIVE',
        cddDocumentExpiresAt: new Date(Date.now() - 60 * 1000),
      })
      .mockResolvedValueOnce({
        id: 'c1',
        customerNo: 'CU1',
        publicStatus: 'PENDING_CDD',
        complianceStatus: 'EXPIRED',
        cddStatus: 'EXPIRED',
        eddStatus: 'NOT_REQUIRED',
        finalApprovalStatus: 'NOT_REQUIRED',
      });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      publicStatus: 'PENDING_CDD',
    });

    await expect(service.assertTradingEligibility('c1', 'DEPOSIT')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prismaMock.customerMain.update).toHaveBeenCalledTimes(1);
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
    const result = await service.applyOnboardingDecisionFromAlert(
      'alert-onb-1',
      'admin-1',
      'COMPLIANCE_LEAD',
      { decision: 'APPROVE' },
    );

    expect(workflowTransitionServiceMock.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        customerMain: prismaMock.customerMain,
      }),
      expect.objectContaining({
        workflow: 'ONBOARDING',
        stage: 'REVIEW_CDD',
        producerType: 'ALERT',
        dispositionCode: 'APPROVE_STAGE',
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
    workflowTransitionServiceMock.transition.mockResolvedValue({
      workflow: 'ONBOARDING',
      stage: 'REVIEW_CDD',
      dispositionCode: 'REJECT_STAGE',
      transitionCode: WORKFLOW_TRANSITION_CODES.CDD_REJECT_TO_REJECTED,
      fromStatus: 'REVIEW_CDD',
      toStatus: 'REJECTED',
      executed: true,
      updatedCustomer: {
        id: 'c1',
        publicStatus: 'REJECTED',
        cddStatus: 'REJECTED',
        eddRequired: false,
        activeCaseId: null,
        customerNo: 'CU0001',
      },
      eddCase: null,
      activeCaseId: null,
      finalApprovalStatus: 'REJECTED',
    });
    const result = await service.applyOnboardingDecisionFromAlert(
      'alert-onb-1',
      'admin-1',
      'COMPLIANCE_LEAD',
      { decision: 'REJECT', reason: 'risk not acceptable' },
    );

    expect(workflowTransitionServiceMock.transition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dispositionCode: 'REJECT_STAGE',
      }),
    );
    expect(result.customer.publicStatus).toBe('REJECTED');
  });

  it('should apply REQUIRE_EDD decision and create EDD case', async () => {
    seedAlertDecisionFlow();
    const eddCase = {
      id: 'edd-1',
      caseNo: 'EDD2603010001',
      customerId: 'c1',
      cddCaseId: 'cdd-1',
      journeyId: 'ONB-1',
      status: 'CREATED',
    };
    workflowTransitionServiceMock.transition.mockResolvedValue({
      workflow: 'ONBOARDING',
      stage: 'REVIEW_CDD',
      dispositionCode: 'REQUIRE_EDD',
      transitionCode: WORKFLOW_TRANSITION_CODES.CDD_REQUIRE_EDD_TO_PENDING_EDD,
      fromStatus: 'REVIEW_CDD',
      toStatus: 'PENDING_EDD',
      executed: true,
      updatedCustomer: {
        id: 'c1',
        publicStatus: 'PENDING_EDD',
        cddStatus: 'APPROVED',
        eddRequired: true,
        activeCaseId: 'edd-1',
        customerNo: 'CU0001',
      },
      eddCase,
      activeCaseId: 'edd-1',
      finalApprovalStatus: 'NOT_REQUIRED',
    });
    const result = await service.applyOnboardingDecisionFromAlert(
      'alert-onb-1',
      'admin-1',
      'COMPLIANCE_LEAD',
      { decision: 'REQUIRE_EDD' },
    );

    expect(workflowTransitionServiceMock.transition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dispositionCode: 'REQUIRE_EDD',
      }),
    );
    expect(result.customer.publicStatus).toBe('PENDING_EDD');
    expect(result.eddCase?.id).toBe('edd-1');
    expect(prismaMock.complianceAlert.update).toHaveBeenCalledTimes(2);
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
        ownerType: 'CUSTOMER',
        ownerId: 'c1',
        subjectType: 'INDIVIDUAL_CUSTOMER',
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
    expect(orchestratorMock.orchestrate).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: 'ONBOARDING',
        stage: 'REVIEW_CDD',
        decisionRecordId: 'dr-low',
      }),
    );
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

    expect(orchestratorMock.orchestrate).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: 'ONBOARDING',
        stage: 'REVIEW_CDD',
        decisionRecordId: 'dr-medium',
        contextType: 'ONBOARDING_CDD',
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

    expect(orchestratorMock.orchestrate).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: 'ONBOARDING',
        stage: 'REVIEW_CDD',
        decisionRecordId: 'dr-high',
      }),
    );
    expect(complianceIncidentsMock.createFromAlert).not.toHaveBeenCalled();
    expect(result.publicStatus).toBe('REVIEW_CDD');
  });

  it('should keep SANCTION_AND_OTHER CDD mock in alert triage without auto-creating incident', async () => {
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

    expect(orchestratorMock.orchestrate).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: 'ONBOARDING',
        stage: 'REVIEW_CDD',
        decisionRecordId: 'dr-sanction',
      }),
    );
    expect(complianceIncidentsMock.createFromAlert).not.toHaveBeenCalled();
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
        ownerType: 'CUSTOMER',
        ownerId: 'c1',
        subjectType: 'INDIVIDUAL_CUSTOMER',
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
        ownerType: 'CUSTOMER',
        ownerId: 'c1',
        subjectType: 'INDIVIDUAL_CUSTOMER',
        signals: expect.objectContaining({
          mockDataType: 'LOW_RISK',
        }),
      }),
    );
  });

  it('should pass canonical owner and subject mapping for EDD risk evaluation', async () => {
    const now = new Date(Date.now() + 10 * 60 * 1000);
    prismaMock.complianceSession.findFirst.mockResolvedValue({
      id: 'ses-edd-1',
      customerId: 'c1',
      caseType: 'EDD',
      caseId: 'edd-1',
      provider: 'MOCK',
      providerSessionId: 'ESE2602010001',
      qrCodeUrl: 'mock://compliance/ESE2602010001',
      status: 'PENDING',
      expiresAt: now,
    });
    prismaMock.complianceSession.update.mockResolvedValue({ id: 'ses-edd-1' });
    prismaMock.eddCase.findUnique.mockResolvedValue({
      id: 'edd-1',
      customerId: 'c1',
      caseNo: 'EDD2602010001',
      subjectKind: 'CORPORATE_ENTITY',
      subjectRefId: 'corp-1',
      status: 'CREATED',
    });
    prismaMock.eddCase.update.mockResolvedValue({ id: 'edd-1' });
    prismaMock.eddCaseReport.create.mockResolvedValue({ id: 'edr-1' });
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      publicStatus: 'PENDING_EDD',
      activeJourneyId: 'ONB-1',
      currentEddCaseId: 'edd-1',
    });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      publicStatus: 'REVIEW_EDD',
    });
    prismaMock.onboardingAuditLog.create.mockResolvedValue({ id: 'audit-edd-1' });
    orchestratorMock.orchestrate.mockResolvedValue({
      workflow: 'ONBOARDING',
      stage: 'REVIEW_EDD',
      rule: 'ONB_EDD_REVIEW_REQUIRED',
      recommendedDecisions: ['APPROVE', 'REJECT'],
      executedActions: [{ type: 'UPSERT_ALERT' }],
      skippedActions: [],
      alertId: 'alert-edd-1',
      alertNo: 'ALT0002',
      alertUpserted: true,
    });
    orchestratorMock.findAlertDetail.mockResolvedValue({
      id: 'alert-edd-1',
      status: 'OPEN',
      sourceType: 'ONBOARDING_JOURNEY',
      recommendedDecisions: ['APPROVE', 'REJECT'],
      linkedCaseIds: ['edd-1'],
      decisionRecordIds: ['dr-edd-1'],
      events: [],
    });
    riskEngineMock.evaluate.mockResolvedValue({
      decision: 'REVIEW',
      decisionRecordId: 'dr-edd-1',
      reasonCodes: ['EDD_CLEAR'],
      recommendedActions: [
        {
          type: 'UPSERT_ALERT',
          payload: {
            severity: 'LOW',
            recommendation: 'REVIEW',
          },
        },
        {
          type: 'ONBOARDING_RECOMMEND_DECISIONS',
          payload: { decisions: ['APPROVE', 'REJECT'] },
        },
      ],
    });

    await service.mockCompleteSession('c1', 'c1', 'ses-edd-1');

    expect(riskEngineMock.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        contextType: 'ONBOARDING_EDD',
        ownerType: 'CUSTOMER',
        ownerId: 'c1',
        subjectType: 'CORPORATE_ENTITY',
        subjectId: 'corp-1',
      }),
    );
  });
});
