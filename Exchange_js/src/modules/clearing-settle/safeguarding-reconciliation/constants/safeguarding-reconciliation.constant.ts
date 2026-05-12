export const SAFEGUARDING_BREAK_SOURCE_TYPE = 'SAFEGUARDING_ASSET' as const;
export const RECONCILIATION_BREAK_SOURCE_TYPE =
  SAFEGUARDING_BREAK_SOURCE_TYPE;

export const SafeguardingRunStatuses = {
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type SafeguardingRunStatus =
  (typeof SafeguardingRunStatuses)[keyof typeof SafeguardingRunStatuses];

export const ReconciliationBreakStatuses = {
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  RESOLVED: 'RESOLVED',
  ACCEPTED_DIFFERENCE: 'ACCEPTED_DIFFERENCE',
} as const;

export type ReconciliationBreakStatus =
  (typeof ReconciliationBreakStatuses)[keyof typeof ReconciliationBreakStatuses];

export const ReconciliationBreakTypes = {
  COVERAGE_BREAK: 'COVERAGE_BREAK',
  EXTERNAL_PROOF_BREAK: 'EXTERNAL_PROOF_BREAK',
  MULTI_LAYER_BREAK: 'MULTI_LAYER_BREAK',
} as const;

export type ReconciliationBreakType =
  (typeof ReconciliationBreakTypes)[keyof typeof ReconciliationBreakTypes];

export const ReconciliationBreakReasonCodes = {
  ...ReconciliationBreakTypes,
  DELTA_MISMATCH: 'DELTA_MISMATCH',
  SUCCESS_CLOSEOUT_INCOMPLETE: 'SUCCESS_CLOSEOUT_INCOMPLETE',
  COMPENSATION_INCOMPLETE: 'COMPENSATION_INCOMPLETE',
} as const;

export type ReconciliationBreakReasonCode =
  (typeof ReconciliationBreakReasonCodes)[keyof typeof ReconciliationBreakReasonCodes];

export const ReconciliationWarningStatuses = {
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED: 'RESOLVED',
  ACCEPTED: 'ACCEPTED',
} as const;

export type ReconciliationWarningStatus =
  (typeof ReconciliationWarningStatuses)[keyof typeof ReconciliationWarningStatuses];

export const ReconciliationWarningTypes = {
  DEPOSIT_COLLECTION_OVER_AMOUNT: 'DEPOSIT_COLLECTION_OVER_AMOUNT',
  DEPOSIT_COLLECTION_OVER_AGE: 'DEPOSIT_COLLECTION_OVER_AGE',
  PAYOUT_TARGET_BELOW_MIN: 'PAYOUT_TARGET_BELOW_MIN',
  PAYOUT_TARGET_ABOVE_MAX: 'PAYOUT_TARGET_ABOVE_MAX',
} as const;

export type ReconciliationWarningType =
  (typeof ReconciliationWarningTypes)[keyof typeof ReconciliationWarningTypes];

export const FiatStatementImportStatuses = {
  PENDING: 'PENDING',
  READY: 'READY',
  FAILED: 'FAILED',
} as const;

export type FiatStatementImportStatus =
  (typeof FiatStatementImportStatuses)[keyof typeof FiatStatementImportStatuses];

export const SafeguardingPoolRoles = {
  DEPOSIT: 'C_DEP',
  MASTER: 'C_MAIN',
  PAYOUT: 'C_OUT',
  CUST_BANK: 'C_CMA',
  OUTBOUND_IN_TRANSIT: 'OUTBOUND_IN_TRANSIT',
} as const;

export type SafeguardingPoolRole =
  (typeof SafeguardingPoolRoles)[keyof typeof SafeguardingPoolRoles];

export const SAFEGUARDING_WARNABLE_POOL_ROLES = [
  SafeguardingPoolRoles.DEPOSIT,
  SafeguardingPoolRoles.PAYOUT,
] as const;
