import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
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

export interface PendingRiskDecisionRecordOutput {
  decisionRecordId: string;
  policyVersion: string;
  inputHash: string;
}

@Injectable()
export class RiskEngineService {
  static readonly PHASE2_UNSUPPORTED_OWNER_TYPE = 'Phase 2 storage unsupported owner type';

  private readonly logger = new Logger(RiskEngineService.name);

  constructor(private readonly prisma: PrismaService) {}

  private getDb(tx?: Prisma.TransactionClient) {
    return tx ?? this.prisma;
  }

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

  buildStoredInputPayload(input: EvaluateRiskInput) {
    return {
      contextType: input.contextType,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      signals: this.maskSignals(input.signals || {}),
    };
  }

  buildInputHash(input: EvaluateRiskInput): string {
    return createHash('sha256')
      .update(this.stableStringify(this.buildStoredInputPayload(input)))
      .digest('hex');
  }

  private resolvePolicyVersion(input: EvaluateRiskInput): string {
    if (input.policyVersion) return input.policyVersion;
    if (String(input.contextType || '').trim().toUpperCase().startsWith('TX_')) {
      return 'transaction-risk-policy/v1';
    }
    return 'onboarding-risk-policy/v1';
  }

  private evaluateBySignals(input: EvaluateRiskInput): Omit<EvaluateRiskOutput, 'decisionRecordId' | 'policyVersion'> {
    const signals = input.signals || {};
    const riskScore = this.toNumber(signals.riskScore) ?? 0;
    const riskLevel = String(signals.riskLevel || '').toUpperCase();
    const mockDataType = String(signals.mockDataType || '').toUpperCase();
    const simulationMode = String(signals.simulationMode || '').toUpperCase();
    const simulationRiskLevel = String(
      signals.simulationRiskLevel || '',
    ).toUpperCase();
    const simulationRiskReason = String(
      signals.simulationRiskReason || '',
    ).toUpperCase();
    const canonicalTransactionRiskBand = String(
      signals.riskBand || signals.simulationRiskLevel || '',
    ).toUpperCase();
    const canonicalTransactionRiskReason = String(
      signals.riskReason || signals.simulationRiskReason || '',
    ).toUpperCase();
    const sanctionsHit = this.toBoolean(signals.sanctionsHit);
    const pepHit = this.toBoolean(signals.pepHit);
    const adverseMediaHit = this.toBoolean(signals.adverseMediaHit);
    const eddSubmitted = this.toBoolean(signals.eddSubmitted);

    const reasonCodes: string[] = [];
    const recommendedActions: RiskRecommendedAction[] = [];

    if (input.contextType === 'ONBOARDING_CDD' || input.contextType === 'PERIODIC_REVIEW_CDD') {
      const isPeriodicReview = input.contextType === 'PERIODIC_REVIEW_CDD';
      let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM';

      if (!isPeriodicReview && simulationMode === 'MANUAL') {
        const riskBand =
          simulationRiskLevel === 'HIGH'
            ? 'HIGH'
            : simulationRiskLevel === 'MEDIUM'
              ? 'MEDIUM'
              : 'LOW';

        if (riskBand === 'HIGH') {
          reasonCodes.push(simulationRiskReason || 'CDD_HIGH_RISK_JURISDICTION');
          recommendedActions.push({
            type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
            payload: {
              severity: 'CRITICAL',
              recommendation: 'REVIEW',
              reasonCodes,
              riskBand,
              riskReason: simulationRiskReason || null,
            },
          });
          recommendedActions.push({
            type: RISK_RECOMMENDED_ACTIONS.AUTO_ESCALATE_CASE,
            payload: {
              reasonCodes,
              riskBand,
              riskReason: simulationRiskReason || null,
            },
          });
          recommendedActions.push(
            ...this.buildOnboardingDecisionActions(['APPROVE', 'REJECT', 'REQUIRE_EDD']),
          );
          return { decision: 'REVIEW', reasonCodes, recommendedActions };
        }

        if (riskBand === 'MEDIUM') {
          reasonCodes.push(simulationRiskReason || 'CDD_PROFILE_INCONSISTENT');
          recommendedActions.push({
            type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
            payload: {
              severity: 'MEDIUM',
              recommendation: 'REVIEW',
              reasonCodes,
              riskBand,
              riskReason: simulationRiskReason || null,
            },
          });
          recommendedActions.push(
            ...this.buildOnboardingDecisionActions(['APPROVE', 'REJECT', 'REQUIRE_EDD']),
          );
          return { decision: 'REVIEW', reasonCodes, recommendedActions };
        }

        reasonCodes.push('CDD_LOW_RISK_CLEAR');
        recommendedActions.push(
          ...this.buildOnboardingDecisionActions(['APPROVE', 'REJECT', 'REQUIRE_EDD']),
        );
        return { decision: 'REVIEW', reasonCodes, recommendedActions };
      }

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

    if (input.contextType === 'TX_DEPOSIT_KYT_MAIN') {
      const kytStatus = String(signals.kytStatus || signals.status || '').toUpperCase();

      if (kytStatus === 'PASS') {
        reasonCodes.push('TX_KYT_PASS');
        return { decision: 'APPROVE', reasonCodes, recommendedActions };
      }

      if (kytStatus === 'REVIEW') {
        reasonCodes.push('TX_KYT_REVIEW');
        recommendedActions.push({
          type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
          payload: {
            severity: riskScore >= 80 ? 'CRITICAL' : 'HIGH',
            recommendation: 'REVIEW',
            reasonCodes,
          },
        });
        return { decision: 'REVIEW', reasonCodes, recommendedActions };
      }

      if (kytStatus === 'FAIL') {
        reasonCodes.push('TX_KYT_FAIL');
        recommendedActions.push({
          type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
          payload: {
            severity: 'CRITICAL',
            recommendation: 'REJECT',
            reasonCodes,
          },
        });
        recommendedActions.push({
          type: RISK_RECOMMENDED_ACTIONS.AUTO_ESCALATE_CASE,
          payload: {
            reasonCodes,
          },
        });
        return { decision: 'REJECT', reasonCodes, recommendedActions };
      }
    }

    if (input.contextType === 'TX_DEPOSIT_TRAVEL_RULE') {
      const travelStatus = String(
        signals.travelRuleStatus || signals.status || '',
      ).toUpperCase();

      if (travelStatus === 'NOT_REQUIRED' || travelStatus === 'ACCEPTED') {
        reasonCodes.push(
          travelStatus === 'NOT_REQUIRED'
            ? 'TX_TRAVEL_RULE_NOT_REQUIRED'
            : 'TX_TRAVEL_RULE_ACCEPTED',
        );
        return { decision: 'APPROVE', reasonCodes, recommendedActions };
      }

      if (travelStatus === 'REJECTED' || travelStatus === 'EXPIRED') {
        reasonCodes.push(
          travelStatus === 'REJECTED'
            ? 'TX_TRAVEL_RULE_REJECTED'
            : 'TX_TRAVEL_RULE_EXPIRED',
        );
        recommendedActions.push({
          type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
          payload: {
            severity: 'CRITICAL',
            recommendation: 'REJECT',
            reasonCodes,
          },
        });
        recommendedActions.push({
          type: RISK_RECOMMENDED_ACTIONS.AUTO_ESCALATE_CASE,
          payload: {
            reasonCodes,
          },
        });
        return { decision: 'REJECT', reasonCodes, recommendedActions };
      }

      if (travelStatus) {
        reasonCodes.push(`TX_TRAVEL_RULE_${travelStatus}`);
        return { decision: 'REVIEW', reasonCodes, recommendedActions };
      }
    }

    if (input.contextType === 'TX_DEPOSIT_FINAL') {
      const kytStatus = String(signals.kytStatus || '').toUpperCase();
      const travelStatus = String(signals.travelRuleStatus || '').toUpperCase();
      const riskBand =
        canonicalTransactionRiskBand === 'HIGH'
          ? 'HIGH'
          : canonicalTransactionRiskBand === 'MEDIUM'
            ? 'MEDIUM'
            : 'LOW';

      if (simulationMode === 'MANUAL') {
        if (riskBand === 'HIGH') {
          reasonCodes.push(canonicalTransactionRiskReason || 'SANCTIONS_HIT');
          recommendedActions.push({
            type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
            payload: {
              severity: 'CRITICAL',
              recommendation: 'REVIEW',
              reasonCodes,
              riskBand,
              riskReason: canonicalTransactionRiskReason || null,
            },
          });
          recommendedActions.push({
            type: RISK_RECOMMENDED_ACTIONS.AUTO_ESCALATE_CASE,
            payload: {
              reasonCodes,
              riskBand,
              riskReason: canonicalTransactionRiskReason || null,
            },
          });
          return { decision: 'REVIEW', reasonCodes, recommendedActions };
        }

        if (riskBand === 'MEDIUM') {
          reasonCodes.push(
            canonicalTransactionRiskReason || 'LARGE_DEPOSIT_PROFILE_MISMATCH',
          );
          recommendedActions.push({
            type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
            payload: {
              severity: 'HIGH',
              recommendation: 'REVIEW',
              reasonCodes,
              riskBand,
              riskReason: canonicalTransactionRiskReason || null,
            },
          });
          return { decision: 'REVIEW', reasonCodes, recommendedActions };
        }

        reasonCodes.push('TX_DEPOSIT_LOW_RISK_AUTO_CLEAR');
        return { decision: 'APPROVE', reasonCodes, recommendedActions };
      }

      if (canonicalTransactionRiskReason === 'KYT_ISSUE') {
        reasonCodes.push('TX_SIM_KYT_ISSUE');
      } else if (canonicalTransactionRiskReason === 'TRAVEL_RULE_ISSUE') {
        reasonCodes.push('TX_SIM_TRAVEL_RULE_ISSUE');
      } else if (
        canonicalTransactionRiskReason === 'LARGE_DEPOSIT_PROFILE_MISMATCH'
      ) {
        reasonCodes.push('TX_SIM_LARGE_DEPOSIT_PROFILE_MISMATCH');
      } else if (canonicalTransactionRiskReason === 'SANCTIONS_HIT') {
        reasonCodes.push('SANCTIONS_HIT');
        reasonCodes.push('TX_SIM_SANCTIONS_HIT');
      }

      if (kytStatus === 'FAIL') {
        reasonCodes.push('TX_KYT_FAIL');
      } else if (kytStatus === 'REVIEW') {
        reasonCodes.push('TX_KYT_REVIEW');
      } else if (kytStatus === 'PASS') {
        reasonCodes.push('TX_KYT_PASS');
      }

      if (travelStatus === 'REJECTED') {
        reasonCodes.push('TX_TRAVEL_RULE_REJECTED');
      } else if (travelStatus === 'EXPIRED') {
        reasonCodes.push('TX_TRAVEL_RULE_EXPIRED');
      } else if (travelStatus === 'ACCEPTED') {
        reasonCodes.push('TX_TRAVEL_RULE_ACCEPTED');
      } else if (travelStatus === 'NOT_REQUIRED') {
        reasonCodes.push('TX_TRAVEL_RULE_NOT_REQUIRED');
      }

      if (riskBand === 'HIGH') {
        recommendedActions.push({
          type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
          payload: {
            severity: 'CRITICAL',
            recommendation: 'REVIEW',
            reasonCodes,
            riskBand,
            riskReason: canonicalTransactionRiskReason || null,
          },
        });
        recommendedActions.push({
          type: RISK_RECOMMENDED_ACTIONS.AUTO_ESCALATE_CASE,
          payload: {
            reasonCodes,
            riskBand,
            riskReason: canonicalTransactionRiskReason || null,
          },
        });
        return { decision: 'REVIEW', reasonCodes, recommendedActions };
      }

      if (riskBand === 'MEDIUM' || kytStatus === 'REVIEW') {
        recommendedActions.push({
          type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
          payload: {
            severity: 'HIGH',
            recommendation: 'REVIEW',
            reasonCodes,
            riskBand: riskBand === 'LOW' ? 'MEDIUM' : riskBand,
            riskReason: canonicalTransactionRiskReason || null,
          },
        });
        return { decision: 'REVIEW', reasonCodes, recommendedActions };
      }

      if (
        kytStatus === 'PASS' &&
        (travelStatus === 'ACCEPTED' || travelStatus === 'NOT_REQUIRED')
      ) {
        return { decision: 'APPROVE', reasonCodes, recommendedActions };
      }
    }

    if (input.contextType === 'TX_SWAP_FINAL') {
      const customerAmlRiskTier = String(
        signals.customerAmlRiskTier || '',
      ).toUpperCase();
      const riskBand =
        simulationMode === 'MANUAL'
          ? canonicalTransactionRiskBand === 'HIGH'
            ? 'HIGH'
            : canonicalTransactionRiskBand === 'MEDIUM'
              ? 'MEDIUM'
              : 'LOW'
          : canonicalTransactionRiskBand === 'HIGH' || customerAmlRiskTier === 'HIGH'
            ? 'HIGH'
            : canonicalTransactionRiskBand === 'MEDIUM' ||
                customerAmlRiskTier === 'MEDIUM'
              ? 'MEDIUM'
              : 'LOW';

      if (simulationMode === 'MANUAL') {
        if (riskBand === 'HIGH') {
          reasonCodes.push(canonicalTransactionRiskReason || 'HIGH_RISK_EXPOSURE');
          recommendedActions.push({
            type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
            payload: {
              severity: 'CRITICAL',
              recommendation: 'REVIEW',
              reasonCodes,
              riskBand,
              riskReason: canonicalTransactionRiskReason || null,
            },
          });
          recommendedActions.push({
            type: RISK_RECOMMENDED_ACTIONS.AUTO_ESCALATE_CASE,
            payload: {
              reasonCodes,
              riskBand,
              riskReason: canonicalTransactionRiskReason || null,
            },
          });
          return { decision: 'REVIEW', reasonCodes, recommendedActions };
        }

        if (riskBand === 'MEDIUM') {
          reasonCodes.push(canonicalTransactionRiskReason || 'PROFILE_MISMATCH');
          recommendedActions.push({
            type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
            payload: {
              severity: 'HIGH',
              recommendation: 'REVIEW',
              reasonCodes,
              riskBand,
              riskReason: canonicalTransactionRiskReason || null,
            },
          });
          return { decision: 'REVIEW', reasonCodes, recommendedActions };
        }

        reasonCodes.push('TX_SWAP_LOW_RISK_AUTO_CLEAR');
        return { decision: 'APPROVE', reasonCodes, recommendedActions };
      }

      if (canonicalTransactionRiskReason === 'SANCTIONS_HIT') {
        reasonCodes.push('SANCTIONS_HIT');
      } else if (canonicalTransactionRiskReason) {
        reasonCodes.push(`TX_SWAP_${canonicalTransactionRiskReason}`);
      }

      if (customerAmlRiskTier === 'HIGH') {
        reasonCodes.push('CUSTOMER_AML_RISK_HIGH');
      } else if (customerAmlRiskTier === 'MEDIUM') {
        reasonCodes.push('CUSTOMER_AML_RISK_MEDIUM');
      } else {
        reasonCodes.push('CUSTOMER_AML_RISK_LOW');
      }

      if (riskBand === 'HIGH') {
        recommendedActions.push({
          type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
          payload: {
            severity: 'CRITICAL',
            recommendation: 'REVIEW',
            reasonCodes,
            riskBand,
            riskReason: canonicalTransactionRiskReason || null,
          },
        });
        recommendedActions.push({
          type: RISK_RECOMMENDED_ACTIONS.AUTO_ESCALATE_CASE,
          payload: {
            reasonCodes,
            riskBand,
            riskReason: canonicalTransactionRiskReason || null,
          },
        });
        return { decision: 'REVIEW', reasonCodes, recommendedActions };
      }

      if (riskBand === 'MEDIUM') {
        recommendedActions.push({
          type: RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
          payload: {
            severity: 'HIGH',
            recommendation: 'REVIEW',
            reasonCodes,
            riskBand,
            riskReason: canonicalTransactionRiskReason || null,
          },
        });
        return { decision: 'REVIEW', reasonCodes, recommendedActions };
      }

      reasonCodes.push('TX_SWAP_LOW_RISK_AUTO_CLEAR');
      return { decision: 'APPROVE', reasonCodes, recommendedActions };
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

  private buildOutputs(
    input: EvaluateRiskInput,
    evaluated: Omit<EvaluateRiskOutput, 'decisionRecordId' | 'policyVersion'>,
  ) {
    const signals = input.signals || {};
    const normalizedSimulationMode = String(
      signals.simulationMode || '',
    ).trim().toUpperCase();
    const normalizedSimulationRiskBand = String(
      signals.simulationRiskLevel || signals.riskLevel || '',
    )
      .trim()
      .toUpperCase();
    const normalizedSimulationRiskReason = String(
      signals.simulationRiskReason || '',
    )
      .trim()
      .toUpperCase();
    const normalizedTransactionRiskBand = String(
      signals.riskBand || signals.simulationRiskLevel || signals.riskLevel || '',
    )
      .trim()
      .toUpperCase();
    const normalizedTransactionRiskReason = String(
      signals.riskReason || signals.simulationRiskReason || '',
    )
      .trim()
      .toUpperCase();

    const outputs: Record<string, unknown> = {
      decision: evaluated.decision,
      reasonCodes: evaluated.reasonCodes,
      recommendedActions: evaluated.recommendedActions,
    };

    if (input.contextType === 'ONBOARDING_CDD') {
      outputs.riskBand = normalizedSimulationRiskBand || null;
      outputs.riskReason = normalizedSimulationRiskReason || null;
      outputs.simulationMode = normalizedSimulationMode || null;
    }

    if (
      input.contextType === 'TX_DEPOSIT_FINAL' ||
      input.contextType === 'TX_SWAP_FINAL'
    ) {
      outputs.riskBand = normalizedTransactionRiskBand || null;
      outputs.riskReason = normalizedTransactionRiskReason || null;
      outputs.simulationMode = normalizedSimulationMode || null;
    }

    return outputs;
  }

  async createPendingDecisionRecord(
    input: EvaluateRiskInput,
    tx?: Prisma.TransactionClient,
  ): Promise<PendingRiskDecisionRecordOutput> {
    if (input.ownerType !== 'CUSTOMER') {
      throw new BadRequestException(RiskEngineService.PHASE2_UNSUPPORTED_OWNER_TYPE);
    }

    const policyVersion = this.resolvePolicyVersion(input);
    const maskedInput = this.buildStoredInputPayload(input);
    const inputHash = this.buildInputHash(input);
    const created = await (this.getDb(tx) as any).workflowDecisionRecord.create({
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

    return {
      decisionRecordId: created.id,
      policyVersion,
      inputHash,
    };
  }

  async completeDecisionRecord(
    decisionRecordId: string,
    input: EvaluateRiskInput,
    tx?: Prisma.TransactionClient,
  ): Promise<EvaluateRiskOutput> {
    if (input.ownerType !== 'CUSTOMER') {
      throw new BadRequestException(RiskEngineService.PHASE2_UNSUPPORTED_OWNER_TYPE);
    }

    const db = this.getDb(tx) as any;
    const current = await db.workflowDecisionRecord.findUnique({
      where: { id: decisionRecordId },
      select: {
        id: true,
        policyVersion: true,
        status: true,
      },
    });

    if (!current) {
      throw new NotFoundException(`Risk decision record not found: ${decisionRecordId}`);
    }
    if (String(current.status || '').trim().toUpperCase() !== 'CREATED') {
      throw new BadRequestException(
        `Risk decision record ${decisionRecordId} is not pending simulation`,
      );
    }

    try {
      const evaluated = this.evaluateBySignals(input);
      const maskedInput = this.buildStoredInputPayload(input);
      const inputHash = this.buildInputHash(input);
      const outputs = this.buildOutputs(input, evaluated);

      await db.workflowDecisionRecord.update({
        where: { id: decisionRecordId },
        data: {
          customerId: input.ownerId,
          contextType: input.contextType,
          subjectId: input.subjectId,
          status: 'COMPLETED',
          inputPayload: JSON.stringify(maskedInput),
          inputHash,
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
        policyVersion: current.policyVersion || this.resolvePolicyVersion(input),
        decisionRecordId,
      };
    } catch (error) {
      await db.workflowDecisionRecord.update({
        where: { id: decisionRecordId },
        data: {
          status: 'FAILED',
          outputDecision: null,
          recommendedActions: null,
          outputs: null,
          reasonCodes: null,
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

  async evaluate(
    input: EvaluateRiskInput,
    tx?: Prisma.TransactionClient,
  ): Promise<EvaluateRiskOutput> {
    const pending = await this.createPendingDecisionRecord(input, tx);
    return this.completeDecisionRecord(pending.decisionRecordId, input, tx);
  }
}
