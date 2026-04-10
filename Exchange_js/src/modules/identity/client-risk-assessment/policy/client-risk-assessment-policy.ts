import { ClientRiskAssessmentPolicy } from './policy-loader';

export interface PolicyInput {
  amlAnswer: 'GREEN' | 'RED';
  amlLabels: string[];
  holdings: Array<{
    materialType: string;
    status: string;
    expiresAt: Date | null;
  }>;
  previousTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  previousPepStatus: 'NONE' | 'CONFIRMED' | 'CLEARED';
}

export interface PolicyOutput {
  resultingTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  scoreSuggestedTier?: string;
  recommendedAction: string;
  signoffMethod: string;
  immediateEffect?: string;
  matchedRule: number;
  reasoning: {
    ruleId: string;
    amlAnswer: string;
    amlLabels: string[];
    previousTier: string;
    downgradeBlocked?: boolean;
  };
}

export function applyPolicy(
  input: PolicyInput,
  policy: ClientRiskAssessmentPolicy,
): PolicyOutput {
  const sorted = [...policy.tierMappingRules].sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    if (!matchesCondition(rule.condition, input)) continue;

    let resultingTier = rule.tier as PolicyOutput['resultingTier'];
    let scoreSuggestedTier: string | undefined;
    let downgradeBlocked = false;

    if (rule.tier === 'KEEP_PREVIOUS') {
      resultingTier = input.previousTier;
    }

    if (
      policy.downgradeForbidden &&
      input.previousTier === 'HIGH' &&
      resultingTier !== 'HIGH' &&
      resultingTier !== 'UNKNOWN'
    ) {
      scoreSuggestedTier = resultingTier;
      resultingTier = 'HIGH';
      downgradeBlocked = true;
    }

    let signoffMethod = rule.signoffMethod;
    if (downgradeBlocked && signoffMethod === 'AUTO_R2') {
      signoffMethod = 'MANUAL_MLRO';
    }

    return {
      resultingTier,
      scoreSuggestedTier,
      recommendedAction: rule.action,
      signoffMethod,
      immediateEffect: rule.immediateEffect,
      matchedRule: rule.priority,
      reasoning: {
        ruleId: `P${rule.priority}_${rule.condition}`,
        amlAnswer: input.amlAnswer,
        amlLabels: input.amlLabels,
        previousTier: input.previousTier,
        ...(downgradeBlocked && { downgradeBlocked: true }),
      },
    };
  }

  throw new Error('No policy rule matched — this should be impossible with priority 6 fallback');
}

function matchesCondition(condition: string, input: PolicyInput): boolean {
  switch (condition) {
    case 'labels_contains_SANCTIONS':
      return input.amlLabels.some((l) => l.startsWith('SANCTIONS_'));
    case 'labels_contains_PEP':
      return input.amlLabels.some((l) => l.startsWith('PEP_'));
    case 'labels_contains_ADVERSE_MEDIA':
      return input.amlLabels.some((l) => l.startsWith('ADVERSE_MEDIA'));
    case 'red_other':
      return input.amlAnswer === 'RED';
    case 'any_required_material_stale':
      return input.holdings.some(
        (h) => h.status === 'EXPIRED' || h.status === 'MISSING',
      );
    case 'green_stable':
      return input.amlAnswer === 'GREEN';
    default:
      return false;
  }
}
