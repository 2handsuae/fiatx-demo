export const ONBOARDING_WORKFLOW = 'ONBOARDING' as const;
export const PERIODIC_REVIEW_WORKFLOW = 'PERIODIC_REVIEW' as const;
export const TRANSACTION_WORKFLOW = 'TRANSACTION' as const;

export const ONBOARDING_SOURCE_TYPE = 'ONBOARDING_JOURNEY' as const;
export const PERIODIC_REVIEW_SOURCE_TYPE = 'PERIODIC_REVIEW_CYCLE' as const;
export const TRANSACTION_DEPOSIT_SOURCE_TYPE = 'DEPOSIT' as const;
export const TRANSACTION_WITHDRAW_SOURCE_TYPE = 'WITHDRAW' as const;
export const TRANSACTION_SWAP_SOURCE_TYPE = 'SWAP' as const;
export const TRANSACTION_SAFEGUARDING_SOURCE_TYPE =
  'SAFEGUARDING_ASSET' as const;

export type ComplianceWorkflow =
  | typeof ONBOARDING_WORKFLOW
  | typeof PERIODIC_REVIEW_WORKFLOW
  | typeof TRANSACTION_WORKFLOW;
export type ComplianceSourceType =
  | typeof ONBOARDING_SOURCE_TYPE
  | typeof PERIODIC_REVIEW_SOURCE_TYPE
  | typeof TRANSACTION_DEPOSIT_SOURCE_TYPE
  | typeof TRANSACTION_WITHDRAW_SOURCE_TYPE
  | typeof TRANSACTION_SWAP_SOURCE_TYPE
  | typeof TRANSACTION_SAFEGUARDING_SOURCE_TYPE;

export interface ComplianceWorkflowTraceContext {
  traceId: string;
  workflowType: ComplianceWorkflow;
  workflowId: string;
  workflowNo: string;
}

export const ONBOARDING_REVIEW_STAGES = {
  REVIEW_CDD: 'REVIEW_CDD',
  REVIEW_EDD: 'REVIEW_EDD',
} as const;

export type OnboardingReviewStage =
  (typeof ONBOARDING_REVIEW_STAGES)[keyof typeof ONBOARDING_REVIEW_STAGES];

export const TRANSACTION_REVIEW_STAGES = {
  REVIEW_KYT: 'REVIEW_KYT',
  REVIEW_TRAVEL_RULE: 'REVIEW_TRAVEL_RULE',
  REVIEW_DEPOSIT_FINAL: 'REVIEW_DEPOSIT_FINAL',
  REVIEW_WITHDRAW_PRECHECK: 'REVIEW_WITHDRAW_PRECHECK',
  REVIEW_WITHDRAW_FINAL: 'REVIEW_WITHDRAW_FINAL',
  REVIEW_WITHDRAW_RECONCILIATION: 'REVIEW_WITHDRAW_RECONCILIATION',
  REVIEW_SAFEGUARDING_RECONCILIATION: 'REVIEW_SAFEGUARDING_RECONCILIATION',
  REVIEW_SWAP_FINAL: 'REVIEW_SWAP_FINAL',
} as const;

export type TransactionReviewStage =
  (typeof TRANSACTION_REVIEW_STAGES)[keyof typeof TRANSACTION_REVIEW_STAGES];

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

export const TRANSACTION_REVIEW_RULES = {
  TX_KYT_REVIEW_REQUIRED: 'TX_KYT_REVIEW_REQUIRED',
  TX_TRAVEL_RULE_REVIEW_REQUIRED: 'TX_TRAVEL_RULE_REVIEW_REQUIRED',
  TX_DEPOSIT_FINAL_REVIEW_REQUIRED: 'TX_DEPOSIT_FINAL_REVIEW_REQUIRED',
  TX_WITHDRAW_PRECHECK_REVIEW_REQUIRED:
    'TX_WITHDRAW_PRECHECK_REVIEW_REQUIRED',
  TX_WITHDRAW_FINAL_REVIEW_REQUIRED: 'TX_WITHDRAW_FINAL_REVIEW_REQUIRED',
  TX_RECONCILIATION_BREAK_DETECTED: 'TX_RECONCILIATION_BREAK_DETECTED',
  TX_SAFEGUARDING_BREAK_DETECTED: 'TX_SAFEGUARDING_BREAK_DETECTED',
  TX_SWAP_FINAL_REVIEW_REQUIRED: 'TX_SWAP_FINAL_REVIEW_REQUIRED',
} as const;

export type TransactionReviewRule =
  (typeof TRANSACTION_REVIEW_RULES)[keyof typeof TRANSACTION_REVIEW_RULES];

export type ComplianceReviewStage =
  | OnboardingReviewStage
  | TransactionReviewStage;
export type ComplianceReviewRule =
  | OnboardingReviewRule
  | PeriodicReviewRule
  | TransactionReviewRule;

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
  OnboardingReviewStage,
  PeriodicReviewRule
> = {
  [ONBOARDING_REVIEW_STAGES.REVIEW_CDD]:
    PERIODIC_REVIEW_RULES.PRR_CDD_REVIEW_REQUIRED,
  [ONBOARDING_REVIEW_STAGES.REVIEW_EDD]:
    PERIODIC_REVIEW_RULES.PRR_EDD_REVIEW_REQUIRED,
};

export const PERIODIC_REVIEW_RULE_TO_STAGE: Record<
  PeriodicReviewRule,
  OnboardingReviewStage
> = {
  [PERIODIC_REVIEW_RULES.PRR_CDD_REVIEW_REQUIRED]:
    ONBOARDING_REVIEW_STAGES.REVIEW_CDD,
  [PERIODIC_REVIEW_RULES.PRR_EDD_REVIEW_REQUIRED]:
    ONBOARDING_REVIEW_STAGES.REVIEW_EDD,
};

export const TRANSACTION_REVIEW_STAGE_TO_RULE: Record<
  TransactionReviewStage,
  TransactionReviewRule
> = {
  [TRANSACTION_REVIEW_STAGES.REVIEW_KYT]:
    TRANSACTION_REVIEW_RULES.TX_KYT_REVIEW_REQUIRED,
  [TRANSACTION_REVIEW_STAGES.REVIEW_TRAVEL_RULE]:
    TRANSACTION_REVIEW_RULES.TX_TRAVEL_RULE_REVIEW_REQUIRED,
  [TRANSACTION_REVIEW_STAGES.REVIEW_DEPOSIT_FINAL]:
    TRANSACTION_REVIEW_RULES.TX_DEPOSIT_FINAL_REVIEW_REQUIRED,
  [TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_PRECHECK]:
    TRANSACTION_REVIEW_RULES.TX_WITHDRAW_PRECHECK_REVIEW_REQUIRED,
  [TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_FINAL]:
    TRANSACTION_REVIEW_RULES.TX_WITHDRAW_FINAL_REVIEW_REQUIRED,
  [TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_RECONCILIATION]:
    TRANSACTION_REVIEW_RULES.TX_RECONCILIATION_BREAK_DETECTED,
  [TRANSACTION_REVIEW_STAGES.REVIEW_SAFEGUARDING_RECONCILIATION]:
    TRANSACTION_REVIEW_RULES.TX_SAFEGUARDING_BREAK_DETECTED,
  [TRANSACTION_REVIEW_STAGES.REVIEW_SWAP_FINAL]:
    TRANSACTION_REVIEW_RULES.TX_SWAP_FINAL_REVIEW_REQUIRED,
};

export const TRANSACTION_REVIEW_RULE_TO_STAGE: Record<
  TransactionReviewRule,
  TransactionReviewStage
> = {
  [TRANSACTION_REVIEW_RULES.TX_KYT_REVIEW_REQUIRED]:
    TRANSACTION_REVIEW_STAGES.REVIEW_KYT,
  [TRANSACTION_REVIEW_RULES.TX_TRAVEL_RULE_REVIEW_REQUIRED]:
    TRANSACTION_REVIEW_STAGES.REVIEW_TRAVEL_RULE,
  [TRANSACTION_REVIEW_RULES.TX_DEPOSIT_FINAL_REVIEW_REQUIRED]:
    TRANSACTION_REVIEW_STAGES.REVIEW_DEPOSIT_FINAL,
  [TRANSACTION_REVIEW_RULES.TX_WITHDRAW_PRECHECK_REVIEW_REQUIRED]:
    TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_PRECHECK,
  [TRANSACTION_REVIEW_RULES.TX_WITHDRAW_FINAL_REVIEW_REQUIRED]:
    TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_FINAL,
  [TRANSACTION_REVIEW_RULES.TX_RECONCILIATION_BREAK_DETECTED]:
    TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_RECONCILIATION,
  [TRANSACTION_REVIEW_RULES.TX_SAFEGUARDING_BREAK_DETECTED]:
    TRANSACTION_REVIEW_STAGES.REVIEW_SAFEGUARDING_RECONCILIATION,
  [TRANSACTION_REVIEW_RULES.TX_SWAP_FINAL_REVIEW_REQUIRED]:
    TRANSACTION_REVIEW_STAGES.REVIEW_SWAP_FINAL,
};

const ONBOARDING_STAGE_SET = new Set<string>(
  Object.values(ONBOARDING_REVIEW_STAGES),
);
const TRANSACTION_STAGE_SET = new Set<string>(
  Object.values(TRANSACTION_REVIEW_STAGES),
);
const LEGACY_READ_ONLY_REVIEW_STAGE_SET = new Set<string>([
  TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_PRECHECK,
]);
const NON_WORKFLOW_BOUND_STAGE_SET = new Set<string>([
  TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_RECONCILIATION,
  TRANSACTION_REVIEW_STAGES.REVIEW_SAFEGUARDING_RECONCILIATION,
]);
const ONBOARDING_RULE_SET = new Set<string>(Object.values(ONBOARDING_REVIEW_RULES));
const PERIODIC_REVIEW_RULE_SET = new Set<string>(
  Object.values(PERIODIC_REVIEW_RULES),
);
const TRANSACTION_RULE_SET = new Set<string>(
  Object.values(TRANSACTION_REVIEW_RULES),
);

export const ALERT_WORK_ITEM_ACTIONS = {
  ASSIGN: 'ASSIGN',
  REASSIGN: 'REASSIGN',
  CLOSE: 'CLOSE',
} as const;

export type AlertWorkItemAction =
  (typeof ALERT_WORK_ITEM_ACTIONS)[keyof typeof ALERT_WORK_ITEM_ACTIONS];

export const ALERT_OUTCOME_ACTIONS = {
  ESCALATE_TO_CASE: 'ESCALATE_TO_CASE',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
} as const;

export type AlertOutcomeAction =
  (typeof ALERT_OUTCOME_ACTIONS)[keyof typeof ALERT_OUTCOME_ACTIONS];

export const WORKFLOW_DECISIONS = {
  CLEAR: 'CLEAR',
  REJECT: 'REJECT',
  FREEZE_TRANSACTION: 'FREEZE_TRANSACTION',
  REQUIRE_EDD: 'REQUIRE_EDD',
} as const;

export type WorkflowDecision =
  (typeof WORKFLOW_DECISIONS)[keyof typeof WORKFLOW_DECISIONS];

export const CASE_WORK_ITEM_ACTIONS = {
  ASSIGN: 'ASSIGN',
  REASSIGN: 'REASSIGN',
  LINK_ALERT: 'LINK_ALERT',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
  CLOSE: 'CLOSE',
} as const;

export type CaseWorkItemAction =
  (typeof CASE_WORK_ITEM_ACTIONS)[keyof typeof CASE_WORK_ITEM_ACTIONS];

export const CASE_ACTIONS = {
  ASSIGN: 'ASSIGN',
  REASSIGN: 'REASSIGN',
  LINK_ALERT: 'LINK_ALERT',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
} as const;

export type CaseAction =
  (typeof CASE_ACTIONS)[keyof typeof CASE_ACTIONS];

export const INTERIM_MEASURES = {
  FREEZE: 'FREEZE',
  UNFREEZE: 'UNFREEZE',
  RESTRICT: 'RESTRICT',
  UNRESTRICT: 'UNRESTRICT',
} as const;

export type InterimMeasure =
  (typeof INTERIM_MEASURES)[keyof typeof INTERIM_MEASURES];

export const CASE_WORKFLOW_ACTIONS = {
  CLEAR: 'CLEAR',
  REJECT: 'REJECT',
  FREEZE_TRANSACTION: 'FREEZE_TRANSACTION',
  REQUIRE_EDD: 'REQUIRE_EDD',
} as const;

export type CaseWorkflowAction =
  (typeof CASE_WORKFLOW_ACTIONS)[keyof typeof CASE_WORKFLOW_ACTIONS];

export const ALERT_OUTCOME_ACTIONS_BY_STAGE: Record<
  ComplianceReviewStage,
  AlertOutcomeAction[]
> = {
  [ONBOARDING_REVIEW_STAGES.REVIEW_CDD]: [
    ALERT_OUTCOME_ACTIONS.FALSE_POSITIVE,
    ALERT_OUTCOME_ACTIONS.ESCALATE_TO_CASE,
  ],
  [ONBOARDING_REVIEW_STAGES.REVIEW_EDD]: [
    ALERT_OUTCOME_ACTIONS.FALSE_POSITIVE,
    ALERT_OUTCOME_ACTIONS.ESCALATE_TO_CASE,
  ],
  [TRANSACTION_REVIEW_STAGES.REVIEW_KYT]: [
    ALERT_OUTCOME_ACTIONS.FALSE_POSITIVE,
    ALERT_OUTCOME_ACTIONS.ESCALATE_TO_CASE,
  ],
  [TRANSACTION_REVIEW_STAGES.REVIEW_TRAVEL_RULE]: [
    ALERT_OUTCOME_ACTIONS.FALSE_POSITIVE,
    ALERT_OUTCOME_ACTIONS.ESCALATE_TO_CASE,
  ],
  [TRANSACTION_REVIEW_STAGES.REVIEW_DEPOSIT_FINAL]: [
    ALERT_OUTCOME_ACTIONS.FALSE_POSITIVE,
    ALERT_OUTCOME_ACTIONS.ESCALATE_TO_CASE,
  ],
  [TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_PRECHECK]: [],
  [TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_FINAL]: [
    ALERT_OUTCOME_ACTIONS.FALSE_POSITIVE,
    ALERT_OUTCOME_ACTIONS.ESCALATE_TO_CASE,
  ],
  [TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_RECONCILIATION]: [
    ALERT_OUTCOME_ACTIONS.FALSE_POSITIVE,
    ALERT_OUTCOME_ACTIONS.ESCALATE_TO_CASE,
  ],
  [TRANSACTION_REVIEW_STAGES.REVIEW_SAFEGUARDING_RECONCILIATION]: [
    ALERT_OUTCOME_ACTIONS.FALSE_POSITIVE,
    ALERT_OUTCOME_ACTIONS.ESCALATE_TO_CASE,
  ],
  [TRANSACTION_REVIEW_STAGES.REVIEW_SWAP_FINAL]: [
    ALERT_OUTCOME_ACTIONS.FALSE_POSITIVE,
    ALERT_OUTCOME_ACTIONS.ESCALATE_TO_CASE,
  ],
};

export const WORKFLOW_DECISIONS_BY_STAGE: Record<
  ComplianceReviewStage,
  WorkflowDecision[]
> = {
  [ONBOARDING_REVIEW_STAGES.REVIEW_CDD]: [
    WORKFLOW_DECISIONS.CLEAR,
    WORKFLOW_DECISIONS.REJECT,
    WORKFLOW_DECISIONS.REQUIRE_EDD,
  ],
  [ONBOARDING_REVIEW_STAGES.REVIEW_EDD]: [
    WORKFLOW_DECISIONS.CLEAR,
    WORKFLOW_DECISIONS.REJECT,
  ],
  [TRANSACTION_REVIEW_STAGES.REVIEW_KYT]: [
    WORKFLOW_DECISIONS.CLEAR,
    WORKFLOW_DECISIONS.FREEZE_TRANSACTION,
  ],
  [TRANSACTION_REVIEW_STAGES.REVIEW_TRAVEL_RULE]: [
    WORKFLOW_DECISIONS.CLEAR,
    WORKFLOW_DECISIONS.FREEZE_TRANSACTION,
  ],
  [TRANSACTION_REVIEW_STAGES.REVIEW_DEPOSIT_FINAL]: [
    WORKFLOW_DECISIONS.CLEAR,
    WORKFLOW_DECISIONS.FREEZE_TRANSACTION,
  ],
  [TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_PRECHECK]: [],
  [TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_FINAL]: [
    WORKFLOW_DECISIONS.CLEAR,
    WORKFLOW_DECISIONS.REJECT,
    WORKFLOW_DECISIONS.FREEZE_TRANSACTION,
  ],
  [TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_RECONCILIATION]: [],
  [TRANSACTION_REVIEW_STAGES.REVIEW_SAFEGUARDING_RECONCILIATION]: [],
  [TRANSACTION_REVIEW_STAGES.REVIEW_SWAP_FINAL]: [
    WORKFLOW_DECISIONS.CLEAR,
    WORKFLOW_DECISIONS.REJECT,
  ],
};

export const CASE_WORKFLOW_ACTIONS_BY_STAGE: Record<
  ComplianceReviewStage,
  CaseWorkflowAction[]
> = {
  [ONBOARDING_REVIEW_STAGES.REVIEW_CDD]: [
    CASE_WORKFLOW_ACTIONS.CLEAR,
    CASE_WORKFLOW_ACTIONS.REJECT,
    CASE_WORKFLOW_ACTIONS.REQUIRE_EDD,
  ],
  [ONBOARDING_REVIEW_STAGES.REVIEW_EDD]: [
    CASE_WORKFLOW_ACTIONS.CLEAR,
    CASE_WORKFLOW_ACTIONS.REJECT,
  ],
  [TRANSACTION_REVIEW_STAGES.REVIEW_KYT]: [
    CASE_WORKFLOW_ACTIONS.CLEAR,
    CASE_WORKFLOW_ACTIONS.FREEZE_TRANSACTION,
  ],
  [TRANSACTION_REVIEW_STAGES.REVIEW_TRAVEL_RULE]: [
    CASE_WORKFLOW_ACTIONS.CLEAR,
    CASE_WORKFLOW_ACTIONS.FREEZE_TRANSACTION,
  ],
  [TRANSACTION_REVIEW_STAGES.REVIEW_DEPOSIT_FINAL]: [
    CASE_WORKFLOW_ACTIONS.CLEAR,
    CASE_WORKFLOW_ACTIONS.FREEZE_TRANSACTION,
  ],
  [TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_PRECHECK]: [],
  [TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_FINAL]: [
    CASE_WORKFLOW_ACTIONS.CLEAR,
    CASE_WORKFLOW_ACTIONS.REJECT,
    CASE_WORKFLOW_ACTIONS.FREEZE_TRANSACTION,
  ],
  [TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_RECONCILIATION]: [],
  [TRANSACTION_REVIEW_STAGES.REVIEW_SAFEGUARDING_RECONCILIATION]: [],
  [TRANSACTION_REVIEW_STAGES.REVIEW_SWAP_FINAL]: [
    CASE_WORKFLOW_ACTIONS.CLEAR,
    CASE_WORKFLOW_ACTIONS.REJECT,
  ],
};

export function normalizeComplianceWorkflow(
  value: unknown,
): ComplianceWorkflow | null {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === ONBOARDING_WORKFLOW) return ONBOARDING_WORKFLOW;
  if (normalized === PERIODIC_REVIEW_WORKFLOW) return PERIODIC_REVIEW_WORKFLOW;
  if (normalized === TRANSACTION_WORKFLOW) return TRANSACTION_WORKFLOW;
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

export function isTransactionSourceType(value: unknown): boolean {
  const normalized = String(value || '').trim().toUpperCase();
  return (
    normalized === TRANSACTION_DEPOSIT_SOURCE_TYPE.toUpperCase() ||
    normalized === TRANSACTION_WITHDRAW_SOURCE_TYPE.toUpperCase() ||
    normalized === TRANSACTION_SWAP_SOURCE_TYPE.toUpperCase() ||
    normalized === TRANSACTION_SAFEGUARDING_SOURCE_TYPE.toUpperCase()
  );
}

export function isSupportedReviewSourceType(value: unknown): boolean {
  return (
    isOnboardingSourceType(value) ||
    isPeriodicReviewSourceType(value) ||
    isTransactionSourceType(value)
  );
}

export function getWorkflowFromSourceType(
  value: unknown,
): ComplianceWorkflow | null {
  if (isOnboardingSourceType(value)) return ONBOARDING_WORKFLOW;
  if (isPeriodicReviewSourceType(value)) return PERIODIC_REVIEW_WORKFLOW;
  if (isTransactionSourceType(value)) return TRANSACTION_WORKFLOW;
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
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;
  if (ONBOARDING_STAGE_SET.has(normalized)) {
    return normalized as OnboardingReviewStage;
  }
  if (TRANSACTION_STAGE_SET.has(normalized)) {
    return normalized as TransactionReviewStage;
  }
  return null;
}

export function isWorkflowBoundReviewStage(value: unknown): boolean {
  const stage = normalizeComplianceReviewStage(value);
  return (
    !!stage &&
    !NON_WORKFLOW_BOUND_STAGE_SET.has(stage) &&
    !LEGACY_READ_ONLY_REVIEW_STAGE_SET.has(stage)
  );
}

export function isLegacyReadOnlyReviewStage(value: unknown): boolean {
  const stage = normalizeComplianceReviewStage(value);
  return !!stage && LEGACY_READ_ONLY_REVIEW_STAGE_SET.has(stage);
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
    return PERIODIC_REVIEW_STAGE_TO_RULE[
      normalizedStage as OnboardingReviewStage
    ];
  }

  if (normalizedWorkflow === TRANSACTION_WORKFLOW) {
    return TRANSACTION_REVIEW_STAGE_TO_RULE[
      normalizedStage as TransactionReviewStage
    ];
  }

  return ONBOARDING_REVIEW_STAGE_TO_RULE[
    normalizedStage as OnboardingReviewStage
  ];
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

export function normalizeTransactionReviewRuleCode(
  ruleCode: unknown,
  stage?: unknown,
): TransactionReviewRule | null {
  const normalizedRule = String(ruleCode || '').trim().toUpperCase();
  const normalizedStage = normalizeComplianceReviewStage(stage);

  if (
    normalizedStage &&
    TRANSACTION_STAGE_SET.has(String(normalizedStage).toUpperCase())
  ) {
    const canonicalForStage =
      TRANSACTION_REVIEW_STAGE_TO_RULE[
        normalizedStage as TransactionReviewStage
      ];
    if (!normalizedRule) {
      return canonicalForStage;
    }
    if (normalizedRule === canonicalForStage) {
      return canonicalForStage;
    }
    return null;
  }

  if (!normalizedRule) return null;
  if (TRANSACTION_RULE_SET.has(normalizedRule)) {
    return normalizedRule as TransactionReviewRule;
  }
  return null;
}

export function normalizePeriodicReviewRuleCode(
  ruleCode: unknown,
  stage?: unknown,
): PeriodicReviewRule | null {
  const normalizedRule = String(ruleCode || '').trim().toUpperCase();
  const normalizedStage = normalizeComplianceReviewStage(stage);

  if (
    normalizedStage &&
    ONBOARDING_STAGE_SET.has(String(normalizedStage).toUpperCase())
  ) {
    const canonicalForStage =
      PERIODIC_REVIEW_STAGE_TO_RULE[
        normalizedStage as OnboardingReviewStage
      ];
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

  if (workflow === TRANSACTION_WORKFLOW) {
    return normalizeTransactionReviewRuleCode(ruleCode, stage);
  }

  return (
    normalizeOnboardingRuleCode(ruleCode, stage) ||
    normalizePeriodicReviewRuleCode(ruleCode, stage) ||
    normalizeTransactionReviewRuleCode(ruleCode, stage)
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

function normalizeTracePart(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : null;
}

function extractOnboardingJourneyIdFromSourceId(value: unknown): string | null {
  const normalized = normalizeTracePart(value);
  if (!normalized) return null;
  const parts = normalized.split(':').map((item) => item.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return parts[parts.length - 1] || null;
  }
  return normalized;
}

export function buildComplianceWorkflowTraceContext(input: {
  workflow?: unknown;
  sourceType?: unknown;
  workflowId?: unknown;
  workflowNo?: unknown;
  sourceId?: unknown;
  sourceNo?: unknown;
  journeyId?: unknown;
}): ComplianceWorkflowTraceContext | null {
  const workflow =
    normalizeComplianceWorkflow(input.workflow) ||
    getWorkflowFromSourceType(input.sourceType) ||
    null;

  if (workflow === ONBOARDING_WORKFLOW) {
    const journeyId =
      normalizeTracePart(input.journeyId) ||
      normalizeTracePart(input.workflowId) ||
      normalizeTracePart(input.workflowNo) ||
      normalizeTracePart(input.sourceNo) ||
      extractOnboardingJourneyIdFromSourceId(input.sourceId);
    if (!journeyId) {
      return null;
    }
    return {
      traceId: `${ONBOARDING_WORKFLOW}:${journeyId}`,
      workflowType: ONBOARDING_WORKFLOW,
      workflowId: journeyId,
      workflowNo: journeyId,
    };
  }

  if (workflow === PERIODIC_REVIEW_WORKFLOW) {
    const cycleId =
      normalizeTracePart(input.workflowId) ||
      normalizeTracePart(input.sourceId);
    const cycleNo =
      normalizeTracePart(input.workflowNo) ||
      normalizeTracePart(input.sourceNo);
    if (!cycleId || !cycleNo) {
      return null;
    }
    return {
      traceId: `${PERIODIC_REVIEW_WORKFLOW}:${cycleId}`,
      workflowType: PERIODIC_REVIEW_WORKFLOW,
      workflowId: cycleId,
      workflowNo: cycleNo,
    };
  }

  if (workflow === TRANSACTION_WORKFLOW) {
    const txId =
      normalizeTracePart(input.workflowId) ||
      normalizeTracePart(input.sourceId);
    const txNo =
      normalizeTracePart(input.workflowNo) ||
      normalizeTracePart(input.sourceNo) ||
      txId;
    if (!txId || !txNo) {
      return null;
    }
    return {
      traceId: `${TRANSACTION_WORKFLOW}:${txId}`,
      workflowType: TRANSACTION_WORKFLOW,
      workflowId: txId,
      workflowNo: txNo,
    };
  }

  return null;
}
