import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ClientRiskAssessmentPolicyLoader } from './policy/policy-loader';
import { applyPolicy, PolicyInput, PolicyOutput } from './policy/client-risk-assessment-policy';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { TierUpgradeCaseService } from '../tier-upgrade-case/tier-upgrade-case.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';

export type AssessmentTriggerType =
  | 'INITIAL_ONBOARDING'
  | 'SCHEDULED_QUARTERLY'
  | 'SUMSUB_AML_HIT'
  | 'MLRO_MANUAL';

// All statuses that mean "an active CRA exists — don't create another"
const ACTIVE_CRA_STATUSES = ['PENDING_SUMSUB_RESULT', 'PENDING_MLRO_REVIEW', 'ESCALATED_TO_SUMSUB'];

@Injectable()
export class ClientRiskAssessmentService {
  private readonly logger = new Logger(ClientRiskAssessmentService.name);

  /** Property-injected in module to avoid circular deps */
  materialRefreshService?: {
    seedInitialHoldings: (id: string, levelName: string) => Promise<void>;
    recomputeHoldingsForCustomer: (id: string, levelName: string) => Promise<any>;
  };

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly sumsubClient: SumsubClient,
    private readonly approvalsService: ApprovalsService,
    private readonly policyLoader: ClientRiskAssessmentPolicyLoader,
    private readonly tierUpgradeCaseService: TierUpgradeCaseService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  // ─── Public entry points ──────────────────────────────────────────────────

  /** Triggers fresh /aml/check and creates PENDING_SUMSUB_RESULT assessment */
  async startAssessment(input: {
    customerId: string;
    triggerType: Exclude<AssessmentTriggerType, 'INITIAL_ONBOARDING'>;
    triggeredBy?: string;
    triggeredContext?: Record<string, any>;
  }): Promise<any> {
    // Idempotency: block if ANY active assessment exists
    const existing = await this.prisma.clientRiskAssessment.findFirst({
      where: { customerId: input.customerId, status: { in: ACTIVE_CRA_STATUSES } },
    });
    if (existing) return existing;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: input.customerId },
    });
    if (!customer) throw new Error(`Customer ${input.customerId} not found`);

    const policy = this.policyLoader.getPolicy();
    const assessmentNo = generateReferenceNo('CRA');
    const traceId = `CLIENT_RISK_ASSESSMENT:${randomUUID()}`;

    const assessment = await this.prisma.clientRiskAssessment.create({
      data: {
        assessmentNo,
        customerId: input.customerId,
        triggerType: input.triggerType,
        policyVersion: policy.version,
        previousRiskTier: customer.riskRating,
        status: 'PENDING_SUMSUB_RESULT',
        sumsubAmlCheckRequestedAt: new Date(),
        traceId,
      },
    });

    await this.auditLogsService.recordSystem({
      traceId,
      workflowType: 'RISK_ASSESSMENT',
      action: 'RISK_ASSESSMENT_STARTED',
      entityType: 'ClientRiskAssessment',
      entityId: assessment.id,
      entityNo: assessment.assessmentNo,
      entityOwnerType: 'Customer',
      entityOwnerId: input.customerId,
      metadata: { triggerType: input.triggerType },
    });

    if (customer.sumsubApplicantId) {
      try {
        const result = await this.sumsubClient.runAmlCheck(customer.sumsubApplicantId);
        await this.prisma.clientRiskAssessment.update({
          where: { id: assessment.id },
          data: { sumsubAmlCheckInspectionId: result.inspectionId },
        });
      } catch (err) {
        this.logger.error(`runAmlCheck failed for customer ${customer.id}:`, String(err));
      }
    }

    return assessment;
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
      this.logger.warn(`No pending assessment for inspectionId ${inspectionId}`);
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

  /**
   * Ongoing monitoring hit: create assessment from known result (no API call).
   * Also used for admin simulation of spontaneous AML hits.
   */
  async recordAssessmentFromKnownAmlResult(input: {
    customerId: string;
    triggerType?: string;
    knownAmlResult: { reviewAnswer: 'GREEN' | 'RED'; rejectLabels?: string[]; inspectionId?: string };
    snapshot?: any;
  }): Promise<any> {
    // Idempotency: block if ANY active assessment exists
    const existing = await this.prisma.clientRiskAssessment.findFirst({
      where: { customerId: input.customerId, status: { in: ACTIVE_CRA_STATUSES } },
    });
    if (existing) return existing;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: input.customerId },
    });
    if (!customer) throw new Error(`Customer ${input.customerId} not found`);

    const policy = this.policyLoader.getPolicy();
    const assessmentNo = generateReferenceNo('CRA');
    const traceId = `CLIENT_RISK_ASSESSMENT:${randomUUID()}`;

    const assessment = await this.prisma.clientRiskAssessment.create({
      data: {
        assessmentNo,
        customerId: input.customerId,
        triggerType: input.triggerType || 'SUMSUB_AML_HIT',
        policyVersion: policy.version,
        previousRiskTier: customer.riskRating,
        status: 'PENDING_SUMSUB_RESULT',
        sumsubSnapshotAt: new Date(),
        sumsubAmlReviewAnswer: input.knownAmlResult.reviewAnswer,
        sumsubAmlLabels: JSON.stringify(input.knownAmlResult.rejectLabels || []),
        sumsubAmlCheckInspectionId: input.knownAmlResult.inspectionId || null,
        traceId,
      },
    });

    return this.processAssessmentResult(assessment.id, {
      reviewAnswer: input.knownAmlResult.reviewAnswer,
      rejectLabels: input.knownAmlResult.rejectLabels || [],
    });
  }

  /** Called by approval projection when CRA MLRO review is decided */
  async handleSignoffComplete(
    assessmentId: string,
    approvalCase: { status: string },
  ): Promise<void> {
    const assessment = await this.prisma.clientRiskAssessment.findUnique({
      where: { id: assessmentId },
    });
    if (!assessment) return;

    const isLowToHigh =
      assessment.previousRiskTier === 'LOW' && assessment.resultingRiskTier === 'HIGH';

    if (approvalCase.status === 'APPROVED') {
      if (isLowToHigh) {
        // Tier promotion owned by TierUpgradeCase
        await this.prisma.$transaction(async (tx) => {
          await tx.clientRiskAssessment.update({
            where: { id: assessmentId },
            data: { status: 'SIGNED', signedAt: new Date(), signedBy: 'MLRO' },
          });
          await tx.customerMain.update({
            where: { id: assessment.customerId },
            data: { latestRiskAssessmentId: assessment.id },
          });
        });
        await this.auditLogsService.recordSystem({
          traceId: assessment.traceId,
          workflowType: 'RISK_ASSESSMENT',
          action: 'RISK_ASSESSMENT_MLRO_SIGNED',
          entityType: 'ClientRiskAssessment',
          entityId: assessmentId,
          entityOwnerType: 'Customer',
          entityOwnerId: assessment.customerId,
          metadata: { scenarioType: 'LOW_TO_HIGH' },
        });
        await this.tierUpgradeCaseService.createFromCra(assessment);
      } else {
        // HIGH→HIGH label confirmation: cascade (tier stays HIGH)
        await this.prisma.$transaction(async (tx) => {
          await tx.clientRiskAssessment.update({
            where: { id: assessmentId },
            data: { status: 'SIGNED', signedAt: new Date(), signedBy: 'MLRO' },
          });
        });
        await this.auditLogsService.recordSystem({
          traceId: assessment.traceId,
          workflowType: 'RISK_ASSESSMENT',
          action: 'RISK_ASSESSMENT_MLRO_SIGNED',
          entityType: 'ClientRiskAssessment',
          entityId: assessmentId,
          entityOwnerType: 'Customer',
          entityOwnerId: assessment.customerId,
          metadata: { scenarioType: 'HIGH_TO_HIGH_UPGRADE' },
        });
        await this.postSignoffCascade(assessmentId);
      }
    } else {
      // REJECTED
      if (isLowToHigh) {
        // False positive: override resultingTier back to LOW
        await this.prisma.$transaction(async (tx) => {
          await tx.clientRiskAssessment.update({
            where: { id: assessmentId },
            data: {
              status: 'SIGNED',
              signedAt: new Date(),
              signedBy: 'MLRO_FALSE_POSITIVE',
              resultingRiskTier: assessment.previousRiskTier,
            },
          });
        });
        await this.auditLogsService.recordSystem({
          traceId: assessment.traceId,
          workflowType: 'RISK_ASSESSMENT',
          action: 'RISK_ASSESSMENT_MLRO_FALSE_POSITIVE',
          entityType: 'ClientRiskAssessment',
          entityId: assessmentId,
          entityOwnerType: 'Customer',
          entityOwnerId: assessment.customerId,
          metadata: { scenarioType: 'LOW_TO_HIGH_FALSE_POSITIVE' },
        });
      } else {
        // HIGH→HIGH dismissed: sign as-is (tier stays HIGH)
        await this.prisma.$transaction(async (tx) => {
          await tx.clientRiskAssessment.update({
            where: { id: assessmentId },
            data: { status: 'SIGNED', signedAt: new Date(), signedBy: 'MLRO_REJECTED' },
          });
        });
        await this.auditLogsService.recordSystem({
          traceId: assessment.traceId,
          workflowType: 'RISK_ASSESSMENT',
          action: 'RISK_ASSESSMENT_MLRO_DISMISSED',
          entityType: 'ClientRiskAssessment',
          entityId: assessmentId,
          entityOwnerType: 'Customer',
          entityOwnerId: assessment.customerId,
          metadata: { scenarioType: 'HIGH_TO_HIGH_DISMISSED' },
        });
      }
      await this.postSignoffCascade(assessmentId);
    }
  }

  // ─── Internal processing ──────────────────────────────────────────────────

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

    // Fetch snapshot for scoring
    const snapshot = customer.sumsubApplicantId
      ? await this.sumsubClient.getApplicant(customer.sumsubApplicantId)
      : { tags: [], totalScore: null };

    const holdings = await this.prisma.customerMaterialHolding.findMany({
      where: { customerId: customer.id },
    });

    // Load previous labels for HIGH→HIGH comparison
    let previousLabels: string[] | undefined;
    if (customer.riskRating === 'HIGH') {
      const prevAssessment = await this.prisma.clientRiskAssessment.findFirst({
        where: { customerId: customer.id, status: 'SIGNED' },
        orderBy: { triggeredAt: 'desc' },
      });
      if (prevAssessment?.sumsubAmlLabels) {
        try {
          previousLabels = JSON.parse(prevAssessment.sumsubAmlLabels) as string[];
        } catch {
          previousLabels = [];
        }
      }
    }

    const policy = this.policyLoader.getPolicy();
    const policyInput: PolicyInput = {
      amlAnswer: reviewResult.reviewAnswer,
      amlLabels: labels,
      holdings: holdings.map((h: any) => ({
        materialType: h.materialType,
        status: h.status,
        expiresAt: h.expiresAt,
      })),
      previousTier: customer.riskRating as any,
      previousPepStatus: customer.pepStatus as any,
      previousLabels,
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

  private async routeSignoff(
    assessmentId: string,
    customer: any,
    output: PolicyOutput,
  ): Promise<void> {
    const policy = this.policyLoader.getPolicy();
    const assessment = await this.prisma.clientRiskAssessment.findUnique({
      where: { id: assessmentId },
    });
    if (!assessment) return;

    // AUTO paths → SIGNED immediately
    if (output.scenarioType === 'LOW_TO_LOW' || output.scenarioType === 'HIGH_TO_HIGH_STABLE') {
      await this.prisma.clientRiskAssessment.update({
        where: { id: assessmentId },
        data: {
          status: 'SIGNED',
          signedBy: 'SYSTEM',
          signedAt: new Date(),
          signedUnderPolicyVersion: policy.version,
        },
      });
      await this.auditLogsService.recordSystem({
        traceId: assessment.traceId,
        workflowType: 'RISK_ASSESSMENT',
        action: 'RISK_ASSESSMENT_AUTO_SIGNED',
        entityType: 'ClientRiskAssessment',
        entityId: assessmentId,
        entityOwnerType: 'Customer',
        entityOwnerId: assessment.customerId,
        metadata: { scenarioType: output.scenarioType },
      });
      await this.postSignoffCascade(assessmentId);
      return;
    }

    // MLRO review needed (LOW→HIGH or HIGH→HIGH with new labels)
    if (output.scenarioType === 'LOW_TO_HIGH' || output.scenarioType === 'HIGH_TO_HIGH_UPGRADE') {
      await this.startMlroReview(assessment, output.scenarioType);
      return;
    }

    // Sanctions → already handled in processAssessmentResult
  }

  private async startMlroReview(assessment: any, scenarioType: string): Promise<void> {
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: 'RISK_RATING_MLRO_REVIEW',
        entityRef: `client_risk_assessment:${assessment.id}`,
        traceId: assessment.traceId,
        workflowType: 'RISK_ASSESSMENT',
        workflowId: assessment.id,
        workflowNo: assessment.assessmentNo,
        metadata: {
          assessmentId: assessment.id,
          resultingTier: assessment.resultingRiskTier,
          scenarioType,
        },
      } as any,
      { reason: `MLRO review for ${assessment.assessmentNo} (${scenarioType})` },
      { actorType: 'ADMIN', userId: 'SYSTEM', roleCodes: ['SUPER_ADMIN'] } as any,
    );
    await this.prisma.clientRiskAssessment.update({
      where: { id: assessment.id },
      data: { status: 'PENDING_MLRO_REVIEW', approvalCaseId: approvalCase.id },
    });
  }

  private async handleSanctionsPath(
    assessment: any,
    customer: any,
    labels: string[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.customerMain.update({
        where: { id: customer.id },
        data: {
          complianceStatus: 'FROZEN',
          complianceFreezeReason: 'sanctions_hit_pending_investigation',
        },
      });
      await tx.clientRiskAssessment.update({
        where: { id: assessment.id },
        data: {
          status: 'ESCALATED_TO_SUMSUB',
          resultingRiskTier: 'HIGH',
          recommendedAction: 'ESCALATE_TO_SUMSUB_CASE',
          signoffMethod: 'ESCALATED',
          reasoning: JSON.stringify({ ruleId: 'P1_labels_contains_SANCTIONS', labels }),
        },
      });
    });
    await this.auditLogsService.recordSystem({
      traceId: assessment.traceId,
      workflowType: 'RISK_ASSESSMENT',
      action: 'RISK_ASSESSMENT_ESCALATED_SANCTIONS',
      entityType: 'ClientRiskAssessment',
      entityId: assessment.id,
      entityOwnerType: 'Customer',
      entityOwnerId: customer.id,
      metadata: { labels },
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

    const tierChanged =
      assessment.resultingRiskTier &&
      assessment.resultingRiskTier !== customer.riskRating;

    const updateData: any = {
      latestRiskAssessmentId: assessment.id,
      latestRiskApprovalId: assessment.approvalCaseId,
      latestRiskApprovalStatus: 'APPROVED',
    };

    if (tierChanged) {
      updateData.riskRating = assessment.resultingRiskTier;
      updateData.riskRatingUpdatedAt = new Date();
    }

    await this.prisma.customerMain.update({
      where: { id: customer.id },
      data: updateData,
    });

    // Sync Sumsub level (skip if frozen)
    if (customer.complianceStatus !== 'FROZEN' && assessment.resultingRiskTier) {
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
          this.logger.error(`moveToLevel failed for ${customer.id}:`, String(err));
        }
      }
    }

    // Seed or recompute material holdings
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
        this.logger.error(`Layer 3 holdings failed for ${customer.id}:`, String(err));
      }
    }
  }
}
