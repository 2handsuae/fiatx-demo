import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ClientRiskAssessmentPolicyLoader } from './policy/policy-loader';
import { applyPolicy, PolicyInput, PolicyOutput } from './policy/client-risk-assessment-policy';

export type AssessmentTriggerType =
  | 'INITIAL_ONBOARDING'
  | 'SCHEDULED_QUARTERLY'
  | 'SUMSUB_AML_HIT'
  | 'MLRO_MANUAL';

@Injectable()
export class ClientRiskAssessmentService {
  /** Property-injected in module to avoid circular deps */
  materialRefreshService?: {
    recomputeHoldingsForCustomer: (id: string, levelName: string) => Promise<any>;
    seedInitialHoldings: (id: string, levelName: string) => Promise<void>;
  };

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly sumsubClient: SumsubClient,
    private readonly approvalsService: ApprovalsService,
    private readonly policyLoader: ClientRiskAssessmentPolicyLoader,
  ) {}

  /** Main entry — triggers fresh /aml/check and creates pending assessment */
  async startAssessment(input: {
    customerId: string;
    triggerType: Exclude<AssessmentTriggerType, 'INITIAL_ONBOARDING'>;
    triggeredBy?: string;
    triggeredContext?: Record<string, any>;
  }): Promise<any> {
    // Idempotency
    const existing = await this.prisma.clientRiskAssessment.findFirst({
      where: { customerId: input.customerId, status: 'PENDING_SUMSUB_RESULT' },
    });
    if (existing) return existing;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: input.customerId },
    });
    if (!customer) throw new Error(`Customer ${input.customerId} not found`);

    const policy = this.policyLoader.getPolicy();
    const assessmentNo = await this.generateAssessmentNo();
    const traceId = `CLIENT_RISK_ASSESSMENT:${randomUUID()}`;

    const assessment = await this.prisma.clientRiskAssessment.create({
      data: {
        assessmentNo,
        customerId: input.customerId,
        triggerType: input.triggerType,
        policyVersion: policy.version,
        previousRiskTier: customer.riskTier,
        status: 'PENDING_SUMSUB_RESULT',
        sumsubAmlCheckRequestedAt: new Date(),
        traceId,
      },
    });

    if (customer.sumsubApplicantId) {
      try {
        const result = await this.sumsubClient.runAmlCheck(customer.sumsubApplicantId);
        await this.prisma.clientRiskAssessment.update({
          where: { id: assessment.id },
          data: { sumsubAmlCheckInspectionId: result.inspectionId },
        });
      } catch (err) {
        console.error(`runAmlCheck failed for customer ${customer.id}:`, err);
      }
    }

    return assessment;
  }

  /** For onboarding completion: uses known AML result, no /aml/check call */
  async recordAssessmentFromKnownAmlResult(input: {
    customerId: string;
    knownAmlResult: { reviewAnswer: 'GREEN' | 'RED'; rejectLabels?: string[] };
    snapshot: any;
  }): Promise<any> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: input.customerId },
    });
    if (!customer) throw new Error(`Customer ${input.customerId} not found`);

    const policy = this.policyLoader.getPolicy();
    const assessmentNo = await this.generateAssessmentNo();
    const traceId = `CLIENT_RISK_ASSESSMENT:${randomUUID()}`;

    const assessment = await this.prisma.clientRiskAssessment.create({
      data: {
        assessmentNo,
        customerId: input.customerId,
        triggerType: 'INITIAL_ONBOARDING',
        policyVersion: policy.version,
        previousRiskTier: customer.riskTier,
        status: 'PENDING_SUMSUB_RESULT',
        sumsubSnapshotAt: new Date(),
        sumsubAmlReviewAnswer: input.knownAmlResult.reviewAnswer,
        sumsubAmlLabels: JSON.stringify(input.knownAmlResult.rejectLabels || []),
        traceId,
      },
    });

    // Directly advance through the same pipeline as webhook handler
    return this.processAssessmentResult(assessment.id, {
      reviewAnswer: input.knownAmlResult.reviewAnswer,
      rejectLabels: input.knownAmlResult.rejectLabels || [],
    });
  }

  /** Webhook-driven: look up pending assessment by inspectionId and process */
  async handleSumsubAmlResult(
    inspectionId: string,
    reviewResult: {
      reviewAnswer: 'GREEN' | 'RED';
      rejectLabels?: string[];
      reviewRejectType?: string;
    },
  ): Promise<void> {
    const assessment = await this.prisma.clientRiskAssessment.findFirst({
      where: {
        sumsubAmlCheckInspectionId: inspectionId,
        status: 'PENDING_SUMSUB_RESULT',
      },
    });
    if (!assessment) {
      console.warn(`No pending assessment for inspectionId ${inspectionId}`);
      return;
    }

    await this.prisma.clientRiskAssessment.update({
      where: { id: assessment.id },
      data: {
        sumsubAmlReviewAnswer: reviewResult.reviewAnswer,
        sumsubAmlLabels: JSON.stringify(reviewResult.rejectLabels || []),
        sumsubAmlRejectType: reviewResult.reviewRejectType,
      },
    });

    await this.processAssessmentResult(assessment.id, reviewResult);
  }

  async handleSignoffComplete(
    assessmentId: string,
    approvalCase: { status: string },
  ): Promise<void> {
    if (approvalCase.status === 'APPROVED') {
      await this.prisma.clientRiskAssessment.update({
        where: { id: assessmentId },
        data: {
          status: 'SIGNED',
          signedAt: new Date(),
        },
      });
      await this.postSignoffCascade(assessmentId);
    } else if (approvalCase.status === 'REJECTED') {
      const assessment = await this.prisma.clientRiskAssessment.findUnique({
        where: { id: assessmentId },
      });
      if (!assessment) return;

      // For PEP rejection: offboard the customer
      await this.prisma.customerMain.update({
        where: { id: assessment.customerId },
        data: {
          onboardingStatus: 'REJECTED',
          operatingStatus: 'INACTIVE',
          pepStatus: 'CLEARED',
        },
      });
      await this.prisma.clientRiskAssessment.update({
        where: { id: assessmentId },
        data: { status: 'SIGNED', signedAt: new Date() },
      });
    }
  }

  /** Shared post-AML processing — applies policy, routes signoff */
  private async processAssessmentResult(
    assessmentId: string,
    reviewResult: { reviewAnswer: 'GREEN' | 'RED'; rejectLabels?: string[] },
  ): Promise<any> {
    const assessment = await this.prisma.clientRiskAssessment.findUnique({
      where: { id: assessmentId },
    });
    if (!assessment) return;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: assessment.customerId },
    });
    if (!customer) return;

    const labels = reviewResult.rejectLabels || [];

    // Sanctions short-circuit
    if (reviewResult.reviewAnswer === 'RED' && labels.some((l) => l.startsWith('SANCTIONS_'))) {
      await this.handleSanctionsPath(assessment, customer, labels);
      return assessment;
    }

    // Fetch snapshot
    const snapshot = customer.sumsubApplicantId
      ? await this.sumsubClient.getApplicant(customer.sumsubApplicantId)
      : { tags: [], totalScore: null };

    const holdings = await this.prisma.customerMaterialHolding.findMany({
      where: { customerId: customer.id },
    });

    const policy = this.policyLoader.getPolicy();
    const policyInput: PolicyInput = {
      amlAnswer: reviewResult.reviewAnswer,
      amlLabels: labels,
      holdings: holdings.map((h: any) => ({
        materialType: h.materialType,
        status: h.status,
        expiresAt: h.expiresAt,
      })),
      previousTier: customer.riskTier as any,
      previousPepStatus: customer.pepStatus as any,
    };
    const output = applyPolicy(policyInput, policy);

    await this.prisma.clientRiskAssessment.update({
      where: { id: assessment.id },
      data: {
        sumsubSnapshotAt: new Date(),
        sumsubRiskScore: (snapshot as any).totalScore || null,
        sumsubTags: JSON.stringify((snapshot as any).tags || []),
        resultingRiskTier: output.resultingTier,
        scoreSuggestedTier: output.scoreSuggestedTier,
        recommendedAction: output.recommendedAction,
        reasoning: JSON.stringify(output.reasoning),
        signoffMethod: output.signoffMethod,
      },
    });

    await this.routeSignoff(assessment.id, customer, output);
    return assessment;
  }

  private async handleSanctionsPath(
    assessment: any,
    customer: any,
    labels: string[],
  ): Promise<void> {
    await this.prisma.customerMain.update({
      where: { id: customer.id },
      data: {
        complianceHoldStatus: 'FROZEN',
        complianceHoldReason: 'sanctions_hit_pending_investigation',
      },
    });

    await this.prisma.clientRiskAssessment.update({
      where: { id: assessment.id },
      data: {
        status: 'ESCALATED_TO_SUMSUB',
        resultingRiskTier: 'HIGH',
        recommendedAction: 'ESCALATE_TO_SUMSUB_CASE',
        signoffMethod: 'ESCALATED',
        reasoning: JSON.stringify({ ruleId: 'P1_labels_contains_SANCTIONS', labels }),
      },
    });
  }

  private async routeSignoff(
    assessmentId: string,
    customer: any,
    output: PolicyOutput,
  ): Promise<void> {
    const policy = this.policyLoader.getPolicy();

    if (output.signoffMethod === 'AUTO_R2') {
      await this.prisma.clientRiskAssessment.update({
        where: { id: assessmentId },
        data: {
          status: 'SIGNED',
          signedBy: 'SYSTEM',
          signedAt: new Date(),
          signedUnderPolicyVersion: policy.version,
        },
      });
      await this.postSignoffCascade(assessmentId);
      return;
    }

    // Apply immediate effects (RESTRICT for PEP)
    if (output.immediateEffect === 'RESTRICT') {
      await this.prisma.customerMain.update({
        where: { id: customer.id },
        data: {
          restrictionStatus: 'RESTRICTED',
          restrictionReason: 'pep_review_pending',
          pepStatus: 'CONFIRMED',
          pepConfirmedAt: new Date(),
        },
      });
    }

    const actionType = policy.signoffActionTypeMap[output.signoffMethod];
    if (!actionType) {
      console.error(`No action type mapping for signoff method ${output.signoffMethod}`);
      return;
    }

    const assessment = await this.prisma.clientRiskAssessment.findUnique({
      where: { id: assessmentId },
    });
    const approvalCase = await this.approvalsService.create(
      {
        actionType,
        entityRef: `client_risk_assessment:${assessmentId}`,
        traceId: assessment!.traceId,
        metadata: {
          assessmentId,
          resultingTier: output.resultingTier,
          reasoning: output.reasoning,
        },
      } as any,
      { actorType: 'ADMIN', userId: 'SYSTEM', roleCodes: ['SUPER_ADMIN'] } as any,
    );

    await this.prisma.clientRiskAssessment.update({
      where: { id: assessmentId },
      data: { status: 'PENDING_SIGNATURE', approvalCaseId: approvalCase.id },
    });
  }

  private async postSignoffCascade(assessmentId: string): Promise<void> {
    const assessment = await this.prisma.clientRiskAssessment.findUnique({
      where: { id: assessmentId },
    });
    if (!assessment) return;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: assessment.customerId },
    });
    if (!customer) return;

    const policy = this.policyLoader.getPolicy();
    const tierChanged = assessment.resultingRiskTier && assessment.resultingRiskTier !== customer.riskTier;

    const updateData: any = {
      latestRiskAssessmentId: assessment.id,
      latestRiskApprovalId: assessment.approvalCaseId,
      latestRiskApprovalStatus: 'APPROVED',
    };

    if (tierChanged) {
      updateData.riskTier = assessment.resultingRiskTier;
      updateData.riskTierUpdatedAt = new Date();
    }

    if (customer.restrictionReason === 'pep_review_pending') {
      updateData.restrictionStatus = 'CLEAR';
      updateData.restrictionReason = null;
    }

    await this.prisma.customerMain.update({
      where: { id: customer.id },
      data: updateData,
    });

    // Sync Sumsub level (skip if frozen)
    if (customer.complianceHoldStatus !== 'FROZEN' && assessment.resultingRiskTier) {
      const allowed = policy.tierLevelConstraint[assessment.resultingRiskTier] || [];
      if (
        customer.sumsubApplicantId &&
        allowed.length > 0 &&
        !allowed.includes(customer.sumsubCurrentLevelName || '')
      ) {
        try {
          await this.sumsubClient.moveToLevel(customer.sumsubApplicantId, allowed[0]);
          await this.prisma.customerMain.update({
            where: { id: customer.id },
            data: {
              sumsubCurrentLevelName: allowed[0],
              sumsubExperiencedLevel2:
                allowed[0] === 'wave3-level-2' ? true : customer.sumsubExperiencedLevel2,
            },
          });
        } catch (err) {
          console.error(`moveToLevel failed for ${customer.id}:`, err);
        }
      }
    }

    // Trigger Layer 3: seed initial holdings on first onboarding, recompute on tier change
    if (this.materialRefreshService) {
      const holdingCount = await this.prisma.customerMaterialHolding.count({
        where: { customerId: customer.id },
      });
      const levelName = customer.sumsubCurrentLevelName || 'wave3-level-1';
      try {
        if (holdingCount === 0) {
          await this.materialRefreshService.seedInitialHoldings(customer.id, levelName);
        } else if (tierChanged) {
          await this.materialRefreshService.recomputeHoldingsForCustomer(customer.id, levelName);
        }
      } catch (err) {
        console.error(`Layer 3 holdings failed for ${customer.id}:`, err);
      }
    }
  }

  private async generateAssessmentNo(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.clientRiskAssessment.count({
      where: { assessmentNo: { startsWith: `CRA-${year}-` } },
    });
    return `CRA-${year}-${String(count + 1).padStart(5, '0')}`;
  }
}
