import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';

export type RiskDecision = 'APPROVE' | 'REJECT' | 'REQUIRE_EDD' | 'REVIEW';

export interface RiskRecommendedAction {
  type: string;
  payload?: Record<string, unknown>;
}

export interface EvaluateRiskInput {
  contextType: string;
  customerId: string;
  subjectId: string;
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

  private evaluateBySignals(input: EvaluateRiskInput): Omit<EvaluateRiskOutput, 'decisionRecordId' | 'policyVersion'> {
    const signals = input.signals || {};
    const riskScore = this.toNumber(signals.riskScore) ?? 0;
    const riskLevel = String(signals.riskLevel || '').toUpperCase();
    const sanctionsHit = this.toBoolean(signals.sanctionsHit);
    const pepHit = this.toBoolean(signals.pepHit);
    const adverseMediaHit = this.toBoolean(signals.adverseMediaHit);
    const eddSubmitted = this.toBoolean(signals.eddSubmitted);

    const reasonCodes: string[] = [];
    const recommendedActions: RiskRecommendedAction[] = [];

    if (sanctionsHit) {
      reasonCodes.push('SANCTIONS_HIT');
      recommendedActions.push({
        type: 'UPSERT_ALERT',
        payload: {
          severity: 'CRITICAL',
          recommendation: 'REJECT',
          reasonCode: 'SANCTIONS_HIT',
        },
      });
      recommendedActions.push({
        type: 'ESCALATE_INCIDENT',
        payload: {
          reasonCode: 'SANCTIONS_HIT',
        },
      });
      return { decision: 'REJECT', reasonCodes, recommendedActions };
    }

    if (input.contextType === 'ONBOARDING_CDD') {
      if (pepHit || adverseMediaHit || riskLevel === 'HIGH' || riskScore >= 70) {
        if (pepHit) reasonCodes.push('PEP_HIT');
        if (adverseMediaHit) reasonCodes.push('ADVERSE_MEDIA_HIT');
        if (riskLevel === 'HIGH' || riskScore >= 70) reasonCodes.push('HIGH_RISK_SCORE');
        recommendedActions.push({
          type: 'REQUIRE_EDD',
          payload: {
            recommendation: 'REQUIRE_EDD',
            reasonCodes,
          },
        });
        recommendedActions.push({
          type: 'UPSERT_ALERT',
          payload: {
            severity: 'HIGH',
            recommendation: 'REQUIRE_EDD',
            reasonCodes,
          },
        });
        return { decision: 'REQUIRE_EDD', reasonCodes, recommendedActions };
      }

      reasonCodes.push('CDD_CLEAR');
      recommendedActions.push({
        type: 'PENDING_FINAL_DECISION',
        payload: { recommendation: 'APPROVE' },
      });
      return { decision: 'APPROVE', reasonCodes, recommendedActions };
    }

    if (input.contextType === 'ONBOARDING_EDD') {
      if (!eddSubmitted) {
        reasonCodes.push('EDD_INCOMPLETE');
        recommendedActions.push({
          type: 'UPSERT_ALERT',
          payload: {
            severity: 'MEDIUM',
            recommendation: 'REVIEW',
            reasonCodes,
          },
        });
        return { decision: 'REVIEW', reasonCodes, recommendedActions };
      }

      if (pepHit || adverseMediaHit || riskLevel === 'HIGH' || riskScore >= 75) {
        if (pepHit) reasonCodes.push('PEP_HIT');
        if (adverseMediaHit) reasonCodes.push('ADVERSE_MEDIA_HIT');
        if (riskLevel === 'HIGH' || riskScore >= 75) reasonCodes.push('HIGH_RISK_SCORE');
        recommendedActions.push({
          type: 'UPSERT_ALERT',
          payload: {
            severity: 'HIGH',
            recommendation: 'REVIEW',
            reasonCodes,
          },
        });
        recommendedActions.push({
          type: 'PENDING_FINAL_DECISION',
          payload: {
            recommendation: 'REVIEW',
            requiresManualFinalDecision: true,
          },
        });
        return { decision: 'REVIEW', reasonCodes, recommendedActions };
      }

      reasonCodes.push('EDD_CLEAR');
      recommendedActions.push({
        type: 'PENDING_FINAL_DECISION',
        payload: {
          recommendation: 'APPROVE',
          requiresManualFinalDecision: true,
        },
      });
      return { decision: 'APPROVE', reasonCodes, recommendedActions };
    }

    reasonCodes.push('UNKNOWN_CONTEXT');
    recommendedActions.push({
      type: 'UPSERT_ALERT',
      payload: {
        severity: 'MEDIUM',
        recommendation: 'REVIEW',
        reasonCode: 'UNKNOWN_CONTEXT',
      },
    });
    return { decision: 'REVIEW', reasonCodes, recommendedActions };
  }

  async evaluate(input: EvaluateRiskInput): Promise<EvaluateRiskOutput> {
    const policyVersion = input.policyVersion || 'onboarding-risk-policy/v1';
    const maskedInput = {
      contextType: input.contextType,
      customerId: input.customerId,
      subjectId: input.subjectId,
      signals: this.maskSignals(input.signals || {}),
    };
    const inputHash = createHash('sha256').update(this.stableStringify(maskedInput)).digest('hex');
    const created = await (this.prisma as any).onboardingDecisionRecord.create({
      data: {
        customerId: input.customerId,
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

      await (this.prisma as any).onboardingDecisionRecord.update({
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
      await (this.prisma as any).onboardingDecisionRecord.update({
        where: { id: created.id },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : String(error),
          completedAt: new Date(),
        },
      });
      this.logger.error(
        `Risk evaluate failed for customer=${input.customerId}, context=${input.contextType}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
