import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import { OnboardingService } from './onboarding.service';
import { WORKFLOW_TRANSITION_CODES } from './onboarding-workflow-transition.service';

describe('OnboardingService', () => {
  const prismaMock: any = {
    $transaction: jest.fn(),
    customerMain: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    cddResponse: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    cddResponseReport: {
      create: jest.fn(),
    },
    eddResponse: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    eddResponseReport: {
      create: jest.fn(),
    },
    complianceSession: {
      findMany: jest.fn(),
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
    workflowDecisionRecord: {
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

  const onboardingFinalApprovalServiceMock: any = {
    proxyFinalDecision: jest.fn(),
    submitFinalApproval: jest.fn(),
    emitSubmittedSideEffects: jest.fn(),
  };

  let service: OnboardingService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AuditLogsService.prototype, 'recordByActor').mockResolvedValue({} as any);
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
      onboardingFinalApprovalServiceMock,
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
      onboardingStatus: 'PENDING_CDD_INPUT',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      activeJourneyId: 'ONB-1',
    };
    const cddResponse = {
      id: 'cdd-1',
      customerId: 'c1',
      caseNo: 'CDD2602010001',
      journeyId: 'ONB-1',
      subjectKind: 'INDIVIDUAL_CUSTOMER',
      subjectRefId: 'c1',
    };

    prismaMock.complianceSession.findFirst.mockResolvedValue(session);
    prismaMock.complianceSession.update.mockResolvedValue({ id: session.id });
    prismaMock.cddResponse.findUnique.mockResolvedValue(cddResponse);
    prismaMock.cddResponse.update.mockResolvedValue({ id: cddResponse.id });
    prismaMock.cddResponseReport.create.mockResolvedValue({ id: 'cdr-1' });
    prismaMock.customerMain.findUnique.mockResolvedValue(customer);
    prismaMock.customerMain.update.mockResolvedValue({
      ...customer,
      onboardingStatus: 'CDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
    });
    prismaMock.onboardingAuditLog.create.mockResolvedValue({ id: 'audit-1' });
    prismaMock.complianceAlert.findFirst.mockResolvedValue(null);
    orchestratorMock.orchestrate.mockResolvedValue({
      workflow: 'ONBOARDING',
      stage: 'REVIEW_CDD',
      rule: 'ONB_CDD_REVIEW_REQUIRED',
      recommendedDecisions: ['CLEAR', 'REJECT', 'REQUIRE_EDD'],
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
      recommendedDecisions: ['CLEAR', 'REJECT', 'REQUIRE_EDD'],
      linkedCaseIds: ['cdd-1'],
      decisionRecordIds: ['dr-low'],
      events: [],
    });
    complianceIncidentsMock.createFromAlert.mockResolvedValue({ id: 'inc-1' });
    complianceIncidentsMock.findOne.mockResolvedValue({ id: 'inc-1', status: 'ASSIGNED' });

    return { session, customer, cddResponse };
  };

  const seedAlertDecisionFlow = (overrides?: {
    alert?: Record<string, unknown>;
    customer?: Record<string, unknown>;
    cddResponse?: Record<string, unknown>;
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
      onboardingStatus: 'CDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      activeJourneyId: 'ONB-1',
      currentCddResponseId: 'cdd-1',
      latestDecisionRecordId: 'dr-1',
      eddRequired: false,
      activeCaseId: 'cdd-1',
      ...overrides?.customer,
    };
    const cddResponse = {
      id: 'cdd-1',
      customerId: 'c1',
      journeyId: 'ONB-1',
      status: 'FINAL',
      ...overrides?.cddResponse,
    };

    prismaMock.complianceAlert.findUnique.mockResolvedValue(alert);
    prismaMock.complianceAlert.update.mockResolvedValue({
      ...alert,
      decision: 'CLEAR',
    });
    prismaMock.complianceAlertEvent.create.mockResolvedValue({ id: 'alevt-1' });
    prismaMock.customerMain.findUnique.mockResolvedValue(customer);
    prismaMock.cddResponse.findUnique.mockResolvedValue(cddResponse);
    prismaMock.cddResponse.findFirst.mockResolvedValue(cddResponse);
    prismaMock.cddResponse.update.mockResolvedValue(cddResponse);
    prismaMock.customerMain.update.mockResolvedValue({
      ...customer,
      onboardingStatus: 'APPROVED',
      operatingStatus: 'ACTIVE',
      eddRequired: false,
      activeCaseId: null,
    });
    prismaMock.eddResponse.findFirst.mockResolvedValue(null);
    prismaMock.eddResponse.create.mockResolvedValue({
      id: 'edd-1',
      caseNo: 'EDD2603010001',
      customerId: 'c1',
      cddResponseId: 'cdd-1',
      journeyId: 'ONB-1',
      status: 'CREATED',
    });
    orchestratorMock.findAlertDetail.mockResolvedValue({
      id: 'alert-onb-1',
      status: 'ASSIGNED',
      sourceType: 'ONBOARDING_JOURNEY',
      assigneeUserId: 'admin-1',
      decision: 'CLEAR',
      recommendedDecisions: ['CLEAR', 'REJECT', 'REQUIRE_EDD'],
      linkedCaseIds: ['cdd-1'],
      decisionRecordIds: ['dr-1'],
      events: [],
    });
    workflowTransitionServiceMock.transition.mockResolvedValue({
      workflow: 'ONBOARDING',
      stage: 'REVIEW_CDD',
      dispositionCode: 'CLEAR',
      transitionCode: WORKFLOW_TRANSITION_CODES.CDD_APPROVE_TO_ACTIVE,
      fromStatus: 'REVIEW_CDD',
      toStatus: 'ACTIVE',
      executed: true,
      updatedCustomer: {
        ...customer,
        onboardingStatus: 'APPROVED',
        operatingStatus: 'ACTIVE',
        eddRequired: false,
        activeCaseId: null,
      },
      eddResponse: null,
      activeCaseId: null,
      finalApprovalStatus: 'APPROVED',
    });
    prismaMock.onboardingAuditLog.create.mockResolvedValue({ id: 'audit-alert-1' });

    return {
      alert,
      customer,
      cddResponse,
    };
  };

  it('should allow trading when canonical onboarding is APPROVED and active', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU1',
      onboardingStatus: 'APPROVED',
      operatingStatus: 'ACTIVE',
      restrictionStatus: 'CLEAR',
      complianceHoldStatus: 'ACTIVE',
      complianceHoldCaseId: null,
    });

    await expect(service.assertTradingEligibility('c1', 'SWAP')).resolves.toBeUndefined();
  });

  it('should block trading when restriction status is RESTRICTED', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU1',
      onboardingStatus: 'APPROVED',
      operatingStatus: 'ACTIVE',
      restrictionStatus: 'RESTRICTED',
      complianceHoldStatus: 'ACTIVE',
      complianceHoldCaseId: null,
    });

    await expect(service.assertTradingEligibility('c1', 'WITHDRAW')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('should block trading when canonical onboarding is not approved active', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU1',
      onboardingStatus: 'CDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      complianceHoldStatus: 'ACTIVE',
      complianceHoldCaseId: null,
    });

    await expect(service.assertTradingEligibility('c1', 'WITHDRAW')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('should block trading when compliance hold is FROZEN', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU1',
      onboardingStatus: 'APPROVED',
      operatingStatus: 'ACTIVE',
      restrictionStatus: 'CLEAR',
      complianceHoldStatus: 'FROZEN',
      complianceHoldCaseId: 'inc-1',
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

  it('should derive REVIEW_CDD next step from canonical onboarding status', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'CDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      activeJourneyId: 'ONB-1',
      eddRequired: false,
    });
    prismaMock.cddResponse.findFirst.mockResolvedValue({ id: 'cdd-1' });

    const result = await service.getNextStep('c1');

    expect(result.actions).toEqual([{ type: 'WAIT_REVIEW' }]);
    expect(result.activeCaseId).toBe('cdd-1');
    expect(result.requiresEdd).toBe(false);
  });

  it('should list CDD responses across workflows when workflow filter is omitted', async () => {
    prismaMock.cddResponse.count.mockResolvedValue(1);
    prismaMock.cddResponse.findMany.mockResolvedValue([
      {
        id: 'cdd-prr-1',
        workflow: 'PERIODIC_REVIEW',
      },
    ]);

    const result = await service.listCddResponses({});

    expect(prismaMock.cddResponse.count).toHaveBeenCalledWith({ where: {} });
    expect(prismaMock.cddResponse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
      }),
    );
    expect(result.items[0].workflow).toBe('PERIODIC_REVIEW');
  });

  it('should return periodic review EDD response detail', async () => {
    prismaMock.eddResponse.findUnique.mockResolvedValue({
      id: 'edd-prr-1',
      workflow: 'PERIODIC_REVIEW',
      reports: [],
      customer: {
        id: 'c1',
        customerNo: 'CU0001',
        email: 'demo@example.com',
        firstName: 'Demo',
        lastName: 'User',
        companyName: null,
        customerType: 'INDIVIDUAL',
        onboardingStatus: 'APPROVED',
        operatingStatus: 'ACTIVE',
        restrictionStatus: 'CLEAR',
        complianceHoldStatus: 'ACTIVE',
      },
      inputData: '{"provider":"MOCK"}',
    });

    const result = await service.getEddResponseDetail('edd-prr-1');

    expect(result.workflow).toBe('PERIODIC_REVIEW');
    expect(result.customerSnapshot.customerNo).toBe('CU0001');
    expect(result.mockDetail).toEqual({ provider: 'MOCK' });
  });

  it('should return WAIT_REVIEW action when canonical onboarding is CDD_UNDER_REVIEW', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'CDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      activeJourneyId: 'ONB-1',
      eddRequired: false,
    });
    prismaMock.cddResponse.findFirst.mockResolvedValue({ id: 'cdd-1' });

    const result = await service.getNextStep('c1');

    expect(result.actions).toEqual([{ type: 'WAIT_REVIEW' }]);
    expect(result.blockedReason).toContain('waiting compliance handling');
    expect(result.activeCaseId).toBe('cdd-1');
    expect(result.requiresEdd).toBe(false);
  });

  it('should derive FINAL_APPROVAL next step from canonical onboarding status', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'FINAL_APPROVAL',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      activeCaseId: null,
      eddRequired: true,
    });

    const result = await service.getNextStep('c1');

    expect(result.actions).toEqual([{ type: 'WAIT_FINAL_APPROVAL' }]);
    expect(result.blockedReason).toContain('Waiting final onboarding decision');
    expect(result.requiresEdd).toBe(true);
  });

  it('should return REINITIATE_CDD action when canonical onboarding is REJECTED', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'REJECTED',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      activeCaseId: null,
      eddRequired: false,
    });

    const result = await service.getNextStep('c1');

    expect(result.actions).toEqual([{ type: 'REINITIATE_CDD' }]);
    expect(result.blockedReason).toContain('Re-initiate');
  });

  it('should auto-expire ACTIVE customer to PENDING_CDD when cddDocumentExpiresAt passed', async () => {
    prismaMock.customerMain.findUnique
      .mockResolvedValueOnce({
        id: 'c1',
        onboardingStatus: 'APPROVED',
        operatingStatus: 'ACTIVE',
        restrictionStatus: 'CLEAR',
        eddRequired: false,
        cddDocumentExpiresAt: new Date(Date.now() - 60 * 1000),
      })
      .mockResolvedValueOnce({
        id: 'c1',
        onboardingStatus: 'PENDING_CDD_INPUT',
        operatingStatus: 'INACTIVE',
        restrictionStatus: 'CLEAR',
        eddRequired: false,
      });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'PENDING_CDD_INPUT',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
    });

    const result = await service.getNextStep('c1');

    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({
          onboardingStatus: 'PENDING_CDD_INPUT',
          operatingStatus: 'INACTIVE',
          restrictionStatus: 'CLEAR',
        }),
      }),
    );
    expect(result.actions).toEqual([{ type: 'COMPLETE_CDD' }]);
  });

  it('should auto-expire and block DEPOSIT trading when canonical CDD is expired', async () => {
    prismaMock.customerMain.findUnique
      .mockResolvedValueOnce({
        id: 'c1',
        onboardingStatus: 'APPROVED',
        operatingStatus: 'ACTIVE',
        restrictionStatus: 'CLEAR',
        cddDocumentExpiresAt: new Date(Date.now() - 60 * 1000),
      })
      .mockResolvedValueOnce({
        id: 'c1',
        customerNo: 'CU1',
        onboardingStatus: 'PENDING_CDD_INPUT',
        operatingStatus: 'INACTIVE',
        restrictionStatus: 'CLEAR',
        complianceHoldStatus: 'ACTIVE',
        complianceHoldCaseId: null,
      });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'PENDING_CDD_INPUT',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
    });

    await expect(service.assertTradingEligibility('c1', 'DEPOSIT')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prismaMock.customerMain.update).toHaveBeenCalledTimes(1);
  });

  it('should reject start EDD when canonical onboarding is not pending EDD', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'PENDING_CDD_INPUT',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      currentEddResponseId: 'edd-1',
    });

    await expect(service.startEddResponses('c1', 'c1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should reject creating session for non-created case', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
    });
    prismaMock.cddResponse.findUnique.mockResolvedValue({
      id: 'case-1',
      customerId: 'c1',
      workflow: 'ONBOARDING',
      status: 'FINAL',
    });

    await expect(
      service.createCaseSession('c1', 'c1', 'case-1', { responseType: 'CDD', provider: 'MOCK' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should expose response-only fields on onboarding response list', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({ id: 'c1' });
    prismaMock.cddResponse.findMany.mockResolvedValue([
      {
        id: 'cdd-1',
        caseNo: 'CDD2602010001',
        customerId: 'c1',
        inputData: '{}',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
      },
    ]);
    prismaMock.eddResponse.findMany.mockResolvedValue([]);
    prismaMock.complianceSession.findMany.mockResolvedValue([]);

    const result = await service.listMyResponses('c1');

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        responseNo: 'CDD2602010001',
        responseType: 'CDD',
      }),
    );
  });

  it('should accept responseType when creating onboarding response session', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({ id: 'c1' });
    prismaMock.cddResponse.findUnique.mockResolvedValue({
      id: 'case-1',
      customerId: 'c1',
      workflow: 'ONBOARDING',
      status: 'CREATED',
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
      onboardingStatus: 'REJECTED',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
    });
    prismaMock.customerMain.update.mockResolvedValue({});
    jest.spyOn(service, 'startCddResponses').mockResolvedValue({
      journeyId: 'ONB-2',
      currentCddResponseId: 'case-2',
      session: null,
      actions: [{ type: 'COMPLETE_CDD' }],
    } as any);

    await service.reinitiateCddResponses('c1', 'c1');

    expect(prismaMock.customerMain.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({
        cddDocumentExpiresAt: null,
        latestFinalApproval: { disconnect: true },
        latestFinalApprovalStatus: null,
      }),
    });
  });

  it('should recompute NONE status into baseline canonical snapshot', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'NONE',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
    });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'NONE',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      eddRequired: false,
    });

    const result = await service.recomputeComplianceSnapshot('c1', 'ONB-1');

    expect(prismaMock.customerMain.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({
        onboardingStatus: 'NONE',
        operatingStatus: 'INACTIVE',
        restrictionStatus: 'CLEAR',
        eddRequired: false,
      }),
    });
    expect(result.onboardingStatus).toBe('NONE');
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
        { decision: 'CLEAR' },
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
        { decision: 'CLEAR' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('should reject REQUIRE_EDD decision when onboarding is in REVIEW_EDD', async () => {
    seedAlertDecisionFlow({
      customer: {
        onboardingStatus: 'EDD_UNDER_REVIEW',
        operatingStatus: 'INACTIVE',
        currentEddResponseId: 'edd-1',
      },
      alert: {
        linkedCaseIds: '["edd-1"]',
      },
    });
    prismaMock.eddResponse.findUnique.mockResolvedValue({
      id: 'edd-1',
      customerId: 'c1',
      journeyId: 'ONB-1',
      status: 'FINAL',
    });
    prismaMock.eddResponse.findFirst.mockResolvedValue({
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

  it('should apply CLEAR decision and move onboarding to ACTIVE', async () => {
    seedAlertDecisionFlow();
    const result = await service.applyOnboardingDecisionFromAlert(
      'alert-onb-1',
      'admin-1',
      'COMPLIANCE_LEAD',
      { decision: 'CLEAR' },
    );

    expect(workflowTransitionServiceMock.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        customerMain: prismaMock.customerMain,
      }),
      expect.objectContaining({
        workflow: 'ONBOARDING',
        stage: 'REVIEW_CDD',
        producerType: 'ALERT',
        dispositionCode: 'CLEAR',
      }),
    );
    expect(prismaMock.complianceAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decision: 'CLEAR',
          decisionRecommendation: 'CLEAR',
        }),
      }),
    );
    expect(result.customer.onboardingStatus).toBe('APPROVED');
    expect(result.customer.operatingStatus).toBe('ACTIVE');
    expect(result.alert.status).toBe('ASSIGNED');
  });

  it('should apply REJECT decision and move onboarding to REJECTED', async () => {
    seedAlertDecisionFlow();
    workflowTransitionServiceMock.transition.mockResolvedValue({
      workflow: 'ONBOARDING',
      stage: 'REVIEW_CDD',
      dispositionCode: 'REJECT',
      transitionCode: WORKFLOW_TRANSITION_CODES.CDD_REJECT_TO_REJECTED,
      fromStatus: 'REVIEW_CDD',
      toStatus: 'REJECTED',
      executed: true,
      updatedCustomer: {
        id: 'c1',
        onboardingStatus: 'REJECTED',
        operatingStatus: 'INACTIVE',
        eddRequired: false,
        activeCaseId: null,
        customerNo: 'CU0001',
      },
      eddResponse: null,
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
        dispositionCode: 'REJECT',
      }),
    );
    expect(result.customer.onboardingStatus).toBe('REJECTED');
  });

  it('should apply REQUIRE_EDD decision and create EDD case', async () => {
    seedAlertDecisionFlow();
    const eddResponse = {
      id: 'edd-1',
      caseNo: 'EDD2603010001',
      customerId: 'c1',
      cddResponseId: 'cdd-1',
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
        onboardingStatus: 'PENDING_EDD_INPUT',
        operatingStatus: 'INACTIVE',
        eddRequired: true,
        activeCaseId: 'edd-1',
        customerNo: 'CU0001',
      },
      eddResponse,
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
    expect(result.customer.onboardingStatus).toBe('PENDING_EDD_INPUT');
    expect(result.eddResponse?.id).toBe('edd-1');
    expect(prismaMock.complianceAlert.update).toHaveBeenCalledTimes(2);
  });

  it('should auto-pass CDD LOW_RISK to ACTIVE without creating onboarding alert', async () => {
    seedCddMockFlow();
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'APPROVED',
      operatingStatus: 'ACTIVE',
      restrictionStatus: 'CLEAR',
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
          payload: { decisions: ['CLEAR', 'REJECT', 'REQUIRE_EDD'] },
        },
      ],
    });

    const result = await service.mockCompleteSession('c1', 'c1', 'ses-1', {
      mockDataType: 'LOW_RISK',
    });

    const receivedUpdate = prismaMock.cddResponse.update.mock.calls[0][0];
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
    const finalizedUpdate = prismaMock.cddResponse.update.mock.calls[1][0];
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
          onboardingStatus: 'APPROVED',
          operatingStatus: 'ACTIVE',
          restrictionStatus: 'CLEAR',
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
    expect(result.actions).toEqual([{ type: 'NONE' }]);
  });

  it('should create OPEN alert with recommendation for CDD MEDIUM_RISK', async () => {
    seedCddMockFlow();
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'CDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
          payload: { decisions: ['CLEAR', 'REJECT', 'REQUIRE_EDD'] },
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
    expect(result.actions).toEqual([{ type: 'WAIT_REVIEW' }]);
  });

  it('should keep high-risk CDD in REVIEW_CDD and not auto-create incident', async () => {
    seedCddMockFlow();
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'CDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
          payload: { decisions: ['CLEAR', 'REJECT', 'REQUIRE_EDD'] },
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
    expect(result.actions).toEqual([{ type: 'WAIT_REVIEW' }]);
  });

  it('should keep SANCTION_AND_OTHER CDD mock in alert triage without auto-creating incident', async () => {
    seedCddMockFlow();
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'CDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
          payload: { decisions: ['CLEAR', 'REJECT', 'REQUIRE_EDD'] },
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
    expect(result.actions).toEqual([{ type: 'WAIT_REVIEW' }]);
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
    prismaMock.eddResponse.findUnique.mockResolvedValue({
      id: 'edd-1',
      customerId: 'c1',
      caseNo: 'EDD2602010001',
      subjectKind: 'CORPORATE_ENTITY',
      subjectRefId: 'corp-1',
      status: 'CREATED',
    });
    prismaMock.eddResponse.update.mockResolvedValue({ id: 'edd-1' });
    prismaMock.eddResponseReport.create.mockResolvedValue({ id: 'edr-1' });
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'PENDING_EDD_INPUT',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      activeJourneyId: 'ONB-1',
      currentEddResponseId: 'edd-1',
    });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'EDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
    });
    prismaMock.onboardingAuditLog.create.mockResolvedValue({ id: 'audit-edd-1' });
    orchestratorMock.orchestrate.mockResolvedValue({
      workflow: 'ONBOARDING',
      stage: 'REVIEW_EDD',
      rule: 'ONB_EDD_REVIEW_REQUIRED',
      recommendedDecisions: ['CLEAR', 'REJECT'],
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
      recommendedDecisions: ['CLEAR', 'REJECT'],
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
          payload: { decisions: ['CLEAR', 'REJECT'] },
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

  it('should delegate final approval submission to onboarding final approval service', async () => {
    onboardingFinalApprovalServiceMock.submitFinalApproval.mockResolvedValue({
      id: 'approval-1',
      approvalNo: 'APR2603180001',
      status: 'PENDING',
    });

    const result = await service.submitCustomerFinalApproval('c1', 'admin-1', 'COMPLIANCE_LEAD', {
      reason: 'submit',
    });

    expect(onboardingFinalApprovalServiceMock.submitFinalApproval).toHaveBeenCalledWith(
      'c1',
      'admin-1',
      'COMPLIANCE_LEAD',
      { reason: 'submit' },
    );
    expect(result.approvalNo).toBe('APR2603180001');
  });

});
