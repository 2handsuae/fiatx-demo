export const ALERT_DISPOSITION_CODES = {
  APPROVE_STAGE: 'APPROVE_STAGE',
  REJECT_STAGE: 'REJECT_STAGE',
  REQUIRE_EDD: 'REQUIRE_EDD',
  ESCALATE_TO_CASE: 'ESCALATE_TO_CASE',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
  NO_ACTION: 'NO_ACTION',
} as const;

export type AlertDispositionCode =
  (typeof ALERT_DISPOSITION_CODES)[keyof typeof ALERT_DISPOSITION_CODES];

export const CASE_DISPOSITION_CODES = {
  APPROVE_STAGE: 'APPROVE_STAGE',
  REJECT_STAGE: 'REJECT_STAGE',
  REQUIRE_EDD: 'REQUIRE_EDD',
  CLEAR: 'CLEAR',
  RESTRICT: 'RESTRICT',
  REPORT: 'REPORT',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
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
  if (normalized === 'APPROVE') return CASE_DISPOSITION_CODES.APPROVE_STAGE;
  if (normalized === 'REJECT') return CASE_DISPOSITION_CODES.REJECT_STAGE;
  if (normalized === 'REQUIRE_EDD') return CASE_DISPOSITION_CODES.REQUIRE_EDD;
  return null;
}

export function mirrorLegacyDecisionFromDisposition(
  value: unknown,
): string | null {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;
  switch (normalized) {
    case ALERT_DISPOSITION_CODES.APPROVE_STAGE:
    case CASE_DISPOSITION_CODES.APPROVE_STAGE:
      return 'APPROVE';
    case ALERT_DISPOSITION_CODES.REJECT_STAGE:
    case CASE_DISPOSITION_CODES.REJECT_STAGE:
      return 'REJECT';
    case ALERT_DISPOSITION_CODES.REQUIRE_EDD:
    case CASE_DISPOSITION_CODES.REQUIRE_EDD:
      return 'REQUIRE_EDD';
    default:
      return normalized;
  }
}
