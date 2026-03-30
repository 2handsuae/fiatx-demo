import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  ComplianceAlertSeverity,
} from './compliance-alerts/constants/compliance-alert-rules.constant';
import { ComplianceAlertsService } from './compliance-alerts/compliance-alerts.service';
import {
  ComplianceReviewRule,
  ComplianceReviewStage,
  ComplianceWorkflow,
  PERIODIC_REVIEW_SOURCE_TYPE,
  PERIODIC_REVIEW_WORKFLOW,
  getCanonicalReviewRuleForStage,
  getCanonicalOnboardingRuleForStage,
  ONBOARDING_REVIEW_STAGES,
  ONBOARDING_SOURCE_TYPE,
  ONBOARDING_WORKFLOW,
} from './constants/onboarding-compliance-workflow.constant';
import {
  normalizeRiskRecommendedActionType,
  RISK_RECOMMENDED_ACTIONS,
  RiskRecommendedActionType,
} from './constants/risk-recommended-actions.constant';
import { normalizeWorkflowDecision } from './constants/compliance-disposition.constant';
import { RiskDecision, RiskRecommendedAction } from './risk-engine.service';

const AUTO_ESCALATE_DISABLED_REASON = 'PHASE7_AUTO_ESCALATE_NOT_ENABLED';

export interface RiskDecisionOrchestratorInput {
  workflow: ComplianceWorkflow;
  stage: ComplianceReviewStage;
  customerId: string;
  customerNo?: string | null;
  journeyId?: string;
  sourceId?: string;
  sourceNo?: string | null;
  linkedCaseIds?: string[];
  decisionRecordId: string;
  decision: RiskDecision;
  reasonCodes: string[];
  recommendedActions: RiskRecommendedAction[];
  contextType: string;
  sourceModule?: string;
}

export interface RiskDecisionOrchestratorActionResult {
  type: RiskRecommendedActionType;
  reason?: string;
}

export interface RiskDecisionOrchestratorOutput {
  workflow: ComplianceWorkflow;
  stage: ComplianceReviewStage;
  rule: ComplianceReviewRule;
  recommendedDecisions: string[];
  executedActions: RiskDecisionOrchestratorActionResult[];
  skippedActions: RiskDecisionOrchestratorActionResult[];
  alertId?: string;
  alertNo?: string;
  alertUpserted: boolean;
}

export interface UpsertOnboardingReviewAlertInput {
  workflow: ComplianceWorkflow;
  customerId: string;
  customerNo?: string | null;
  journeyId?: string;
  sourceId: string;
  sourceNo?: string | null;
  stage: ComplianceReviewStage;
  recommendation: string;
  decision?: string | null;
  severity?: ComplianceAlertSeverity;
  message: string;
  linkedCaseIds?: string[];
  decisionRecordIds?: string[];
  reasonCodes?: string[];
  recommendedActions?: RiskRecommendedAction[];
  recommendedDecisions?: string[];
  contextType?:
    | 'ONBOARDING_CDD'
    | 'ONBOARDING_EDD'
    | 'PERIODIC_REVIEW_CDD'
    | 'PERIODIC_REVIEW_EDD'
    | null;
  sourceModule?: string;
}

@Injectable()
export class RiskDecisionOrchestratorService {
  private readonly logger = new Logger(RiskDecisionOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly complianceAlertsService: ComplianceAlertsService,
  ) {}

  private parseJsonSafely(value?: string | null): Record<string, unknown> {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private normalizeRecommendedDecision(value: unknown): string | null {
    const normalized = normalizeWorkflowDecision(value);
    if (normalized === 'CLEAR' || normalized === 'REJECT' || normalized === 'REQUIRE_EDD') {
      return normalized;
    }
    return null;
  }

  private dedupeRecommendedDecisions(values: unknown[]): string[] {
    const list = values
      .map((item) => this.normalizeRecommendedDecision(item))
      .filter((item): item is string => !!item);
    return Array.from(new Set(list));
  }

  private getRecommendedDecisions(recommendedActions: RiskRecommendedAction[]): string[] {
    const advisory = recommendedActions.find(
      (action) =>
        normalizeRiskRecommendedActionType(action?.type) ===
        RISK_RECOMMENDED_ACTIONS.ONBOARDING_RECOMMEND_DECISIONS,
    );
    const values = Array.isArray(advisory?.payload?.decisions)
      ? advisory.payload?.decisions
      : [];
    return this.dedupeRecommendedDecisions(values as unknown[]);
  }

  private normalizeAlertSeverity(
    value: unknown,
    fallback: ComplianceAlertSeverity = ComplianceAlertSeverity.HIGH,
  ): ComplianceAlertSeverity {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === ComplianceAlertSeverity.LOW) return ComplianceAlertSeverity.LOW;
    if (normalized === ComplianceAlertSeverity.MEDIUM) return ComplianceAlertSeverity.MEDIUM;
    if (normalized === ComplianceAlertSeverity.HIGH) return ComplianceAlertSeverity.HIGH;
    if (normalized === ComplianceAlertSeverity.CRITICAL) return ComplianceAlertSeverity.CRITICAL;
    return fallback;
  }

  private getUpsertAlertPayload(
    recommendedActions: RiskRecommendedAction[],
  ): RiskRecommendedAction | null {
    return (
      recommendedActions.find(
        (action) =>
          normalizeRiskRecommendedActionType(action?.type) ===
          RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
      ) || null
    );
  }

  private getStageDefaultMessage(stage: ComplianceReviewStage): string {
    if (stage === ONBOARDING_REVIEW_STAGES.REVIEW_EDD) {
      return 'EDD submitted. Waiting for compliance review decision.';
    }
    return 'CDD submitted. Waiting for compliance review decision.';
  }

  private async writeOrchestrationSnapshot(
    decisionRecordId: string,
    snapshot: RiskDecisionOrchestratorOutput,
  ) {
    const current = await (this.prisma as any).workflowDecisionRecord.findUnique({
      where: { id: decisionRecordId },
      select: { outputs: true },
    });

    if (!current) {
      this.logger.warn(`Decision record missing during orchestration snapshot: ${decisionRecordId}`);
      return;
    }

    const outputs = this.parseJsonSafely(current.outputs);
    const nextOutputs = {
      ...outputs,
      orchestration: {
        workflow: snapshot.workflow,
        stage: snapshot.stage,
        rule: snapshot.rule,
        executedActions: snapshot.executedActions,
        skippedActions: snapshot.skippedActions,
        alertId: snapshot.alertId || null,
        alertNo: snapshot.alertNo || null,
        alertUpserted: snapshot.alertUpserted,
        recommendedDecisions: snapshot.recommendedDecisions,
      },
    };

    await (this.prisma as any).workflowDecisionRecord.update({
      where: { id: decisionRecordId },
      data: {
        outputs: JSON.stringify(nextOutputs),
      },
    });
  }

  async orchestrate(input: RiskDecisionOrchestratorInput): Promise<RiskDecisionOrchestratorOutput> {
    if (
      input.workflow !== ONBOARDING_WORKFLOW &&
      input.workflow !== PERIODIC_REVIEW_WORKFLOW
    ) {
      throw new BadRequestException(
        `Unsupported risk orchestration workflow: ${String(input.workflow || '')}`,
      );
    }

    const rule = getCanonicalReviewRuleForStage(input.stage, input.workflow);
    if (!rule) {
      throw new BadRequestException(
        `Unsupported risk orchestration stage: ${String(input.stage || '')}`,
      );
    }

    const recommendedDecisions = this.getRecommendedDecisions(input.recommendedActions);
    const executedActions: RiskDecisionOrchestratorActionResult[] = [];
    const skippedActions: RiskDecisionOrchestratorActionResult[] = [];

    let alertId: string | undefined;
    let alertNo: string | undefined;
    let alertUpserted = false;

    const normalizedActionTypes = Array.from(
      new Set(
        input.recommendedActions
          .map((action) => normalizeRiskRecommendedActionType(action?.type))
          .filter((value): value is RiskRecommendedActionType => !!value),
      ),
    );

    const upsertPayload = this.getUpsertAlertPayload(input.recommendedActions);
    if (normalizedActionTypes.includes(RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT) && upsertPayload) {
      const resolvedSourceId =
        String(input.sourceId || '').trim() ||
        (input.journeyId ? `${input.customerId}:${input.journeyId}` : '');
      const resolvedSourceNo = String(input.sourceNo || '').trim() || input.journeyId || null;
      const alert = await this.upsertOnboardingReviewAlert({
        workflow: input.workflow,
        customerId: input.customerId,
        customerNo: input.customerNo || null,
        sourceId: resolvedSourceId,
        sourceNo: resolvedSourceNo,
        stage: input.stage,
        recommendation:
          String(upsertPayload.payload?.recommendation || '').trim().toUpperCase() || 'REVIEW',
        severity: this.normalizeAlertSeverity(
          upsertPayload.payload?.severity,
          ComplianceAlertSeverity.HIGH,
        ),
        message: this.getStageDefaultMessage(input.stage),
        linkedCaseIds: input.linkedCaseIds || [],
        decisionRecordIds: [input.decisionRecordId],
        reasonCodes: input.reasonCodes,
        recommendedActions: input.recommendedActions,
        recommendedDecisions,
        contextType:
          input.contextType === 'ONBOARDING_EDD' ||
          input.contextType === 'PERIODIC_REVIEW_EDD'
            ? (input.contextType as 'ONBOARDING_EDD' | 'PERIODIC_REVIEW_EDD')
            : (input.contextType as 'ONBOARDING_CDD' | 'PERIODIC_REVIEW_CDD'),
        sourceModule: input.sourceModule,
      });
      if (alert) {
        alertId = alert.id;
        alertNo = alert.alertNo;
        alertUpserted = true;
        executedActions.push({ type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT });
      }
    }

    if (
      normalizedActionTypes.includes(RISK_RECOMMENDED_ACTIONS.ONBOARDING_RECOMMEND_DECISIONS)
    ) {
      executedActions.push({
        type: RISK_RECOMMENDED_ACTIONS.ONBOARDING_RECOMMEND_DECISIONS,
      });
    }

    if (normalizedActionTypes.includes(RISK_RECOMMENDED_ACTIONS.AUTO_ESCALATE_CASE)) {
      skippedActions.push({
        type: RISK_RECOMMENDED_ACTIONS.AUTO_ESCALATE_CASE,
        reason: AUTO_ESCALATE_DISABLED_REASON,
      });
    }

    const snapshot: RiskDecisionOrchestratorOutput = {
      workflow: input.workflow,
      stage: input.stage,
      rule,
      recommendedDecisions,
      executedActions,
      skippedActions,
      alertId,
      alertNo,
      alertUpserted,
    };

    await this.writeOrchestrationSnapshot(input.decisionRecordId, snapshot);
    return snapshot;
  }

  async upsertOnboardingReviewAlert(
    input: UpsertOnboardingReviewAlertInput,
  ): Promise<any | null> {
    const actionNames = Array.from(
      new Set(
        (input.recommendedActions || [])
          .map((action) => normalizeRiskRecommendedActionType(action?.type))
          .filter(Boolean),
      ),
    );

    try {
      const resolvedSourceId =
        String(input.sourceId || '').trim() ||
        (input.journeyId ? `${input.customerId}:${input.journeyId}` : '');
      const resolvedSourceNo = String(input.sourceNo || '').trim() || input.journeyId || null;
      const sourceType =
        input.workflow === PERIODIC_REVIEW_WORKFLOW
          ? PERIODIC_REVIEW_SOURCE_TYPE
          : ONBOARDING_SOURCE_TYPE;
      const canonicalRule =
        getCanonicalReviewRuleForStage(input.stage, input.workflow) ||
        getCanonicalOnboardingRuleForStage(input.stage) ||
        'ONB_CDD_REVIEW_REQUIRED';

      return await this.complianceAlertsService.triggerSystemAlert({
        ruleCode: canonicalRule,
        sourceModule: input.sourceModule || 'identity/onboarding',
        sourceType,
        sourceId: resolvedSourceId,
        sourceNo: resolvedSourceNo,
        stage: input.stage,
        journeyId:
          input.workflow === ONBOARDING_WORKFLOW
            ? resolvedSourceId.split(':')[1] || input.journeyId || null
            : null,
        customerId: input.customerId,
        customerNo: input.customerNo || null,
        ownerType: 'CUSTOMER',
        ownerId: input.customerId,
        severity: input.severity || ComplianceAlertSeverity.HIGH,
        decisionRecommendation: input.recommendation,
        decision: input.decision || null,
        linkedCaseIds: input.linkedCaseIds || [],
        decisionRecordIds: input.decisionRecordIds || [],
        message: input.message,
        metadata: {
          workflow: input.workflow,
          sourceType,
          recommendation: input.recommendation,
          decision: input.decision || null,
          linkedCaseIds: input.linkedCaseIds || [],
          decisionRecordIds: input.decisionRecordIds || [],
          reasonCodes: input.reasonCodes || [],
          recommendedActions: actionNames,
          recommendedDecisions: input.recommendedDecisions || [],
          contextType: input.contextType || null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to upsert onboarding review alert for customer=${input.customerId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  async closeLatestJourneyAlertIfAny(input: {
    sourceType?: string;
    sourceId: string;
    reason: string;
    stage?: ComplianceReviewStage;
  }): Promise<void> {
    const alert = await this.prisma.complianceAlert.findFirst({
      where: {
        sourceType: input.sourceType || ONBOARDING_SOURCE_TYPE,
        sourceId: input.sourceId,
        ...(input.stage ? { stage: input.stage } : {}),
        status: {
          in: ['OPEN', 'ASSIGNED', 'ESCALATED'],
        },
      },
      orderBy: [{ lastOccurredAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true },
    });

    if (!alert) return;

    try {
      await this.complianceAlertsService.applyAction(
        alert.id,
        {
          action: 'CLOSE' as any,
          reason: input.reason,
          note: input.reason,
          decision: 'CLEAR',
        },
        {
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          actorNo: 'SYSTEM',
          actorRole: 'SYSTEM',
          sourcePlatform: 'SYSTEM',
        },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to close onboarding alert id=${alert.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async findAlertDetail(id: string) {
    return this.complianceAlertsService.findOne(id);
  }
}
