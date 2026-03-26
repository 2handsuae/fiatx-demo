export const ALERT_DISPOSITION_CODES = {
  APPROVE_STAGE: 'APPROVE_STAGE',
  REJECT_STAGE: 'REJECT_STAGE',
  REQUIRE_EDD: 'REQUIRE_EDD',
  ESCALATE_TO_CASE: 'ESCALATE_TO_CASE',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
  NO_ACTION: 'NO_ACTION',
  RESOLVED_BY_WORKFLOW: 'RESOLVED_BY_WORKFLOW',
} as const;

export type AlertDispositionCode =
  (typeof ALERT_DISPOSITION_CODES)[keyof typeof ALERT_DISPOSITION_CODES];

export const CASE_DISPOSITION_CODES = {
  CLEAR: 'CLEAR',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
  RISK_CONFIRMED: 'RISK_CONFIRMED',
} as const;

export type CaseDispositionCode =
  (typeof CASE_DISPOSITION_CODES)[keyof typeof CASE_DISPOSITION_CODES];

export const ALERT_DISPOSITION_CODE_SET = new Set<string>(
  Object.values(ALERT_DISPOSITION_CODES),
);

export const CASE_DISPOSITION_CODE_SET = new Set<string>(
  Object.values(CASE_DISPOSITION_CODES),
);

export function normalizeAlertDispositionCode(
  value: unknown,
): AlertDispositionCode | null {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;
  if (ALERT_DISPOSITION_CODE_SET.has(normalized)) {
    return normalized as AlertDispositionCode;
  }
  if (normalized === 'CLEAR') return ALERT_DISPOSITION_CODES.RESOLVED_BY_WORKFLOW;
  if (normalized === 'APPROVE') return ALERT_DISPOSITION_CODES.APPROVE_STAGE;
  if (normalized === 'REJECT') return ALERT_DISPOSITION_CODES.REJECT_STAGE;
  if (normalized === 'REQUIRE_EDD') return ALERT_DISPOSITION_CODES.REQUIRE_EDD;
  return null;
}

export function normalizeCaseDispositionCode(
  value: unknown,
): CaseDispositionCode | null {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;
  if (CASE_DISPOSITION_CODE_SET.has(normalized)) {
    return normalized as CaseDispositionCode;
  }
  if (normalized === 'APPROVE' || normalized === 'APPROVE_STAGE') {
    return CASE_DISPOSITION_CODES.CLEAR;
  }
  if (
    normalized === 'REJECT' ||
    normalized === 'REJECT_STAGE' ||
    normalized === 'REQUIRE_EDD' ||
    normalized === 'RESTRICT' ||
    normalized === 'REPORT'
  ) {
    return CASE_DISPOSITION_CODES.RISK_CONFIRMED;
  }
  return null;
}

export function mirrorLegacyDecisionFromDisposition(
  value: unknown,
): string | null {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;
  switch (normalized) {
    case ALERT_DISPOSITION_CODES.APPROVE_STAGE:
      return 'APPROVE';
    case ALERT_DISPOSITION_CODES.REJECT_STAGE:
      return 'REJECT';
    case ALERT_DISPOSITION_CODES.REQUIRE_EDD:
      return 'REQUIRE_EDD';
    case CASE_DISPOSITION_CODES.CLEAR:
      return 'CLEAR';
    case CASE_DISPOSITION_CODES.FALSE_POSITIVE:
      return 'FALSE_POSITIVE';
    case CASE_DISPOSITION_CODES.RISK_CONFIRMED:
      return 'RISK_CONFIRMED';
    default:
      return normalized;
  }
}

export function normalizeWorkflowDecision(value: unknown): string | null {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === 'APPROVE' || normalized === 'APPROVE_STAGE') return 'CLEAR';
  if (normalized === 'CLEAR' || normalized === 'RESOLVED_BY_WORKFLOW') return 'CLEAR';
  if (normalized === 'REJECT' || normalized === 'REJECT_STAGE') return 'REJECT';
  if (normalized === 'FREEZE' || normalized === 'FREEZE_TRANSACTION') {
    return 'FREEZE_TRANSACTION';
  }
  if (normalized === 'REQUIRE_EDD') return 'REQUIRE_EDD';
  return null;
}
