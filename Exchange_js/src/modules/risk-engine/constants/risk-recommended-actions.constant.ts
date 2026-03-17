export const RISK_RECOMMENDED_ACTIONS = {
  UPSERT_ALERT: 'UPSERT_ALERT',
  AUTO_ESCALATE_CASE: 'AUTO_ESCALATE_CASE',
  ONBOARDING_RECOMMEND_DECISIONS: 'ONBOARDING_RECOMMEND_DECISIONS',
} as const;

export type RiskRecommendedActionType =
  (typeof RISK_RECOMMENDED_ACTIONS)[keyof typeof RISK_RECOMMENDED_ACTIONS];

export const LEGACY_RISK_RECOMMENDED_ACTION_ALIASES: Record<string, RiskRecommendedActionType> =
  {
    ESCALATE_INCIDENT: RISK_RECOMMENDED_ACTIONS.AUTO_ESCALATE_CASE,
  };

export function normalizeRiskRecommendedActionType(
  value: unknown,
): RiskRecommendedActionType | null {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;

  if (
    normalized === RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT ||
    normalized === RISK_RECOMMENDED_ACTIONS.AUTO_ESCALATE_CASE ||
    normalized === RISK_RECOMMENDED_ACTIONS.ONBOARDING_RECOMMEND_DECISIONS
  ) {
    return normalized as RiskRecommendedActionType;
  }

  return LEGACY_RISK_RECOMMENDED_ACTION_ALIASES[normalized] || null;
}
