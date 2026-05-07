import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
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
  let recordByActorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    recordByActorSpy = jest
      .spyOn(AuditLogsService.prototype, 'recordByActor')
      .mockResolvedValue({} as any);
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
      riskEngineMock,
      workflowTransitionServiceMock,
      onboardingFinalApprovalServiceMock,
      sumsubClientMock,
      {} as any,
    );
  });

  const buildVerificationCustomer = (overrides?: Record<string, unknown>) => ({
    id: 'customer-1',
    customerNo: 'CU0001',
    customerType: 'INDIVIDUAL',
    onboardingStatus: 'PENDING_VERIFICATION',
    operatingStatus: 'INACTIVE',
    restrictionStatus: 'CLEAR',
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
            operatingStatus: 'ACTIVE',
            verificationSubstatus: 'COMPLETED',
            latestRiskApprovalStatus: null,
          }),
        }),
      );
      expect(onboardingFinalApprovalServiceMock.ensurePendingApprovalInTransaction).not.toHaveBeenCalled();
      expect(result.customer.onboardingStatus).toBe('APPROVED');
      expect(result.customer.operatingStatus).toBe('ACTIVE');
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
      expect(result.customer.operatingStatus).toBe('INACTIVE');
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
            operatingStatus: 'INACTIVE',
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
        operatingStatus: 'ACTIVE',
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
      expect(result.customer.operatingStatus).toBe('ACTIVE');
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
      expect(auditInput.triggerType).toBe('DATA_UPDATE');
      expect(auditInput.module).toBe('identity/onboarding');
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
    return { session, customer, cddResponse };
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

  it.each(['APPROVED', 'FINAL_APPROVAL'] as const)(
    'should reject verification start while onboarding is %s',
    async (status) => {
      prismaMock.customerMain.findUnique.mockResolvedValue({
        id: 'c1',
        customerType: 'INDIVIDUAL',
        onboardingStatus: status,
        operatingStatus: status === 'APPROVED' ? 'ACTIVE' : 'INACTIVE',
        restrictionStatus: 'CLEAR',
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
        operatingStatus: 'INACTIVE',
        restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
        operatingStatus: 'INACTIVE',
        restrictionStatus: 'CLEAR',
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
        operatingStatus: 'INACTIVE',
        restrictionStatus: 'CLEAR',
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
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
    expect(recordByActorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CDD_SESSION_CREATED',
      }),
      expect.anything(),
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
        latestRiskApproval: { disconnect: true },
        latestRiskApprovalStatus: null,
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

  it('should create one pending CDD decision record and keep customer under review', async () => {
    seedCddMockFlow();
    riskEngineMock.createPendingDecisionRecord.mockResolvedValue({
      decisionRecordId: 'dr-pending',
      status: 'CREATED',
      decision: null,
    });

    const result = await service.mockCompleteSession('c1', 'c1', 'ses-1');

    expect(riskEngineMock.createPendingDecisionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        contextType: 'ONBOARDING_CDD',
        ownerType: 'CUSTOMER',
        ownerId: 'c1',
        signals: expect.objectContaining({
          simulationMode: 'MANUAL_PENDING',
          cddResponseId: 'cdd-1',
        }),
      }),
    );
    expect(riskEngineMock.evaluate).not.toHaveBeenCalled();
    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          onboardingStatus: 'CDD_UNDER_REVIEW',
          operatingStatus: 'INACTIVE',
          latestDecisionRecordId: 'dr-pending',
        }),
      }),
    );
    expect(result.decision).toEqual({
      decisionRecordId: 'dr-pending',
      status: 'CREATED',
      decision: null,
    });
  });

  it('should auto-pass CDD when manual simulation is LOW', async () => {
    seedCddMockFlow();
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      id: 'dr-low',
      status: 'CREATED',
      contextType: 'ONBOARDING_CDD',
      customerId: 'c1',
      subjectId: 'c1',
      inputPayload: JSON.stringify({
        signals: {
          cddResponseId: 'cdd-1',
          journeyId: 'ONB-1',
        },
      }),
    });
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'CDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
    });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'APPROVED',
      operatingStatus: 'ACTIVE',
      restrictionStatus: 'CLEAR',
    });
    riskEngineMock.completeDecisionRecord.mockResolvedValue({
      decision: 'REVIEW',
      decisionRecordId: 'dr-low',
      reasonCodes: ['CDD_LOW_RISK_CLEAR'],
      recommendedActions: [],
    });

    const result = await service.completeManualCddDecision({
      decisionRecordId: 'dr-low',
      riskLevel: 'LOW',
      reasonCode: 'CDD_LOW_RISK_CLEAR',
    });

    expect(riskEngineMock.completeDecisionRecord).toHaveBeenCalledWith(
      'dr-low',
      expect.objectContaining({
        contextType: 'ONBOARDING_CDD',
        signals: expect.objectContaining({
          simulationMode: 'MANUAL',
          simulationRiskLevel: 'LOW',
          simulationRiskReason: 'CDD_LOW_RISK_CLEAR',
        }),
      }),
    );
    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          onboardingStatus: 'APPROVED',
          operatingStatus: 'ACTIVE',
        }),
      }),
    );
    expect(result.customer.onboardingStatus).toBe('APPROVED');
  });

  it('should keep CDD under review when manual simulation is MEDIUM', async () => {
    seedCddMockFlow();
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      id: 'dr-medium',
      status: 'CREATED',
      contextType: 'ONBOARDING_CDD',
      customerId: 'c1',
      subjectId: 'c1',
      inputPayload: JSON.stringify({
        signals: {
          cddResponseId: 'cdd-1',
          journeyId: 'ONB-1',
        },
      }),
    });
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'CDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
    });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'CDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
    });
    riskEngineMock.completeDecisionRecord.mockResolvedValue({
      decision: 'REVIEW',
      decisionRecordId: 'dr-medium',
      reasonCodes: ['CDD_PROFILE_INCONSISTENT'],
      recommendedActions: [{ type: 'UPSERT_ALERT' }],
    });

    const result = await service.completeManualCddDecision({
      decisionRecordId: 'dr-medium',
      riskLevel: 'MEDIUM',
      reasonCode: 'CDD_PROFILE_INCONSISTENT',
    });

    expect(riskEngineMock.completeDecisionRecord).toHaveBeenCalledWith(
      'dr-medium',
      expect.objectContaining({
        contextType: 'ONBOARDING_CDD',
        signals: expect.objectContaining({
          simulationMode: 'MANUAL',
          simulationRiskLevel: 'MEDIUM',
          simulationRiskReason: 'CDD_PROFILE_INCONSISTENT',
          mockDataType: 'MEDIUM_RISK',
        }),
      }),
    );
    expect(orchestratorMock.orchestrate).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: 'ONBOARDING',
        stage: 'REVIEW_CDD',
        decisionRecordId: 'dr-medium',
      }),
    );
    expect(result.customer.onboardingStatus).toBe('CDD_UNDER_REVIEW');
  });

  it('should keep HIGH manual simulation on HIGH_RISK_OR_PEP when reasonCode is CDD_PEP_MATCH', async () => {
    seedCddMockFlow();
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValueOnce({
      id: 'dr-high-pep',
      status: 'CREATED',
      contextType: 'ONBOARDING_CDD',
      customerId: 'c1',
      subjectId: 'c1',
      inputPayload: JSON.stringify({
        signals: {
          cddResponseId: 'cdd-1',
          journeyId: 'ONB-1',
        },
      }),
    });
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'CDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
    });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'CDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
    });
    riskEngineMock.completeDecisionRecord.mockResolvedValue({
      decision: 'REVIEW',
      decisionRecordId: 'dr-high-pep',
      reasonCodes: ['CDD_PEP_MATCH'],
      recommendedActions: [{ type: 'UPSERT_ALERT' }, { type: 'AUTO_ESCALATE_CASE' }],
    });

    await service.completeManualCddDecision({
      decisionRecordId: 'dr-high-pep',
      riskLevel: 'HIGH',
      reasonCode: 'CDD_PEP_MATCH',
    });

    expect(riskEngineMock.completeDecisionRecord).toHaveBeenCalledWith(
      'dr-high-pep',
      expect.objectContaining({
        contextType: 'ONBOARDING_CDD',
        signals: expect.objectContaining({
          simulationMode: 'MANUAL',
          simulationRiskLevel: 'HIGH',
          simulationRiskReason: 'CDD_PEP_MATCH',
          mockDataType: 'HIGH_RISK_OR_PEP',
          sanctionsHit: false,
          pepHit: true,
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
    riskEngineMock.createPendingDecisionRecord.mockResolvedValue({
      decisionRecordId: 'dr-edd-1',
      status: 'CREATED',
      decision: null,
    });

    const result = await service.mockCompleteSession('c1', 'c1', 'ses-edd-1');

    expect(riskEngineMock.createPendingDecisionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        contextType: 'ONBOARDING_EDD',
        ownerType: 'CUSTOMER',
        ownerId: 'c1',
        subjectType: 'CORPORATE_ENTITY',
        subjectId: 'corp-1',
        signals: expect.objectContaining({
          eddSubmitted: true,
        }),
      }),
    );
    expect(riskEngineMock.evaluate).not.toHaveBeenCalled();
    expect(orchestratorMock.orchestrate).not.toHaveBeenCalled();
    expect(prismaMock.eddResponse.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'edd-1' },
        data: expect.objectContaining({
          status: 'RECEIVED',
        }),
      }),
    );
    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          onboardingStatus: 'EDD_UNDER_REVIEW',
          latestDecisionRecordId: 'dr-edd-1',
        }),
      }),
    );
    expect(result.decision).toEqual({
      decisionRecordId: 'dr-edd-1',
      status: 'CREATED',
      decision: null,
    });
  });

  it('should route LOW manual EDD simulation directly to FINAL_APPROVAL without alert or case', async () => {
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      id: 'dr-edd-low',
      status: 'CREATED',
      contextType: 'ONBOARDING_EDD',
      customerId: 'c1',
      subjectId: 'corp-1',
      inputPayload: JSON.stringify({
        signals: {
          eddResponseId: 'edd-1',
          journeyId: 'ONB-1',
        },
      }),
    });
    prismaMock.eddResponse.findFirst.mockResolvedValue({
      id: 'edd-1',
      caseNo: 'EDD2602010001',
      customerId: 'c1',
      journeyId: 'ONB-1',
      subjectKind: 'CORPORATE_ENTITY',
      subjectRefId: 'corp-1',
    });
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU0001',
      onboardingStatus: 'EDD_UNDER_REVIEW',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
      eddRequired: true,
    });
    riskEngineMock.completeDecisionRecord.mockResolvedValue({
      decision: 'REVIEW',
      decisionRecordId: 'dr-edd-low',
      reasonCodes: ['EDD_CLEAR'],
      recommendedActions: [],
    });
    workflowTransitionServiceMock.transition.mockResolvedValue({
      workflow: 'ONBOARDING',
      stage: 'REVIEW_EDD',
      dispositionCode: 'CLEAR',
      transitionCode: WORKFLOW_TRANSITION_CODES.EDD_APPROVE_TO_FINAL_APPROVAL,
      fromStatus: 'EDD_UNDER_REVIEW',
      toStatus: 'FINAL_APPROVAL',
      executed: true,
      updatedCustomer: {
        id: 'c1',
        onboardingStatus: 'FINAL_APPROVAL',
        operatingStatus: 'INACTIVE',
        restrictionStatus: 'CLEAR',
        latestRiskApprovalId: 'approval-1',
        latestRiskApprovalStatus: 'PENDING',
      },
      eddResponse: { id: 'edd-1' },
      activeCaseId: 'edd-1',
      latestRiskApprovalId: 'approval-1',
      latestRiskApprovalStatus: 'PENDING',
      createdFinalApprovalId: 'approval-1',
    });

    const result = await service.completeManualEddDecision({
      decisionRecordId: 'dr-edd-low',
      riskLevel: 'LOW',
      reasonCode: 'EDD_CLEAR',
      actorId: 'admin-1',
      actorRole: 'COMPLIANCE_OFFICER',
    });

    expect(riskEngineMock.completeDecisionRecord).toHaveBeenCalledWith(
      'dr-edd-low',
      expect.objectContaining({
        contextType: 'ONBOARDING_EDD',
        signals: expect.objectContaining({
          simulationMode: 'MANUAL',
          simulationRiskLevel: 'LOW',
          simulationRiskReason: 'EDD_CLEAR',
          eddSubmitted: true,
        }),
      }),
      expect.anything(),
    );
    expect(workflowTransitionServiceMock.transition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workflow: 'ONBOARDING',
        stage: 'REVIEW_EDD',
        producerType: 'DECISION_RECORD',
        producerId: 'dr-edd-low',
        dispositionCode: 'CLEAR',
      }),
    );
    expect(orchestratorMock.orchestrate).not.toHaveBeenCalled();
    expect(onboardingFinalApprovalServiceMock.emitSubmittedSideEffects).toHaveBeenCalledWith(
      'approval-1',
      'admin-1',
      'COMPLIANCE_OFFICER',
      'EDD_CLEAR',
    );
    expect(result.customer.onboardingStatus).toBe('FINAL_APPROVAL');
  });
});
