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
    createPendingDecisionRecord: jest.fn(),
    completeDecisionRecord: jest.fn(),
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

  const onboardingFinalApprovalServiceMock: any = {
    proxyFinalDecision: jest.fn(),
    emitSubmittedSideEffects: jest.fn(),
    ensurePendingApprovalInTransaction: jest.fn(),
  };

  const sumsubClientMock: any = {
    createApplicant: jest.fn(),
    createSdkToken: jest.fn(),
    getApplicantByExternalUserId: jest.fn(),
    getApplicantReviewStatus: jest.fn(),
    changeLevel: jest.fn(),
  };

  let service: OnboardingService;
  let recordByActorSpy: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    recordByActorSpy = jest.fn().mockResolvedValue({});
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
    prismaMock.complianceAlertDispositionRecord.create.mockResolvedValue({
      id: 'alert-disp-1',
    });
    prismaMock.complianceIncidentDispositionRecord.create.mockResolvedValue({
      id: 'case-disp-1',
    });
    onboardingFinalApprovalServiceMock.ensurePendingApprovalInTransaction.mockResolvedValue({
      approval: {
        id: 'approval-1',
        approvalNo: 'APP-1',
        status: 'PENDING',
      },
      created: true,
      auditAction: 'FINAL_APPROVAL_SUBMITTED',
    });
    service = new OnboardingService(
      prismaMock,
      onboardingFinalApprovalServiceMock,
      sumsubClientMock,
      { recordByActor: recordByActorSpy, recordSystem: jest.fn().mockResolvedValue({}) } as any,
    );
  });

  const buildVerificationCustomer = (overrides?: Record<string, unknown>) => ({
    id: 'customer-1',
    customerNo: 'CU0001',
    customerType: 'INDIVIDUAL',
    onboardingStatus: 'PENDING_VERIFICATION',
    adminStatus: 'INACTIVE',
    complianceStatus: 'CLEAR',
    verificationProvider: 'SUMSUB',
    verificationSubstatus: 'CREATED',
    verificationCustomerActionRequired: true,
    verificationCanContinue: true,
    verificationLatestEventType: null,
    verificationLatestEventAt: null,
    sumsubApplicantId: 'app-1',
    sumsubCurrentLevelName: 'wave3-level-1',
    sumsubLatestReviewId: null,
    sumsubLatestAttemptId: null,
    sumsubExperiencedLevel2: false,
    latestRiskApprovalId: null,
    latestRiskApprovalStatus: null,
    eddRequired: false,
    ...overrides,
  });

  const seedVerificationEventFlow = (customerOverrides?: Record<string, unknown>) => {
    const customer = buildVerificationCustomer(customerOverrides);
    prismaMock.customerMain.findUnique.mockResolvedValue(customer);
    prismaMock.customerMain.update.mockImplementation(async ({ data }: any) => ({
      ...customer,
      ...data,
    }));
    return customer;
  };

  describe('handleSumsubVerificationEvent', () => {
    it('keeps onboarding pending with SUBMITTED substatus for applicantPending', async () => {
      seedVerificationEventFlow();

      const result = await service.handleSumsubVerificationEvent(
        {
          type: 'applicantPending',
          applicantId: 'app-1',
          applicantType: 'individual',
        },
        { simulated: false, actorId: 'SUMSUB' },
      );

      expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'customer-1' },
          data: expect.objectContaining({
            onboardingStatus: 'PENDING_VERIFICATION',
            verificationSubstatus: 'SUBMITTED',
            verificationCustomerActionRequired: false,
            verificationCanContinue: false,
            verificationLatestEventType: 'applicantPending',
          }),
        }),
      );
      expect(result.customer.onboardingStatus).toBe('PENDING_VERIFICATION');
      expect(result.verification.substatus).toBe('SUBMITTED');
    });

    it('keeps onboarding pending with UNDER_REVIEW substatus for applicantOnHold', async () => {
      seedVerificationEventFlow();

      const result = await service.handleSumsubVerificationEvent(
        {
          type: 'applicantOnHold',
          applicantId: 'app-1',
        },
        { simulated: false, actorId: 'SUMSUB' },
      );

      expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStatus: 'PENDING_VERIFICATION',
            verificationSubstatus: 'UNDER_REVIEW',
            verificationCustomerActionRequired: false,
            verificationCanContinue: false,
          }),
        }),
      );
      expect(result.verification.substatus).toBe('UNDER_REVIEW');
    });

    it('keeps onboarding pending and allows continuation when review is RED with RETRY', async () => {
      seedVerificationEventFlow();

      const result = await service.handleSumsubVerificationEvent(
        {
          type: 'applicantReviewed',
          applicantId: 'app-1',
          reviewResult: {
            reviewAnswer: 'RED',
            reviewRejectType: 'RETRY',
            reviewId: 'rev-1',
          },
        },
        { simulated: false, actorId: 'SUMSUB' },
      );

      expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStatus: 'PENDING_VERIFICATION',
            verificationSubstatus: 'RESUBMIT_REQUIRED',
            verificationCustomerActionRequired: true,
            verificationCanContinue: true,
            sumsubLatestReviewId: 'rev-1',
          }),
        }),
      );
      expect(result.verification.substatus).toBe('RESUBMIT_REQUIRED');
      expect(result.verification.canContinue).toBe(true);
    });

    it('marks level2 experience and keeps onboarding pending for applicantLevelChanged', async () => {
      seedVerificationEventFlow();

      const result = await service.handleSumsubVerificationEvent(
        {
          type: 'applicantLevelChanged',
          applicantId: 'app-1',
          levelName: 'wave3-level-2',
        },
        { simulated: false, actorId: 'SUMSUB' },
      );

      expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStatus: 'PENDING_VERIFICATION',
            verificationSubstatus: 'NEXT_LEVEL_REQUIRED',
            verificationCanContinue: true,
            verificationCustomerActionRequired: false,
            sumsubCurrentLevelName: 'wave3-level-2',
            sumsubExperiencedLevel2: true,
          }),
        }),
      );
      expect(result.verification.substatus).toBe('NEXT_LEVEL_REQUIRED');
      expect(result.verification.experiencedLevel2).toBe(true);
    });

    it('approves and activates customer when workflow completes without level2', async () => {
      seedVerificationEventFlow({
        sumsubExperiencedLevel2: false,
        verificationSubstatus: 'UNDER_REVIEW',
      });

      const result = await service.handleSumsubVerificationEvent(
        {
          type: 'applicantWorkflowCompleted',
          applicantId: 'app-1',
        },
        { simulated: false, actorId: 'SUMSUB' },
      );

      expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStatus: 'APPROVED',
            adminStatus: 'ACTIVE',
            verificationSubstatus: 'COMPLETED',
            latestRiskApprovalStatus: null,
          }),
        }),
      );
      expect(onboardingFinalApprovalServiceMock.ensurePendingApprovalInTransaction).not.toHaveBeenCalled();
      expect(result.customer.onboardingStatus).toBe('APPROVED');
      expect(result.customer.adminStatus).toBe('ACTIVE');
    });

    it('routes workflow completion with level2 into FINAL_APPROVAL and ensures pending approval', async () => {
      seedVerificationEventFlow({
        sumsubExperiencedLevel2: true,
        verificationSubstatus: 'UNDER_REVIEW',
      });

      const result = await service.handleSumsubVerificationEvent(
        {
          type: 'applicantWorkflowCompleted',
          applicantId: 'app-1',
        },
        { simulated: false, actorId: 'SUMSUB' },
      );

      expect(onboardingFinalApprovalServiceMock.ensurePendingApprovalInTransaction).toHaveBeenCalledWith(
        prismaMock,
        expect.objectContaining({
          customer: expect.objectContaining({
            id: 'customer-1',
            onboardingStatus: 'FINAL_APPROVAL',
          }),
          actorId: 'SUMSUB',
          actorRole: 'SYSTEM',
        }),
      );
      expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStatus: 'FINAL_APPROVAL',
            verificationSubstatus: 'COMPLETED',
            latestRiskApprovalStatus: 'PENDING',
          }),
        }),
      );
      expect(result.customer.onboardingStatus).toBe('FINAL_APPROVAL');
      expect(result.customer.adminStatus).toBe('INACTIVE');
    });

    it('rejects onboarding when workflow fails', async () => {
      seedVerificationEventFlow({
        verificationSubstatus: 'UNDER_REVIEW',
        sumsubExperiencedLevel2: true,
      });

      const result = await service.handleSumsubVerificationEvent(
        {
          type: 'applicantWorkflowFailed',
          applicantId: 'app-1',
        },
        { simulated: false, actorId: 'SUMSUB' },
      );

      expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStatus: 'REJECTED',
            adminStatus: 'INACTIVE',
            verificationSubstatus: 'FAILED',
          }),
        }),
      );
      expect(result.customer.onboardingStatus).toBe('REJECTED');
    });

    it('keeps onboarding pending with PROCESSING substatus for unknown events', async () => {
      seedVerificationEventFlow();

      const result = await service.handleSumsubVerificationEvent(
        {
          type: 'applicantMysteryEvent',
          applicantId: 'app-1',
        },
        { simulated: false, actorId: 'SUMSUB' },
      );

      expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStatus: 'PENDING_VERIFICATION',
            verificationSubstatus: 'PROCESSING',
            verificationLatestEventType: 'applicantMysteryEvent',
          }),
        }),
      );
      expect(result.customer.onboardingStatus).toBe('PENDING_VERIFICATION');
      expect(result.verification.substatus).toBe('PROCESSING');
    });

    it('does not regress APPROVED customers when a late webhook arrives', async () => {
      const customer = buildVerificationCustomer({
        onboardingStatus: 'APPROVED',
        adminStatus: 'ACTIVE',
        verificationSubstatus: 'COMPLETED',
        verificationCustomerActionRequired: false,
        verificationCanContinue: false,
      });
      prismaMock.customerMain.findUnique.mockResolvedValue(customer);

      const result = await service.handleSumsubVerificationEvent(
        {
          type: 'applicantPending',
          applicantId: 'app-1',
        },
        { simulated: false, actorId: 'SUMSUB' },
      );

      expect(prismaMock.customerMain.update).not.toHaveBeenCalled();
      expect(result.customer.onboardingStatus).toBe('APPROVED');
      expect(result.customer.adminStatus).toBe('ACTIVE');
      expect(result.verification.substatus).toBe('COMPLETED');
    });

    it('rejects webhook payloads whose applicantId and externalUserId point to different customers', async () => {
      prismaMock.customerMain.findUnique.mockImplementation(async ({ where }: any) => {
        if (where?.sumsubApplicantId === 'app-1') {
          return buildVerificationCustomer({ id: 'customer-1', sumsubApplicantId: 'app-1' });
        }
        if (where?.id === 'customer-2') {
          return buildVerificationCustomer({ id: 'customer-2', sumsubApplicantId: 'app-2' });
        }
        return null;
      });

      await expect(
        service.handleSumsubVerificationEvent(
          {
            type: 'applicantPending',
            applicantId: 'app-1',
            externalUserId: 'customer-2',
          },
          { simulated: false, actorId: 'SUMSUB' },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.customerMain.update).not.toHaveBeenCalled();
    });

    it('rejects webhook payloads when applicantId is present but no applicant-linked customer exists', async () => {
      prismaMock.customerMain.findUnique.mockImplementation(async ({ where }: any) => {
        if (where?.sumsubApplicantId === 'app-missing') {
          return null;
        }
        if (where?.id === 'customer-2') {
          return buildVerificationCustomer({ id: 'customer-2', sumsubApplicantId: 'app-2' });
        }
        return null;
      });

      await expect(
        service.handleSumsubVerificationEvent(
          {
            type: 'applicantPending',
            applicantId: 'app-missing',
            externalUserId: 'customer-2',
          },
          { simulated: false, actorId: 'SUMSUB' },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.customerMain.update).not.toHaveBeenCalled();
    });

    it('writes a DATA_UPDATE audit row for a real applicantOnHold webhook with traceId from customer', async () => {
      const existingTrace = '22222222-2222-4222-8222-222222222222';
      seedVerificationEventFlow({
        id: 'customer-1',
        customerNo: 'CU0001',
        onboardingTraceId: existingTrace,
        onboardingStatus: 'PENDING_VERIFICATION',
        verificationSubstatus: 'SUBMITTED',
        sumsubApplicantId: 'APPL-1',
      });

      await service.handleSumsubVerificationEvent(
        {
          type: 'applicantOnHold',
          externalUserId: 'customer-1',
          applicantId: 'APPL-1',
        },
        {
          simulated: false,
          actorId: 'SUMSUB',
        },
      );

      expect(recordByActorSpy).toHaveBeenCalledTimes(1);
      const [auditInput, actor] = recordByActorSpy.mock.calls[0];
      expect(auditInput.action).toBe('SUMSUB_APPLICANT_ON_HOLD');
      expect(auditInput.entityType).toBe('ONBOARDING');
      expect(auditInput.entityId).toBe('customer-1');
      expect(auditInput.traceId).toBe(existingTrace);
      expect(auditInput.workflowType).toBe('ONBOARDING');
      // workflowId and workflowNo MUST NOT be set (new rule)
      expect((auditInput as any).workflowId).toBeUndefined();
      expect((auditInput as any).workflowNo).toBeUndefined();
      expect((auditInput.metadata as any).eventType).toBe('applicantOnHold');
      expect((auditInput.metadata as any).substatusFrom).toBe('SUBMITTED');
      expect((auditInput.metadata as any).substatusTo).toBe('UNDER_REVIEW');
      expect((auditInput.metadata as any).isSimulated).toBe(false);
      expect(actor.actorId).toBe('SUMSUB');
      expect(actor.actorType).toBe('SYSTEM');
    });

    it('writes a DATA_UPDATE audit row with ADMIN actorType for a simulated event', async () => {
      const simulatedTrace = '33333333-3333-4333-8333-333333333333';
      seedVerificationEventFlow({
        id: 'customer-1',
        customerNo: 'CU0001',
        onboardingTraceId: simulatedTrace,
        onboardingStatus: 'PENDING_VERIFICATION',
        verificationSubstatus: 'SUBMITTED',
      });

      await service.handleSumsubVerificationEvent(
        {
          type: 'applicantOnHold',
          externalUserId: 'customer-1',
        },
        {
          simulated: true,
          actorId: 'customer-1',
          simulatedByUserId: 'admin-uuid-42',
        },
      );

      expect(recordByActorSpy).toHaveBeenCalledTimes(1);
      const [auditInput, actor] = recordByActorSpy.mock.calls[0];
      expect(auditInput.action).toBe('SUMSUB_APPLICANT_ON_HOLD');
      expect((auditInput.metadata as any).isSimulated).toBe(true);
      expect((auditInput.metadata as any).simulatedByUserId).toBe('admin-uuid-42');
      expect(actor.actorType).toBe('ADMIN');
      expect(actor.actorId).toBe('admin-uuid-42');
      expect(auditInput.reason).toContain('Simulated sumsub event applicantOnHold');
    });
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
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
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
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
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
    return { session, customer, cddResponse };
  };

  it('should allow trading when canonical onboarding is APPROVED and active', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU1',
      onboardingStatus: 'APPROVED',
      adminStatus: 'ACTIVE',
      complianceStatus: 'CLEAR',
      complianceFreezeCaseId: null,
    });

    await expect(service.assertTradingEligibility('c1', 'SWAP')).resolves.toBeUndefined();
  });

  it('should block trading when compliance status is FROZEN', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU1',
      onboardingStatus: 'APPROVED',
      adminStatus: 'ACTIVE',
      complianceStatus: 'FROZEN',
      complianceFreezeCaseId: null,
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
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      complianceFreezeCaseId: null,
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
      adminStatus: 'ACTIVE',
      complianceStatus: 'FROZEN',
      complianceFreezeCaseId: 'inc-1',
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
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      eddRequired: false,
    });
    prismaMock.cddResponse.findFirst.mockResolvedValue({ id: 'cdd-1' });

    const result = await service.getNextStep('c1');

    expect(result.actions).toEqual([{ type: 'WAIT_REVIEW' }]);
    expect(result.activeCaseId).toBeNull();
    expect(result.requiresEdd).toBe(false);
  });

  it('should return WAIT_REVIEW action when canonical onboarding is CDD_UNDER_REVIEW', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'CDD_UNDER_REVIEW',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      eddRequired: false,
    });
    prismaMock.cddResponse.findFirst.mockResolvedValue({ id: 'cdd-1' });

    const result = await service.getNextStep('c1');

    expect(result.actions).toEqual([{ type: 'WAIT_REVIEW' }]);
    expect(result.blockedReason).toContain('waiting compliance handling');
    expect(result.activeCaseId).toBeNull();
    expect(result.requiresEdd).toBe(false);
  });

  it('should derive FINAL_APPROVAL next step from canonical onboarding status', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'FINAL_APPROVAL',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      activeCaseId: null,
      eddRequired: true,
    });

    const result = await service.getNextStep('c1');

    expect(result.actions).toEqual([{ type: 'WAIT_FINAL_APPROVAL' }]);
    expect(result.blockedReason).toContain('Waiting final onboarding decision');
    expect(result.requiresEdd).toBe(true);
  });

  it.each(['APPROVED', 'FINAL_APPROVAL'] as const)(
    'should reject verification start while onboarding is %s',
    async (status) => {
      prismaMock.customerMain.findUnique.mockResolvedValue({
        id: 'c1',
        customerType: 'INDIVIDUAL',
        onboardingStatus: status,
        adminStatus: status === 'APPROVED' ? 'ACTIVE' : 'INACTIVE',
        complianceStatus: 'CLEAR',
      });

      await expect(service.startVerification('c1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it.each(['PENDING_CDD_INPUT', 'CDD_UNDER_REVIEW', 'PENDING_EDD_INPUT', 'EDD_UNDER_REVIEW'] as const)(
    'should reject verification start while onboarding is legacy raw state %s',
    async (status) => {
      prismaMock.customerMain.findUnique.mockResolvedValue({
        id: 'c1',
        customerType: 'INDIVIDUAL',
        onboardingStatus: status,
        adminStatus: 'INACTIVE',
        complianceStatus: 'CLEAR',
      });

      await expect(service.startVerification('c1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it('should reject verification start when raw onboarding status is unknown', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'SOMETHING_UNKNOWN',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
    });

    await expect(service.startVerification('c1')).rejects.toBeInstanceOf(BadRequestException);
    expect(sumsubClientMock.getApplicantByExternalUserId).not.toHaveBeenCalled();
    expect(sumsubClientMock.createApplicant).not.toHaveBeenCalled();
    expect(sumsubClientMock.createSdkToken).not.toHaveBeenCalled();
  });

  it('should fail closed on next-step projection when raw onboarding status is unknown', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'SOMETHING_UNKNOWN',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
    });

    const result = await service.getNextStep('c1');

    expect(result.actions).toEqual([{ type: 'NONE' }]);
    expect(result.blockedReason).toContain('SOMETHING_UNKNOWN');
  });

  it('should fail closed on onboarding projection when raw onboarding status is unknown', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'SOMETHING_UNKNOWN',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
    });

    const result = await service.getMyOnboarding('c1');

    expect(result.actions).toEqual([{ type: 'NONE' }]);
    expect(result.blockedReason).toContain('SOMETHING_UNKNOWN');
  });

  it('should create Sumsub applicant and return sdk token when starting verification', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'NONE',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      verificationProvider: null,
      verificationSubstatus: null,
      verificationCustomerActionRequired: false,
      verificationCanContinue: false,
      verificationLatestEventType: null,
      verificationLatestEventAt: null,
      sumsubApplicantId: null,
      sumsubCurrentLevelName: null,
      sumsubLatestReviewId: null,
      sumsubLatestAttemptId: null,
      sumsubExperiencedLevel2: true,
      latestRiskApprovalId: 'approval-1',
      latestRiskApprovalStatus: 'PENDING',
    });
    sumsubClientMock.getApplicantByExternalUserId.mockResolvedValue(null);
    sumsubClientMock.createApplicant.mockResolvedValue({ id: 'app-1' });
    sumsubClientMock.createSdkToken.mockResolvedValue({ token: 'sdk-token-1' });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'PENDING_VERIFICATION',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      verificationProvider: 'SUMSUB',
      verificationSubstatus: 'CREATED',
      verificationCustomerActionRequired: true,
      verificationCanContinue: true,
      verificationLatestEventType: null,
      verificationLatestEventAt: null,
      sumsubApplicantId: 'app-1',
      sumsubCurrentLevelName: 'wave3-level-1',
      sumsubLatestReviewId: null,
      sumsubLatestAttemptId: null,
      sumsubExperiencedLevel2: false,
      latestRiskApprovalId: 'approval-1',
      latestRiskApprovalStatus: 'PENDING',
    });

    const result = await service.startVerification('c1');

    expect(sumsubClientMock.createApplicant).toHaveBeenCalledWith({
      externalUserId: 'c1',
      levelName: 'wave3-level-1',
    });
    expect(sumsubClientMock.getApplicantByExternalUserId).toHaveBeenCalledWith('c1');
    expect(sumsubClientMock.createSdkToken).toHaveBeenCalledWith({
      externalUserId: 'c1',
      levelName: 'wave3-level-1',
    });
    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({
          onboardingStatus: 'PENDING_VERIFICATION',
          verificationProvider: 'SUMSUB',
          verificationSubstatus: 'CREATED',
          verificationCustomerActionRequired: true,
          verificationCanContinue: true,
          sumsubApplicantId: 'app-1',
          sumsubCurrentLevelName: 'wave3-level-1',
        }),
      }),
    );
    const firstUpdateData = prismaMock.customerMain.update.mock.calls[0][0].data;
    expect(firstUpdateData.latestRiskApproval).toBeUndefined();
    expect(firstUpdateData.latestRiskApprovalStatus).toBeUndefined();
    expect(result.customer).toEqual({
      onboardingStatus: 'PENDING_VERIFICATION',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
    });
    expect(result.nextStep).toEqual(
      expect.objectContaining({
        actions: [{ type: 'CONTINUE_VERIFICATION' }],
        blockedReason: null,
        activeCaseId: null,
        requiresEdd: false,
      }),
    );
    expect(result.verification).toEqual(
      expect.objectContaining({
        provider: 'SUMSUB',
        applicantId: 'app-1',
        currentLevelName: 'wave3-level-1',
        substatus: 'CREATED',
        customerActionRequired: true,
        canContinue: true,
        sdkToken: 'sdk-token-1',
      }),
    );
  });

  it('should reject continuing verification while pending when canContinue is false', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'PENDING_VERIFICATION',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      verificationProvider: 'SUMSUB',
      verificationSubstatus: 'UNDER_REVIEW',
      verificationCustomerActionRequired: false,
      verificationCanContinue: false,
      verificationLatestEventType: 'applicantReviewed',
      verificationLatestEventAt: new Date('2026-04-01T00:00:00.000Z'),
      sumsubApplicantId: 'app-1',
      sumsubCurrentLevelName: 'wave3-level-1',
      sumsubLatestReviewId: 'rev-1',
      sumsubLatestAttemptId: 'att-1',
      sumsubExperiencedLevel2: false,
    });

    await expect(service.startVerification('c1')).rejects.toBeInstanceOf(BadRequestException);
    expect(sumsubClientMock.createApplicant).not.toHaveBeenCalled();
    expect(sumsubClientMock.getApplicantByExternalUserId).not.toHaveBeenCalled();
    expect(sumsubClientMock.createSdkToken).not.toHaveBeenCalled();
  });

  it('should continue verification while pending without resetting provider projection', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'PENDING_VERIFICATION',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      verificationProvider: 'SUMSUB',
      verificationSubstatus: 'NEXT_LEVEL_REQUIRED',
      verificationCustomerActionRequired: false,
      verificationCanContinue: true,
      verificationLatestEventType: 'applicantReviewed',
      verificationLatestEventAt: new Date('2026-04-01T00:00:00.000Z'),
      sumsubApplicantId: 'app-1',
      sumsubCurrentLevelName: 'wave3-level-2',
      sumsubLatestReviewId: 'rev-1',
      sumsubLatestAttemptId: 'att-1',
      sumsubExperiencedLevel2: true,
    });
    sumsubClientMock.createSdkToken.mockResolvedValue({ token: 'sdk-token-continue' });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'PENDING_VERIFICATION',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      verificationProvider: 'SUMSUB',
      verificationSubstatus: 'NEXT_LEVEL_REQUIRED',
      verificationCustomerActionRequired: false,
      verificationCanContinue: true,
      verificationLatestEventType: 'applicantReviewed',
      verificationLatestEventAt: new Date('2026-04-01T00:00:00.000Z'),
      sumsubApplicantId: 'app-1',
      sumsubCurrentLevelName: 'wave3-level-2',
      sumsubLatestReviewId: 'rev-1',
      sumsubLatestAttemptId: 'att-1',
      sumsubExperiencedLevel2: true,
    });

    const result = await service.startVerification('c1');

    expect(sumsubClientMock.createApplicant).not.toHaveBeenCalled();
    expect(sumsubClientMock.getApplicantByExternalUserId).not.toHaveBeenCalled();
    expect(sumsubClientMock.createSdkToken).toHaveBeenCalledWith({
      externalUserId: 'c1',
      levelName: 'wave3-level-2',
    });
    const updateData = prismaMock.customerMain.update.mock.calls[0][0].data;
    expect(updateData.onboardingStatus).toBe('PENDING_VERIFICATION');
    expect(updateData.sumsubApplicantId).toBeUndefined();
    expect(updateData.sumsubCurrentLevelName).toBeUndefined();
    expect(updateData.verificationSubstatus).toBeUndefined();
    expect(updateData.verificationCustomerActionRequired).toBeUndefined();
    expect(updateData.verificationCanContinue).toBeUndefined();
    expect(result.verification).toEqual(
      expect.objectContaining({
        applicantId: 'app-1',
        currentLevelName: 'wave3-level-2',
        substatus: 'NEXT_LEVEL_REQUIRED',
        customerActionRequired: false,
        canContinue: true,
        latestEventType: 'applicantReviewed',
        sdkToken: 'sdk-token-continue',
      }),
    );
  });

  it('should reject pending verification continue when provider is not Sumsub', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'PENDING_VERIFICATION',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      verificationProvider: 'OTHER',
      verificationSubstatus: 'NEXT_LEVEL_REQUIRED',
      verificationCustomerActionRequired: false,
      verificationCanContinue: true,
      verificationLatestEventType: 'applicantReviewed',
      verificationLatestEventAt: new Date('2026-04-01T00:00:00.000Z'),
      sumsubApplicantId: 'app-1',
      sumsubCurrentLevelName: 'wave3-level-2',
      sumsubLatestReviewId: 'rev-1',
      sumsubLatestAttemptId: 'att-1',
      sumsubExperiencedLevel2: true,
    });

    await expect(service.startVerification('c1')).rejects.toBeInstanceOf(BadRequestException);
    expect(sumsubClientMock.getApplicantByExternalUserId).not.toHaveBeenCalled();
    expect(sumsubClientMock.createApplicant).not.toHaveBeenCalled();
    expect(sumsubClientMock.createSdkToken).not.toHaveBeenCalled();
  });

  it('should reuse existing Sumsub applicant and reset reinitiation fields when restarting verification', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'REJECTED',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      verificationProvider: 'SUMSUB',
      verificationSubstatus: 'FAILED',
      verificationCustomerActionRequired: false,
      verificationCanContinue: false,
      verificationLatestEventType: 'applicantReviewed',
      verificationLatestEventAt: new Date('2026-04-01T00:00:00.000Z'),
      sumsubApplicantId: null,
      sumsubCurrentLevelName: 'wave3-level-2',
      sumsubLatestReviewId: 'rev-1',
      sumsubLatestAttemptId: 'att-1',
      sumsubExperiencedLevel2: true,
      latestRiskApprovalId: 'approval-1',
      latestRiskApprovalStatus: 'PENDING',
    });
    sumsubClientMock.getApplicantByExternalUserId.mockResolvedValue({ id: 'app-remote' });
    sumsubClientMock.createSdkToken.mockResolvedValue({ token: 'sdk-token-2' });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'PENDING_VERIFICATION',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      verificationProvider: 'SUMSUB',
      verificationSubstatus: 'CREATED',
      verificationCustomerActionRequired: true,
      verificationCanContinue: true,
      verificationLatestEventType: null,
      verificationLatestEventAt: null,
      sumsubApplicantId: 'app-remote',
      sumsubCurrentLevelName: 'wave3-level-2',
      sumsubLatestReviewId: null,
      sumsubLatestAttemptId: null,
      sumsubExperiencedLevel2: false,
      latestRiskApprovalId: null,
      latestRiskApprovalStatus: null,
    });

    const result = await service.startVerification('c1');

    expect(sumsubClientMock.createApplicant).not.toHaveBeenCalled();
    expect(sumsubClientMock.getApplicantByExternalUserId).toHaveBeenCalledWith('c1');
    expect(sumsubClientMock.createSdkToken).toHaveBeenCalledWith({
      externalUserId: 'c1',
      levelName: 'wave3-level-2',
    });
    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sumsubExperiencedLevel2: false,
          sumsubLatestReviewId: null,
          sumsubLatestAttemptId: null,
          latestRiskApproval: { disconnect: true },
          latestRiskApprovalStatus: null,
          verificationLatestEventType: null,
          verificationLatestEventAt: null,
        }),
      }),
    );
    expect(result.verification).toEqual(
      expect.objectContaining({
        applicantId: 'app-remote',
        currentLevelName: 'wave3-level-2',
        latestEventType: null,
        latestEventAt: null,
        sdkToken: 'sdk-token-2',
      }),
    );
  });

  it('should assign a UUID v4 onboardingTraceId when customer has none (first call)', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'NONE',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      onboardingTraceId: null,
      verificationProvider: null,
      verificationSubstatus: null,
      verificationCustomerActionRequired: false,
      verificationCanContinue: false,
      verificationLatestEventType: null,
      verificationLatestEventAt: null,
      sumsubApplicantId: null,
      sumsubCurrentLevelName: null,
      sumsubLatestReviewId: null,
      sumsubLatestAttemptId: null,
      sumsubExperiencedLevel2: false,
      latestRiskApprovalId: null,
      latestRiskApprovalStatus: null,
    });
    sumsubClientMock.getApplicantByExternalUserId.mockResolvedValue(null);
    sumsubClientMock.createApplicant.mockResolvedValue({ id: 'app-1' });
    sumsubClientMock.createSdkToken.mockResolvedValue({ token: 'sdk-token-1' });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'PENDING_VERIFICATION',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      verificationProvider: 'SUMSUB',
      verificationSubstatus: 'CREATED',
      verificationCustomerActionRequired: true,
      verificationCanContinue: true,
      verificationLatestEventType: null,
      verificationLatestEventAt: null,
      sumsubApplicantId: 'app-1',
      sumsubCurrentLevelName: 'wave3-level-1',
      sumsubLatestReviewId: null,
      sumsubLatestAttemptId: null,
      sumsubExperiencedLevel2: false,
      latestRiskApprovalId: null,
      latestRiskApprovalStatus: null,
    });

    await service.startVerification('c1');

    const updateData = prismaMock.customerMain.update.mock.calls[0][0].data;
    expect(updateData.onboardingTraceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('should preserve existing onboardingTraceId and not overwrite it on subsequent calls', async () => {
    const existingTraceId = '11111111-1111-4111-8111-111111111111';
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'NONE',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      onboardingTraceId: existingTraceId,
      verificationProvider: null,
      verificationSubstatus: null,
      verificationCustomerActionRequired: false,
      verificationCanContinue: false,
      verificationLatestEventType: null,
      verificationLatestEventAt: null,
      sumsubApplicantId: null,
      sumsubCurrentLevelName: null,
      sumsubLatestReviewId: null,
      sumsubLatestAttemptId: null,
      sumsubExperiencedLevel2: false,
      latestRiskApprovalId: null,
      latestRiskApprovalStatus: null,
    });
    sumsubClientMock.getApplicantByExternalUserId.mockResolvedValue(null);
    sumsubClientMock.createApplicant.mockResolvedValue({ id: 'app-1' });
    sumsubClientMock.createSdkToken.mockResolvedValue({ token: 'sdk-token-1' });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'PENDING_VERIFICATION',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      verificationProvider: 'SUMSUB',
      verificationSubstatus: 'CREATED',
      verificationCustomerActionRequired: true,
      verificationCanContinue: true,
      verificationLatestEventType: null,
      verificationLatestEventAt: null,
      sumsubApplicantId: 'app-1',
      sumsubCurrentLevelName: 'wave3-level-1',
      sumsubLatestReviewId: null,
      sumsubLatestAttemptId: null,
      sumsubExperiencedLevel2: false,
      latestRiskApprovalId: null,
      latestRiskApprovalStatus: null,
    });

    await service.startVerification('c1');

    const updateData = prismaMock.customerMain.update.mock.calls[0][0].data;
    expect(updateData.onboardingTraceId).toBeUndefined();
  });

  it('should return REINITIATE_CDD action when canonical onboarding is REJECTED', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'REJECTED',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      activeCaseId: null,
      eddRequired: false,
    });

    const result = await service.getNextStep('c1');

    expect(result.actions).toEqual([{ type: 'REINITIATE_VERIFICATION' }]);
    expect(result.blockedReason).toContain('Re-initiate');
  });

  it('should project verification fields on my onboarding snapshot', async () => {
    prismaMock.customerMain.findUnique
      .mockResolvedValueOnce({
        id: 'c1',
        onboardingStatus: 'PENDING_VERIFICATION',
        adminStatus: 'INACTIVE',
        complianceStatus: 'CLEAR',
        verificationProvider: 'SUMSUB',
        verificationSubstatus: 'CREATED',
        verificationCustomerActionRequired: true,
        verificationCanContinue: true,
        verificationLatestEventType: 'applicantCreated',
        verificationLatestEventAt: new Date('2026-04-01T00:00:00.000Z'),
        sumsubApplicantId: 'app-1',
        sumsubCurrentLevelName: 'wave3-level-1',
        sumsubLatestReviewId: 'rev-1',
        sumsubLatestAttemptId: 'att-1',
        sumsubExperiencedLevel2: false,
      })
      .mockResolvedValueOnce({
        id: 'c1',
        customerType: 'INDIVIDUAL',
        onboardingStatus: 'PENDING_VERIFICATION',
        adminStatus: 'INACTIVE',
        complianceStatus: 'CLEAR',
        verificationProvider: 'SUMSUB',
        verificationSubstatus: 'CREATED',
        verificationCustomerActionRequired: true,
        verificationCanContinue: true,
        verificationLatestEventType: 'applicantCreated',
        verificationLatestEventAt: new Date('2026-04-01T00:00:00.000Z'),
        sumsubApplicantId: 'app-1',
        sumsubCurrentLevelName: 'wave3-level-1',
        sumsubLatestReviewId: 'rev-1',
        sumsubLatestAttemptId: 'att-1',
        sumsubExperiencedLevel2: false,
      });

    const result = await service.getMyOnboarding('c1');

    expect(result.verification).toEqual(
      expect.objectContaining({
        provider: 'SUMSUB',
        applicantId: 'app-1',
        currentLevelName: 'wave3-level-1',
        latestReviewId: 'rev-1',
        latestAttemptId: 'att-1',
        substatus: 'CREATED',
        customerActionRequired: true,
        canContinue: true,
        latestEventType: 'applicantCreated',
        experiencedLevel2: false,
      }),
    );
  });

  it('should project verification fields on next step snapshot', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'PENDING_VERIFICATION',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      verificationProvider: 'SUMSUB',
      verificationSubstatus: 'UNDER_REVIEW',
      verificationCustomerActionRequired: false,
      verificationCanContinue: false,
      verificationLatestEventType: 'applicantReviewed',
      verificationLatestEventAt: new Date('2026-04-02T00:00:00.000Z'),
      sumsubApplicantId: 'app-1',
      sumsubCurrentLevelName: 'wave3-level-2',
      sumsubLatestReviewId: 'rev-2',
      sumsubLatestAttemptId: 'att-2',
      sumsubExperiencedLevel2: true,
    });

    const result = await service.getNextStep('c1');

    expect(result.verification).toEqual(
      expect.objectContaining({
        provider: 'SUMSUB',
        applicantId: 'app-1',
        currentLevelName: 'wave3-level-2',
        latestReviewId: 'rev-2',
        latestAttemptId: 'att-2',
        substatus: 'UNDER_REVIEW',
        customerActionRequired: false,
        canContinue: false,
        latestEventType: 'applicantReviewed',
        experiencedLevel2: true,
      }),
    );
  });

  it('should auto-expire ACTIVE customer to PENDING_CDD when cddDocumentExpiresAt passed', async () => {
    prismaMock.customerMain.findUnique
      .mockResolvedValueOnce({
        id: 'c1',
        onboardingStatus: 'APPROVED',
        adminStatus: 'ACTIVE',
        complianceStatus: 'CLEAR',
        eddRequired: false,
        cddDocumentExpiresAt: new Date(Date.now() - 60 * 1000),
      })
      .mockResolvedValueOnce({
        id: 'c1',
        onboardingStatus: 'PENDING_CDD_INPUT',
        adminStatus: 'INACTIVE',
        complianceStatus: 'CLEAR',
        eddRequired: false,
      });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'PENDING_CDD_INPUT',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
    });

    const result = await service.getNextStep('c1');

    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({
          onboardingStatus: 'PENDING_CDD_INPUT',
          adminStatus: 'INACTIVE',
          complianceStatus: 'CLEAR',
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
        adminStatus: 'ACTIVE',
        complianceStatus: 'CLEAR',
        cddDocumentExpiresAt: new Date(Date.now() - 60 * 1000),
      })
      .mockResolvedValueOnce({
        id: 'c1',
        customerNo: 'CU1',
        onboardingStatus: 'PENDING_CDD_INPUT',
        adminStatus: 'INACTIVE',
        complianceStatus: 'CLEAR',
        complianceFreezeCaseId: null,
      });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'PENDING_CDD_INPUT',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
    });

    await expect(service.assertTradingEligibility('c1', 'DEPOSIT')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prismaMock.customerMain.update).toHaveBeenCalledTimes(1);
  });

  it('should recompute NONE status into baseline canonical snapshot', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'NONE',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
    });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'NONE',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
      eddRequired: false,
    });

    const result = await service.recomputeComplianceSnapshot('c1', 'ONB-1');

    expect(prismaMock.customerMain.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({
        onboardingStatus: 'NONE',
        adminStatus: 'INACTIVE',
        complianceStatus: 'CLEAR',
        eddRequired: false,
      }),
    });
    expect(result.onboardingStatus).toBe('NONE');
  });

});
