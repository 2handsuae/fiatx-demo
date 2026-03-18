export const ONBOARDING_WORKFLOW = 'ONBOARDING' as const;
export const ONBOARDING_SOURCE_TYPE = 'ONBOARDING_JOURNEY' as const;

export const ONBOARDING_REVIEW_STAGES = {
  REVIEW_CDD: 'REVIEW_CDD',
  REVIEW_EDD: 'REVIEW_EDD',
} as const;

export type OnboardingReviewStage =
  (typeof ONBOARDING_REVIEW_STAGES)[keyof typeof ONBOARDING_REVIEW_STAGES];

export const ONBOARDING_REVIEW_RULES = {
  ONB_CDD_REVIEW_REQUIRED: 'ONB_CDD_REVIEW_REQUIRED',
  ONB_EDD_REVIEW_REQUIRED: 'ONB_EDD_REVIEW_REQUIRED',
} as const;

export type OnboardingReviewRule =
  (typeof ONBOARDING_REVIEW_RULES)[keyof typeof ONBOARDING_REVIEW_RULES];

export const LEGACY_ONBOARDING_REVIEW_RULE =
  'ONB_ONBOARDING_JOURNEY_REVIEW' as const;

export const ONBOARDING_REVIEW_STAGE_TO_RULE: Record<
  OnboardingReviewStage,
  OnboardingReviewRule
> = {
  [ONBOARDING_REVIEW_STAGES.REVIEW_CDD]:
    ONBOARDING_REVIEW_RULES.ONB_CDD_REVIEW_REQUIRED,
  [ONBOARDING_REVIEW_STAGES.REVIEW_EDD]:
    ONBOARDING_REVIEW_RULES.ONB_EDD_REVIEW_REQUIRED,
};

export const ONBOARDING_REVIEW_RULE_TO_STAGE: Record<
  OnboardingReviewRule,
  OnboardingReviewStage
> = {
  [ONBOARDING_REVIEW_RULES.ONB_CDD_REVIEW_REQUIRED]:
    ONBOARDING_REVIEW_STAGES.REVIEW_CDD,
  [ONBOARDING_REVIEW_RULES.ONB_EDD_REVIEW_REQUIRED]:
    ONBOARDING_REVIEW_STAGES.REVIEW_EDD,
};

const ONBOARDING_STAGE_SET = new Set<string>(
  Object.values(ONBOARDING_REVIEW_STAGES),
);
const ONBOARDING_RULE_SET = new Set<string>(Object.values(ONBOARDING_REVIEW_RULES));

export const ALERT_WORK_ITEM_ACTIONS = {
  ASSIGN: 'ASSIGN',
  REASSIGN: 'REASSIGN',
  CLOSE: 'CLOSE',
} as const;

export type AlertWorkItemAction =
  (typeof ALERT_WORK_ITEM_ACTIONS)[keyof typeof ALERT_WORK_ITEM_ACTIONS];

export const ALERT_COMPLIANCE_ACTIONS = {
  ESCALATE_TO_CASE: 'ESCALATE_TO_CASE',
  APPROVE_STAGE: 'APPROVE_STAGE',
  REJECT_STAGE: 'REJECT_STAGE',
  REQUIRE_EDD: 'REQUIRE_EDD',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
  NO_ACTION: 'NO_ACTION',
} as const;

export type AlertComplianceAction =
  (typeof ALERT_COMPLIANCE_ACTIONS)[keyof typeof ALERT_COMPLIANCE_ACTIONS];

export const CASE_WORK_ITEM_ACTIONS = {
  ASSIGN: 'ASSIGN',
  REASSIGN: 'REASSIGN',
  LINK_ALERT: 'LINK_ALERT',
  CLOSE: 'CLOSE',
} as const;

export type CaseWorkItemAction =
  (typeof CASE_WORK_ITEM_ACTIONS)[keyof typeof CASE_WORK_ITEM_ACTIONS];

export const CASE_COMPLIANCE_ACTIONS = {
  APPROVE_STAGE: 'APPROVE_STAGE',
  REJECT_STAGE: 'REJECT_STAGE',
  REQUIRE_EDD: 'REQUIRE_EDD',
  FREEZE: 'FREEZE',
  UNFREEZE: 'UNFREEZE',
  REPORT: 'REPORT',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
} as const;

export type CaseComplianceAction =
  (typeof CASE_COMPLIANCE_ACTIONS)[keyof typeof CASE_COMPLIANCE_ACTIONS];

export const ALERT_COMPLIANCE_ACTIONS_BY_STAGE: Record<
  OnboardingReviewStage,
  AlertComplianceAction[]
> = {
  [ONBOARDING_REVIEW_STAGES.REVIEW_CDD]: [
    ALERT_COMPLIANCE_ACTIONS.APPROVE_STAGE,
    ALERT_COMPLIANCE_ACTIONS.REJECT_STAGE,
    ALERT_COMPLIANCE_ACTIONS.REQUIRE_EDD,
    ALERT_COMPLIANCE_ACTIONS.ESCALATE_TO_CASE,
    ALERT_COMPLIANCE_ACTIONS.FALSE_POSITIVE,
    ALERT_COMPLIANCE_ACTIONS.NO_ACTION,
  ],
  [ONBOARDING_REVIEW_STAGES.REVIEW_EDD]: [
    ALERT_COMPLIANCE_ACTIONS.APPROVE_STAGE,
    ALERT_COMPLIANCE_ACTIONS.REJECT_STAGE,
    ALERT_COMPLIANCE_ACTIONS.ESCALATE_TO_CASE,
    ALERT_COMPLIANCE_ACTIONS.FALSE_POSITIVE,
    ALERT_COMPLIANCE_ACTIONS.NO_ACTION,
  ],
};

export const CASE_COMPLIANCE_ACTIONS_BY_STAGE: Record<
  OnboardingReviewStage,
  CaseComplianceAction[]
> = {
  [ONBOARDING_REVIEW_STAGES.REVIEW_CDD]: [
    CASE_COMPLIANCE_ACTIONS.APPROVE_STAGE,
    CASE_COMPLIANCE_ACTIONS.REJECT_STAGE,
    CASE_COMPLIANCE_ACTIONS.REQUIRE_EDD,
    CASE_COMPLIANCE_ACTIONS.FREEZE,
    CASE_COMPLIANCE_ACTIONS.UNFREEZE,
    CASE_COMPLIANCE_ACTIONS.REPORT,
    CASE_COMPLIANCE_ACTIONS.FALSE_POSITIVE,
  ],
  [ONBOARDING_REVIEW_STAGES.REVIEW_EDD]: [
    CASE_COMPLIANCE_ACTIONS.APPROVE_STAGE,
    CASE_COMPLIANCE_ACTIONS.REJECT_STAGE,
    CASE_COMPLIANCE_ACTIONS.FREEZE,
    CASE_COMPLIANCE_ACTIONS.UNFREEZE,
    CASE_COMPLIANCE_ACTIONS.REPORT,
    CASE_COMPLIANCE_ACTIONS.FALSE_POSITIVE,
  ],
};

export function isOnboardingSourceType(value: unknown): boolean {
  return (
    String(value || '').trim().toUpperCase() ===
    ONBOARDING_SOURCE_TYPE.toUpperCase()
  );
}

export function normalizeOnboardingReviewStage(
  value: unknown,
): OnboardingReviewStage | null {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;
  if (!ONBOARDING_STAGE_SET.has(normalized)) return null;
  return normalized as OnboardingReviewStage;
}

export function getCanonicalOnboardingRuleForStage(
  stage: unknown,
): OnboardingReviewRule | null {
  const normalizedStage = normalizeOnboardingReviewStage(stage);
  if (!normalizedStage) return null;
  return ONBOARDING_REVIEW_STAGE_TO_RULE[normalizedStage];
}

export function normalizeOnboardingRuleCode(
  ruleCode: unknown,
  stage?: unknown,
): OnboardingReviewRule | null {
  const normalizedRule = String(ruleCode || '').trim().toUpperCase();
  const normalizedStage = normalizeOnboardingReviewStage(stage);

  if (normalizedStage) {
    const canonicalForStage = ONBOARDING_REVIEW_STAGE_TO_RULE[normalizedStage];
    if (!normalizedRule || normalizedRule === LEGACY_ONBOARDING_REVIEW_RULE) {
      return canonicalForStage;
    }
    if (normalizedRule === canonicalForStage) {
      return canonicalForStage;
    }
    return null;
  }

  if (!normalizedRule) return null;
  if (ONBOARDING_RULE_SET.has(normalizedRule)) {
    return normalizedRule as OnboardingReviewRule;
  }
  return null;
}

export function getOnboardingRuleDisplayLabel(ruleCode: unknown): string {
  const normalized = String(ruleCode || '').trim().toUpperCase();
  if (!normalized) return '-';
  if (normalized === LEGACY_ONBOARDING_REVIEW_RULE) {
    return ONBOARDING_REVIEW_RULES.ONB_CDD_REVIEW_REQUIRED;
  }
  return normalized;
}
