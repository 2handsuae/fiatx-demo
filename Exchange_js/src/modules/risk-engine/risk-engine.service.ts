import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RISK_RECOMMENDED_ACTIONS } from './constants/risk-recommended-actions.constant';

export type RiskDecision = 'APPROVE' | 'REJECT' | 'REQUIRE_EDD' | 'REVIEW';

export interface RiskRecommendedAction {
  type: string;
  payload?: Record<string, unknown>;
}

export interface EvaluateRiskInput {
  contextType: string;
  subjectType: string;
  subjectId: string;
  ownerType: string;
  ownerId: string;
  signals: Record<string, unknown>;
  policyVersion?: string;
}

export interface EvaluateRiskOutput {
  decision: RiskDecision;
  recommendedActions: RiskRecommendedAction[];
  reasonCodes: string[];
  policyVersion: string;
  decisionRecordId: string;
}

@Injectable()
export class RiskEngineService {
  static readonly PHASE2_UNSUPPORTED_OWNER_TYPE = 'Phase 2 storage unsupported owner type';

  private readonly logger = new Logger(RiskEngineService.name);

  constructor(private readonly prisma: PrismaService) {}

  private stableStringify(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }

    const input = value as Record<string, unknown>;
    const keys = Object.keys(input).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${this.stableStringify(input[key])}`);
    return `{${entries.join(',')}}`;
  }

  private maskSignals(value: unknown, keyName = ''): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') {
      const lowerKey = keyName.toLowerCase();
      if (
        lowerKey.includes('name') ||
        lowerKey.includes('email') ||
        lowerKey.includes('phone') ||
        lowerKey.includes('address') ||
        lowerKey.includes('idnumber') ||
        lowerKey.includes('document') ||
        lowerKey.includes('passport')
      ) {
        return '[REDACTED]';
      }
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.maskSignals(item, keyName));
    }

    const output: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      output[key] = this.maskSignals(child, key);
    });
    return output;
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const casted = Number(value);
    return Number.isFinite(casted) ? casted : null;
  }

  private toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return false;
  }

  private buildOnboardingDecisionActions(decisions: string[]): RiskRecommendedAction[] {
    return [
      {
        type: RISK_RECOMMENDED_ACTIONS.ONBOARDING_RECOMMEND_DECISIONS,
        payload: {
          decisions,
        },
      },
    ];
  }

  private buildPeriodicReviewDecisionActions(decisions: string[]): RiskRecommendedAction[] {
    return this.buildOnboardingDecisionActions(decisions);
  }

  private evaluateBySignals(input: EvaluateRiskInput): Omit<EvaluateRiskOutput, 'decisionRecordId' | 'policyVersion'> {
    const signals = input.signals || {};
    const riskScore = this.toNumber(signals.riskScore) ?? 0;
    const riskLevel = String(signals.riskLevel || '').toUpperCase();
    const mockDataType = String(signals.mockDataType || '').toUpperCase();
    const sanctionsHit = this.toBoolean(signals.sanctionsHit);
    const pepHit = this.toBoolean(signals.pepHit);
    const adverseMediaHit = this.toBoolean(signals.adverseMediaHit);
    const eddSubmitted = this.toBoolean(signals.eddSubmitted);

    const reasonCodes: string[] = [];
    const recommendedActions: RiskRecommendedAction[] = [];

    if (input.contextType === 'ONBOARDING_CDD' || input.contextType === 'PERIODIC_REVIEW_CDD') {
      const isPeriodicReview = input.contextType === 'PERIODIC_REVIEW_CDD';
      let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM';

      if (mockDataType === 'SANCTION_AND_OTHER') {
        reasonCodes.push('SANCTIONS_HIT');
        if (adverseMediaHit) reasonCodes.push('ADVERSE_MEDIA_HIT');
        if (pepHit) reasonCodes.push('PEP_HIT');
        severity = 'CRITICAL';
      } else if (sanctionsHit) {
        reasonCodes.push('SANCTIONS_HIT');
        severity = 'CRITICAL';
      } else if (mockDataType === 'LOW_RISK') {
        reasonCodes.push(isPeriodicReview ? 'PRR_CDD_LOW_RISK_REVIEW' : 'CDD_LOW_RISK_CLEAR');
        severity = 'LOW';
      } else if (mockDataType === 'MEDIUM_RISK') {
        reasonCodes.push('CDD_MEDIUM_RISK_REVIEW');
        severity = 'MEDIUM';
      } else if (mockDataType === 'HIGH_RISK_OR_PEP') {
        reasonCodes.push('CDD_HIGH_RISK_OR_PEP');
        if (pepHit) reasonCodes.push('PEP_HIT');
        severity = 'HIGH';
      } else {
        if (pepHit) reasonCodes.push('PEP_HIT');
        if (adverseMediaHit) reasonCodes.push('ADVERSE_MEDIA_HIT');
        if (riskLevel === 'HIGH' || riskScore >= 70) reasonCodes.push('HIGH_RISK_SCORE');
        if (reasonCodes.length === 0) reasonCodes.push('CDD_REVIEW_REQUIRED');
        severity = riskLevel === 'HIGH' || riskScore >= 70 || pepHit ? 'HIGH' : 'MEDIUM';
      }

      if (!isPeriodicReview && mockDataType !== 'LOW_RISK') {
        recommendedActions.push({
          type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
          payload: {
            severity,
            recommendation: 'REVIEW',
            reasonCodes,
          },
        });
      } else if (isPeriodicReview) {
        recommendedActions.push({
          type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
          payload: {
            severity,
            recommendation: 'REVIEW',
            reasonCodes,
          },
        });
      }
      recommendedActions.push(
        ...(isPeriodicReview
          ? this.buildPeriodicReviewDecisionActions([
              'APPROVE',
              'REJECT',
              'REQUIRE_EDD',
            ])
          : this.buildOnboardingDecisionActions([
              'APPROVE',
              'REJECT',
              'REQUIRE_EDD',
            ])),
      );
      return { decision: 'REVIEW', reasonCodes, recommendedActions };
    }

    if (input.contextType === 'ONBOARDING_EDD' || input.contextType === 'PERIODIC_REVIEW_EDD') {
      let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM';
      if (!eddSubmitted) {
        reasonCodes.push('EDD_INCOMPLETE');
        severity = 'MEDIUM';
      } else {
        if (sanctionsHit) {
          reasonCodes.push('SANCTIONS_HIT');
          severity = 'CRITICAL';
        }
        if (pepHit) reasonCodes.push('PEP_HIT');
        if (adverseMediaHit) reasonCodes.push('ADVERSE_MEDIA_HIT');
        if (riskLevel === 'HIGH' || riskScore >= 75) reasonCodes.push('HIGH_RISK_SCORE');
        if (reasonCodes.length === 0) {
          reasonCodes.push('EDD_CLEAR');
          severity = 'LOW';
        } else if (severity !== 'CRITICAL') {
          severity = reasonCodes.includes('HIGH_RISK_SCORE') ? 'HIGH' : 'MEDIUM';
        }
      }

      recommendedActions.push({
        type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
        payload: {
          severity,
          recommendation: 'REVIEW',
          reasonCodes,
        },
      });
      recommendedActions.push(
        ...this.buildOnboardingDecisionActions([
          'APPROVE',
          'REJECT',
        ]),
      );
      return { decision: 'REVIEW', reasonCodes, recommendedActions };
    }

    if (sanctionsHit) {
      reasonCodes.push('SANCTIONS_HIT');
      recommendedActions.push({
        type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
        payload: {
          severity: 'CRITICAL',
          recommendation: 'REJECT',
          reasonCode: 'SANCTIONS_HIT',
        },
      });
      recommendedActions.push({
        type: RISK_RECOMMENDED_ACTIONS.AUTO_ESCALATE_CASE,
        payload: {
          reasonCode: 'SANCTIONS_HIT',
        },
      });
      return { decision: 'REJECT', reasonCodes, recommendedActions };
    }

    reasonCodes.push('UNKNOWN_CONTEXT');
    recommendedActions.push({
      type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
      payload: {
        severity: 'MEDIUM',
        recommendation: 'REVIEW',
        reasonCode: 'UNKNOWN_CONTEXT',
      },
    });
    return { decision: 'REVIEW', reasonCodes, recommendedActions };
  }

  async evaluate(input: EvaluateRiskInput): Promise<EvaluateRiskOutput> {
    if (input.ownerType !== 'CUSTOMER') {
      throw new BadRequestException(RiskEngineService.PHASE2_UNSUPPORTED_OWNER_TYPE);
    }

    const policyVersion = input.policyVersion || 'onboarding-risk-policy/v1';
    const maskedInput = {
      contextType: input.contextType,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      signals: this.maskSignals(input.signals || {}),
    };
    const inputHash = createHash('sha256').update(this.stableStringify(maskedInput)).digest('hex');
    const created = await (this.prisma as any).workflowDecisionRecord.create({
      data: {
        customerId: input.ownerId,
        contextType: input.contextType,
        subjectId: input.subjectId,
        policyVersion,
        status: 'CREATED',
        inputPayload: JSON.stringify(maskedInput),
        inputHash,
      },
    });

    try {
      const evaluated = this.evaluateBySignals(input);
      const outputs = {
        decision: evaluated.decision,
        reasonCodes: evaluated.reasonCodes,
        recommendedActions: evaluated.recommendedActions,
      };

      await (this.prisma as any).workflowDecisionRecord.update({
        where: { id: created.id },
        data: {
          status: 'COMPLETED',
          outputDecision: evaluated.decision,
          recommendedActions: JSON.stringify(evaluated.recommendedActions),
          outputs: JSON.stringify(outputs),
          reasonCodes: JSON.stringify(evaluated.reasonCodes),
          completedAt: new Date(),
        },
      });

      return {
        decision: evaluated.decision,
        reasonCodes: evaluated.reasonCodes,
        recommendedActions: evaluated.recommendedActions,
        policyVersion,
        decisionRecordId: created.id,
      };
    } catch (error) {
      await (this.prisma as any).workflowDecisionRecord.update({
        where: { id: created.id },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : String(error),
          completedAt: new Date(),
        },
      });
      this.logger.error(
        `Risk evaluate failed for owner=${input.ownerType}:${input.ownerId}, context=${input.contextType}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
