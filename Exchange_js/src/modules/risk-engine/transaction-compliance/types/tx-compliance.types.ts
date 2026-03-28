export enum TxSourceType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAW = 'WITHDRAW',
  PAYIN = 'PAYIN',
  SWAP = 'SWAP',
  PAYOUT = 'PAYOUT',
}

export enum KytScreeningStage {
  PRE_TXN = 'PRE_TXN',
  MAIN = 'MAIN',
}

export const TX_RESPONSE_LIFECYCLE = {
  CREATED: 'CREATED',
  RECEIVED: 'RECEIVED',
  FINAL: 'FINAL',
} as const;

export type TxResponseLifecycleStatus =
  (typeof TX_RESPONSE_LIFECYCLE)[keyof typeof TX_RESPONSE_LIFECYCLE];

export type TxResponseLifecycleStatusOrEmpty = TxResponseLifecycleStatus | '';

export const KYT_RECEIVED_COMPATIBILITY_STATUSES = ['RECEIVED', 'SENT', 'PENDING'] as const;
export const TRAVEL_RULE_RECEIVED_COMPATIBILITY_STATUSES = [
  'RECEIVED',
  'SENT',
  'PENDING',
] as const;
export const KYT_FINAL_COMPATIBILITY_STATUSES = [
  'FINAL',
  'PASS',
  'FAIL',
  'REVIEW',
  'CLEAR',
  'HOLD',
  'REJECT',
  'REJECTED',
  'APPROVE',
  'APPROVED',
  'ACCEPTED',
  'NOT_REQUIRED',
  'EXPIRED',
] as const;
export const TRAVEL_RULE_FINAL_COMPATIBILITY_STATUSES = [
  'FINAL',
  'PASS',
  'FAIL',
  'REVIEW',
  'CLEAR',
  'HOLD',
  'REJECT',
  'REJECTED',
  'APPROVE',
  'APPROVED',
  'ACCEPTED',
  'NOT_REQUIRED',
  'EXPIRED',
] as const;

export function normalizeKytResponseLifecycleStatus(
  value: unknown,
  options?: { allowEmpty?: boolean },
): TxResponseLifecycleStatusOrEmpty {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) {
    return options?.allowEmpty ? '' : TX_RESPONSE_LIFECYCLE.CREATED;
  }
  if (normalized === TX_RESPONSE_LIFECYCLE.CREATED) {
    return TX_RESPONSE_LIFECYCLE.CREATED;
  }
  if (KYT_RECEIVED_COMPATIBILITY_STATUSES.includes(normalized as any)) {
    return TX_RESPONSE_LIFECYCLE.RECEIVED;
  }
  return TX_RESPONSE_LIFECYCLE.FINAL;
}

export function normalizeTravelRuleResponseLifecycleStatus(
  value: unknown,
  required?: boolean | null,
  options?: { allowEmpty?: boolean },
): TxResponseLifecycleStatusOrEmpty {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) {
    if (options?.allowEmpty) {
      return '';
    }
    return required ? TX_RESPONSE_LIFECYCLE.CREATED : '';
  }
  if (normalized === TX_RESPONSE_LIFECYCLE.CREATED) {
    return TX_RESPONSE_LIFECYCLE.CREATED;
  }
  if (TRAVEL_RULE_RECEIVED_COMPATIBILITY_STATUSES.includes(normalized as any)) {
    return TX_RESPONSE_LIFECYCLE.RECEIVED;
  }
  return TX_RESPONSE_LIFECYCLE.FINAL;
}

export type TxComplianceProviderMode = 'MOCK' | 'MANUAL';

export interface TxSourceContext {
  sourceType: TxSourceType;
  sourceId: string;
  ownerType: string;
  ownerId: string | null;
  assetId: string;
}

export interface UpsertKytCaseInput extends TxSourceContext {
  screeningStage: KytScreeningStage;
  provider?: string;
  providerCaseId?: string | null;
  status?: string;
  riskScore?: number | null;
  checkedAt?: Date | null;
  rawPayload?: unknown;
  normalizedPayload?: unknown;
}

export interface UpsertTravelRuleCaseInput extends TxSourceContext {
  provider?: string;
  providerTransferId?: string | null;
  required?: boolean;
  status?: string;
  counterpartyVasp?: string | null;
  checkedAt?: Date | null;
  rawPayload?: unknown;
  normalizedPayload?: unknown;
}
