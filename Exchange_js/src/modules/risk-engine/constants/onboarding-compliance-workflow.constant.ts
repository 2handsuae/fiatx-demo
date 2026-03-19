export const ONBOARDING_WORKFLOW = 'ONBOARDING' as const;
export const PERIODIC_REVIEW_WORKFLOW = 'PERIODIC_REVIEW' as const;

export const ONBOARDING_SOURCE_TYPE = 'ONBOARDING_JOURNEY' as const;
export const PERIODIC_REVIEW_SOURCE_TYPE = 'PERIODIC_REVIEW_CYCLE' as const;

export type ComplianceWorkflow =
  | typeof ONBOARDING_WORKFLOW
  | typeof PERIODIC_REVIEW_WORKFLOW;
export type ComplianceSourceType =
  | typeof ONBOARDING_SOURCE_TYPE
  | typeof PERIODIC_REVIEW_SOURCE_TYPE;

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

export const PERIODIC_REVIEW_RULES = {
  PRR_CDD_REVIEW_REQUIRED: 'PRR_CDD_REVIEW_REQUIRED',
  PRR_EDD_REVIEW_REQUIRED: 'PRR_EDD_REVIEW_REQUIRED',
} as const;

export type PeriodicReviewRule =
  (typeof PERIODIC_REVIEW_RULES)[keyof typeof PERIODIC_REVIEW_RULES];

export type ComplianceReviewStage = OnboardingReviewStage;
export type ComplianceReviewRule = OnboardingReviewRule | PeriodicReviewRule;

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

export const PERIODIC_REVIEW_STAGE_TO_RULE: Record<
  ComplianceReviewStage,
  PeriodicReviewRule
> = {
  [ONBOARDING_REVIEW_STAGES.REVIEW_CDD]:
    PERIODIC_REVIEW_RULES.PRR_CDD_REVIEW_REQUIRED,
  [ONBOARDING_REVIEW_STAGES.REVIEW_EDD]:
    PERIODIC_REVIEW_RULES.PRR_EDD_REVIEW_REQUIRED,
};

export const PERIODIC_REVIEW_RULE_TO_STAGE: Record<
  PeriodicReviewRule,
  ComplianceReviewStage
> = {
  [PERIODIC_REVIEW_RULES.PRR_CDD_REVIEW_REQUIRED]:
    ONBOARDING_REVIEW_STAGES.REVIEW_CDD,
  [PERIODIC_REVIEW_RULES.PRR_EDD_REVIEW_REQUIRED]:
    ONBOARDING_REVIEW_STAGES.REVIEW_EDD,
};

const ONBOARDING_STAGE_SET = new Set<string>(
  Object.values(ONBOARDING_REVIEW_STAGES),
);
const ONBOARDING_RULE_SET = new Set<string>(Object.values(ONBOARDING_REVIEW_RULES));
const PERIODIC_REVIEW_RULE_SET = new Set<string>(
  Object.values(PERIODIC_REVIEW_RULES),
);

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
  RESTRICT: 'RESTRICT',
  UNRESTRICT: 'UNRESTRICT',
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

export function normalizeComplianceWorkflow(
  value: unknown,
): ComplianceWorkflow | null {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === ONBOARDING_WORKFLOW) return ONBOARDING_WORKFLOW;
  if (normalized === PERIODIC_REVIEW_WORKFLOW) return PERIODIC_REVIEW_WORKFLOW;
  return null;
}

export function isOnboardingSourceType(value: unknown): boolean {
  return (
    String(value || '').trim().toUpperCase() ===
    ONBOARDING_SOURCE_TYPE.toUpperCase()
  );
}

export function isPeriodicReviewSourceType(value: unknown): boolean {
  return (
    String(value || '').trim().toUpperCase() ===
    PERIODIC_REVIEW_SOURCE_TYPE.toUpperCase()
  );
}

export function isSupportedReviewSourceType(value: unknown): boolean {
  return isOnboardingSourceType(value) || isPeriodicReviewSourceType(value);
}

export function getWorkflowFromSourceType(
  value: unknown,
): ComplianceWorkflow | null {
  if (isOnboardingSourceType(value)) return ONBOARDING_WORKFLOW;
  if (isPeriodicReviewSourceType(value)) return PERIODIC_REVIEW_WORKFLOW;
  return null;
}

export function normalizeOnboardingReviewStage(
  value: unknown,
): OnboardingReviewStage | null {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;
  if (!ONBOARDING_STAGE_SET.has(normalized)) return null;
  return normalized as OnboardingReviewStage;
}

export function normalizeComplianceReviewStage(
  value: unknown,
): ComplianceReviewStage | null {
  return normalizeOnboardingReviewStage(value);
}

export function getCanonicalOnboardingRuleForStage(
  stage: unknown,
): OnboardingReviewRule | null {
  const normalizedStage = normalizeOnboardingReviewStage(stage);
  if (!normalizedStage) return null;
  return ONBOARDING_REVIEW_STAGE_TO_RULE[normalizedStage];
}

export function getCanonicalReviewRuleForStage(
  stage: unknown,
  workflow: unknown,
): ComplianceReviewRule | null {
  const normalizedStage = normalizeComplianceReviewStage(stage);
  const normalizedWorkflow = normalizeComplianceWorkflow(workflow);
  if (!normalizedStage || !normalizedWorkflow) return null;

  if (normalizedWorkflow === PERIODIC_REVIEW_WORKFLOW) {
    return PERIODIC_REVIEW_STAGE_TO_RULE[normalizedStage];
  }

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

export function normalizePeriodicReviewRuleCode(
  ruleCode: unknown,
  stage?: unknown,
): PeriodicReviewRule | null {
  const normalizedRule = String(ruleCode || '').trim().toUpperCase();
  const normalizedStage = normalizeComplianceReviewStage(stage);

  if (normalizedStage) {
    const canonicalForStage = PERIODIC_REVIEW_STAGE_TO_RULE[normalizedStage];
    if (!normalizedRule) {
      return canonicalForStage;
    }
    if (normalizedRule === canonicalForStage) {
      return canonicalForStage;
    }
    return null;
  }

  if (!normalizedRule) return null;
  if (PERIODIC_REVIEW_RULE_SET.has(normalizedRule)) {
    return normalizedRule as PeriodicReviewRule;
  }
  return null;
}

export function normalizeComplianceRuleCode(
  ruleCode: unknown,
  stage?: unknown,
  workflowOrSourceType?: unknown,
): ComplianceReviewRule | null {
  const workflow =
    normalizeComplianceWorkflow(workflowOrSourceType) ||
    getWorkflowFromSourceType(workflowOrSourceType) ||
    null;

  if (workflow === PERIODIC_REVIEW_WORKFLOW) {
    return normalizePeriodicReviewRuleCode(ruleCode, stage);
  }

  if (workflow === ONBOARDING_WORKFLOW) {
    return normalizeOnboardingRuleCode(ruleCode, stage);
  }

  return (
    normalizeOnboardingRuleCode(ruleCode, stage) ||
    normalizePeriodicReviewRuleCode(ruleCode, stage)
  );
}

export function getOnboardingRuleDisplayLabel(ruleCode: unknown): string {
  const normalized = String(ruleCode || '').trim().toUpperCase();
  if (!normalized) return '-';
  if (normalized === LEGACY_ONBOARDING_REVIEW_RULE) {
    return ONBOARDING_REVIEW_RULES.ONB_CDD_REVIEW_REQUIRED;
  }
  return normalized;
}

export function getComplianceRuleDisplayLabel(ruleCode: unknown): string {
  const normalized = String(ruleCode || '').trim().toUpperCase();
  if (!normalized) return '-';
  if (normalized === LEGACY_ONBOARDING_REVIEW_RULE) {
    return ONBOARDING_REVIEW_RULES.ONB_CDD_REVIEW_REQUIRED;
  }
  return normalized;
}
