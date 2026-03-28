export const RECONCILIATION_BREAK_SOURCE_TYPE = 'WITHDRAW' as const;

export const ReconciliationBreakStatuses = {
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  RESOLVED: 'RESOLVED',
  ACCEPTED_DIFFERENCE: 'ACCEPTED_DIFFERENCE',
} as const;

export type ReconciliationBreakStatus =
  (typeof ReconciliationBreakStatuses)[keyof typeof ReconciliationBreakStatuses];

export const ReconciliationBreakReasonCodes = {
  DELTA_MISMATCH: 'DELTA_MISMATCH',
  SUCCESS_CLOSEOUT_INCOMPLETE: 'SUCCESS_CLOSEOUT_INCOMPLETE',
  COMPENSATION_INCOMPLETE: 'COMPENSATION_INCOMPLETE',
} as const;

export type ReconciliationBreakReasonCode =
  (typeof ReconciliationBreakReasonCodes)[keyof typeof ReconciliationBreakReasonCodes];
