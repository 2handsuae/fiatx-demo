import { Test } from '@nestjs/testing';
import { ClientRiskAssessmentService } from './client-risk-assessment.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ClientRiskAssessmentPolicyLoader } from './policy/policy-loader';
import { TierUpgradeCaseService } from '../tier-upgrade-case/tier-upgrade-case.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';

// Mock applyPolicy so we can control the scenario type in tests
jest.mock('./policy/client-risk-assessment-policy', () => ({
  applyPolicy: jest.fn(),
}));
import { applyPolicy } from './policy/client-risk-assessment-policy';
const mockApplyPolicy = applyPolicy as jest.MockedFunction<typeof applyPolicy>;

// ─── Shared mock factories ────────────────────────────────────────────────────

const buildPrisma = () => ({
  clientRiskAssessment: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  customerMain: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  customerMaterialHolding: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
  auditLogEvent: {
    create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
  },
  auditLogSubjectNo: {
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  $transaction: jest.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => fn({
    clientRiskAssessment: { update: jest.fn().mockResolvedValue({}) },
    customerMain: { update: jest.fn().mockResolvedValue({}) },
  })),
});

const mockPolicy = {
  version: '1.0.0',
  downgradeForbidden: true,
  tierMappingRules: [],
  tierLevelConstraint: { LOW: ['wave3-level-1'], HIGH: ['wave3-level-2'] },
  signoffActionTypeMap: {},
};

const BASE_POLICY_OUTPUT = {
  resultingTier: 'LOW' as const,
  recommendedAction: 'REAFFIRM',
  signoffMethod: 'AUTO_R2',
  scenarioType: 'LOW_TO_LOW' as const,
  matchedRule: 6,
  reasoning: { ruleId: 'P6', amlAnswer: 'GREEN', amlLabels: [], previousTier: 'LOW' },
};

describe('ClientRiskAssessmentService', () => {
  let service: ClientRiskAssessmentService;
  let prisma: ReturnType<typeof buildPrisma>;
  const mockSumsubClient = {
    runAmlCheck: jest.fn(),
    getApplicant: jest.fn().mockResolvedValue({ tags: [], totalScore: null }),
    moveToLevel: jest.fn(),
  };
  const mockApprovalsService = {
    createAndSubmit: jest.fn().mockResolvedValue({ id: 'ap-1' }),
  };
  const mockPolicyLoader = { getPolicy: jest.fn().mockReturnValue(mockPolicy) };
  const mockTierUpgradeCaseService = { createFromCra: jest.fn() };

  beforeEach(async () => {
    prisma = buildPrisma();

    const module = await Test.createTestingModule({
      providers: [
        ClientRiskAssessmentService,
        { provide: PrismaService, useValue: prisma },
        { provide: SumsubClient, useValue: mockSumsubClient },
        { provide: ApprovalsService, useValue: mockApprovalsService },
        { provide: ClientRiskAssessmentPolicyLoader, useValue: mockPolicyLoader },
        { provide: TierUpgradeCaseService, useValue: mockTierUpgradeCaseService },
        { provide: AuditLogsService, useValue: { recordSystem: jest.fn().mockResolvedValue({}), recordByActor: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    service = module.get(ClientRiskAssessmentService);
    jest.clearAllMocks();
    mockPolicyLoader.getPolicy.mockReturnValue(mockPolicy);
    mockApprovalsService.createAndSubmit.mockResolvedValue({ id: 'ap-1' });
    mockSumsubClient.getApplicant.mockResolvedValue({ tags: [], totalScore: null });
    // Reset prisma mocks too (buildPrisma creates fresh mocks but clearAllMocks resets their impl)
    prisma.customerMaterialHolding.findMany.mockResolvedValue([]);
    prisma.customerMaterialHolding.count.mockResolvedValue(0);
    prisma.clientRiskAssessment.update.mockResolvedValue({});
    prisma.customerMain.update.mockResolvedValue({});
    prisma.auditLogEvent.create.mockResolvedValue({ id: 'audit-1' });
    prisma.auditLogEvent.findUnique.mockResolvedValue(null);
    prisma.auditLogEvent.findMany.mockResolvedValue([]);
    prisma.auditLogSubjectNo.createMany.mockResolvedValue({ count: 0 });
    // Re-apply $transaction mock after clearAllMocks
    prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(prisma));
  });

  // ─── routeSignoff tests ──────────────────────────────────────────────────

  describe('routeSignoff — new 3-state machine', () => {
    const inspectionId = 'insp-test';
    const pendingAssessment = {
      id: 'cra-1',
      status: 'PENDING_SUMSUB_RESULT',
      customerId: 'cust-1',
      traceId: 'T1',
      assessmentNo: 'CRA-001',
      resultingRiskTier: null,
      approvalCaseId: null,
      sumsubAmlCheckInspectionId: inspectionId,
    };

    const customerHigh = {
      id: 'cust-1', riskRating: 'HIGH', sumsubApplicantId: 'sub-1',
      pepStatus: 'NONE', complianceStatus: null,
      sumsubCurrentLevelName: 'wave3-level-2',
    };

    const customerLow = {
      id: 'cust-1', riskRating: 'LOW', sumsubApplicantId: null,
      pepStatus: 'NONE', complianceStatus: null,
      sumsubCurrentLevelName: 'wave3-level-1',
    };

    it('HIGH_TO_HIGH_STABLE → auto SIGNED', async () => {
      mockApplyPolicy.mockReturnValueOnce({
        ...BASE_POLICY_OUTPUT,
        resultingTier: 'HIGH',
        scenarioType: 'HIGH_TO_HIGH_STABLE',
        signoffMethod: 'AUTO_R2',
      });

      // handleSumsubAmlResult findFirst
      prisma.clientRiskAssessment.findFirst.mockResolvedValueOnce(pendingAssessment);
      // processAssessmentResult findUnique
      prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce(pendingAssessment);
      prisma.customerMain.findUnique.mockResolvedValueOnce(customerHigh);
      // routeSignoff re-fetch (findUnique)
      prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce({ ...pendingAssessment, resultingRiskTier: 'HIGH' });
      // postSignoffCascade fetches
      prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce({ ...pendingAssessment, resultingRiskTier: 'HIGH' });
      prisma.customerMain.findUnique.mockResolvedValueOnce(customerHigh);

      await service.handleSumsubAmlResult(inspectionId, { reviewAnswer: 'RED', rejectLabels: ['ADVERSE_MEDIA'] });

      const updateCalls = (prisma.clientRiskAssessment.update as jest.Mock).mock.calls;
      const signedCall = updateCalls.find((c: any[]) => c[0]?.data?.status === 'SIGNED');
      expect(signedCall).toBeDefined();
      expect(signedCall[0].data.signedBy).toBe('SYSTEM');
    });

    it('HIGH_TO_HIGH_UPGRADE → PENDING_MLRO_REVIEW', async () => {
      mockApplyPolicy.mockReturnValueOnce({
        ...BASE_POLICY_OUTPUT,
        resultingTier: 'HIGH',
        scenarioType: 'HIGH_TO_HIGH_UPGRADE',
        signoffMethod: 'MANUAL_MLRO',
      });

      prisma.clientRiskAssessment.findFirst.mockResolvedValueOnce(pendingAssessment);
      prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce(pendingAssessment);
      prisma.customerMain.findUnique.mockResolvedValueOnce(customerHigh);
      prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce({ ...pendingAssessment, resultingRiskTier: 'HIGH' });

      await service.handleSumsubAmlResult(inspectionId, { reviewAnswer: 'RED', rejectLabels: ['ADVERSE_MEDIA_NEW'] });

      const updateCalls = (prisma.clientRiskAssessment.update as jest.Mock).mock.calls;
      const pendingCall = updateCalls.find((c: any[]) => c[0]?.data?.status === 'PENDING_MLRO_REVIEW');
      expect(pendingCall).toBeDefined();
      expect(mockApprovalsService.createAndSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'RISK_RATING_MLRO_REVIEW' }),
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('LOW_TO_HIGH → PENDING_MLRO_REVIEW', async () => {
      mockApplyPolicy.mockReturnValueOnce({
        ...BASE_POLICY_OUTPUT,
        resultingTier: 'HIGH',
        scenarioType: 'LOW_TO_HIGH',
        signoffMethod: 'PHASE1_MLRO',
      });

      prisma.clientRiskAssessment.findFirst.mockResolvedValueOnce(pendingAssessment);
      prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce(pendingAssessment);
      prisma.customerMain.findUnique.mockResolvedValueOnce(customerLow);
      prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce({ ...pendingAssessment, resultingRiskTier: 'HIGH' });

      await service.handleSumsubAmlResult(inspectionId, { reviewAnswer: 'RED', rejectLabels: ['ADVERSE_MEDIA'] });

      const updateCalls = (prisma.clientRiskAssessment.update as jest.Mock).mock.calls;
      const pendingCall = updateCalls.find((c: any[]) => c[0]?.data?.status === 'PENDING_MLRO_REVIEW');
      expect(pendingCall).toBeDefined();
    });
  });

  // ─── handleSignoffComplete tests ─────────────────────────────────────────

  describe('handleSignoffComplete — simplified', () => {
    it('LOW→HIGH APPROVED → SIGNED + triggers TierUpgradeCase', async () => {
      const assessment = {
        id: 'cra-1', status: 'PENDING_MLRO_REVIEW',
        previousRiskTier: 'LOW', resultingRiskTier: 'HIGH',
        customerId: 'cust-1', traceId: 'T1', assessmentNo: 'CRA-001',
        approvalCaseId: 'ap-1',
      };
      prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce(assessment);
      mockTierUpgradeCaseService.createFromCra.mockResolvedValue({ id: 'tuc-1' });

      await service.handleSignoffComplete('cra-1', { status: 'APPROVED' });

      expect(prisma.clientRiskAssessment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SIGNED', signedBy: 'MLRO' }),
        }),
      );
      expect(mockTierUpgradeCaseService.createFromCra).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cra-1' }),
      );
    });

    it('LOW→HIGH REJECTED (false positive) → SIGNED as LOW', async () => {
      const assessment = {
        id: 'cra-1', status: 'PENDING_MLRO_REVIEW',
        previousRiskTier: 'LOW', resultingRiskTier: 'HIGH',
        customerId: 'cust-1',
        approvalCaseId: null,
      };
      prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce(assessment);
      // postSignoffCascade will call findUnique + customerMain.findUnique
      prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce({
        ...assessment, resultingRiskTier: 'LOW', status: 'SIGNED',
      });
      prisma.customerMain.findUnique.mockResolvedValueOnce({
        id: 'cust-1', riskRating: 'LOW', complianceStatus: null,
        sumsubApplicantId: null,
      });

      await service.handleSignoffComplete('cra-1', { status: 'REJECTED' });

      expect(prisma.clientRiskAssessment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'SIGNED',
            resultingRiskTier: 'LOW',
            signedBy: 'MLRO_FALSE_POSITIVE',
          }),
        }),
      );
      expect(mockTierUpgradeCaseService.createFromCra).not.toHaveBeenCalled();
    });

    it('HIGH→HIGH APPROVED → SIGNED, no TierUpgradeCase', async () => {
      const assessment = {
        id: 'cra-1', status: 'PENDING_MLRO_REVIEW',
        previousRiskTier: 'HIGH', resultingRiskTier: 'HIGH',
        customerId: 'cust-1',
        approvalCaseId: 'ap-1',
      };
      prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce(assessment);
      // postSignoffCascade fetches
      prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce(assessment);
      prisma.customerMain.findUnique.mockResolvedValueOnce({
        id: 'cust-1', riskRating: 'HIGH', complianceStatus: null,
        sumsubApplicantId: null,
        sumsubCurrentLevelName: 'wave3-level-2',
      });

      await service.handleSignoffComplete('cra-1', { status: 'APPROVED' });

      expect(prisma.clientRiskAssessment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'SIGNED' }) }),
      );
      expect(mockTierUpgradeCaseService.createFromCra).not.toHaveBeenCalled();
    });
  });

  // ─── handleSanctionsPath tests ───────────────────────────────────────────

  describe('handleSanctionsPath — via handleSumsubAmlResult', () => {
    it('SANCTIONS label → ESCALATED_TO_SUMSUB, customer frozen', async () => {
      const assessment = {
        id: 'cra-1', customerId: 'cust-1', traceId: 'T1', assessmentNo: 'CRA-001',
        previousRiskTier: 'LOW', status: 'PENDING_SUMSUB_RESULT',
      };
      const customer = {
        id: 'cust-1', riskRating: 'LOW', sumsubApplicantId: 'sub-1',
        pepStatus: 'NONE', complianceStatus: 'CLEAR',
        sumsubCurrentLevelName: 'wave3-level-1', sumsubExperiencedLevel2: false,
      };

      // handleSumsubAmlResult: findFirst for pending assessment
      prisma.clientRiskAssessment.findFirst.mockResolvedValueOnce(assessment);
      // processAssessmentResult: findUnique for assessment
      prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce(assessment);
      // processAssessmentResult: findUnique for customer
      prisma.customerMain.findUnique.mockResolvedValueOnce(customer);

      await service.handleSumsubAmlResult('insp-1', {
        reviewAnswer: 'RED',
        rejectLabels: ['SANCTIONS_LIST'],
      });

      expect(prisma.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ complianceStatus: 'FROZEN' }),
        }),
      );
      expect(prisma.clientRiskAssessment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ESCALATED_TO_SUMSUB' }),
        }),
      );
    });
  });

  // ─── startAssessment idempotency ─────────────────────────────────────────

  describe('startAssessment idempotency', () => {
    it('returns existing when PENDING_MLRO_REVIEW exists', async () => {
      const existing = { id: 'cra-1', status: 'PENDING_MLRO_REVIEW', customerId: 'cust-1' };
      prisma.clientRiskAssessment.findFirst.mockResolvedValueOnce(existing);

      const result = await service.startAssessment({ customerId: 'cust-1', triggerType: 'SCHEDULED_QUARTERLY' });

      expect(result).toEqual(existing);
      expect(prisma.clientRiskAssessment.create).not.toHaveBeenCalled();
    });

    it('returns existing when PENDING_SUMSUB_RESULT exists', async () => {
      const existing = { id: 'cra-2', status: 'PENDING_SUMSUB_RESULT', customerId: 'cust-2' };
      prisma.clientRiskAssessment.findFirst.mockResolvedValueOnce(existing);

      const result = await service.startAssessment({ customerId: 'cust-2', triggerType: 'SCHEDULED_QUARTERLY' });

      expect(result).toEqual(existing);
      expect(prisma.clientRiskAssessment.create).not.toHaveBeenCalled();
    });
  });
});
