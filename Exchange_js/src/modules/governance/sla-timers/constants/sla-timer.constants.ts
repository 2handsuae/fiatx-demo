export const SlaTimerStatuses = {
  ACTIVE: 'ACTIVE',
  CLOSED: 'CLOSED',
  EXPIRED: 'EXPIRED',
} as const;

export const SlaTimerTypes = {
  APPROVAL_TIMEOUT: 'APPROVAL_TIMEOUT',
  CHANGE_POST_APPROVAL_FOLLOWUP: 'CHANGE_POST_APPROVAL_FOLLOWUP',
  GOVERNANCE_TRAINING_DUE: 'GOVERNANCE_TRAINING_DUE',
  GOVERNANCE_CONFLICT_REVIEW: 'GOVERNANCE_CONFLICT_REVIEW',
  GOVERNANCE_WIND_DOWN_REVIEW: 'GOVERNANCE_WIND_DOWN_REVIEW',
} as const;

export const SlaNotificationTypes = {
  DUE_REMINDER: 'DUE_REMINDER',
  EXPIRE_MARK: 'EXPIRE_MARK',
} as const;

export const SlaNotificationStatuses = {
  SCHEDULED: 'SCHEDULED',
  TRIGGERED: 'TRIGGERED',
  SKIPPED: 'SKIPPED',
} as const;

export const SlaTimerWorkflowTypes = {
  APPROVAL: 'APPROVAL',
  GOVERNANCE_REGISTRY: 'GOVERNANCE_REGISTRY',
} as const;

export const SlaTimerSubjectTypes = {
  APPROVAL_CASE: 'APPROVAL_CASE',
  TRAINING_RECORD: 'TRAINING_RECORD',
  CONFLICT_DISCLOSURE: 'CONFLICT_DISCLOSURE',
  WIND_DOWN_MATERIAL: 'WIND_DOWN_MATERIAL',
} as const;

export const SLA_TIMER_STATUS_VALUES = Object.values(SlaTimerStatuses);
export const SLA_TIMER_TYPE_VALUES = Object.values(SlaTimerTypes);
export const SLA_TIMER_WORKFLOW_TYPE_VALUES = Object.values(SlaTimerWorkflowTypes);
export const SLA_TIMER_SUBJECT_TYPE_VALUES = Object.values(SlaTimerSubjectTypes);
export const SLA_NOTIFICATION_TYPE_VALUES = Object.values(SlaNotificationTypes);
export const SLA_NOTIFICATION_STATUS_VALUES = Object.values(SlaNotificationStatuses);

export const DEFAULT_SLA_TIMER_SCAN_MS = 60000;
export const DEFAULT_SLA_TIMER_GRACE_SECONDS = 120;
export const DEFAULT_CHANGE_POST_APPROVAL_FOLLOWUP_HOURS = 48;
export const DEFAULT_SLA_DEMO_DUE_IN_SECONDS = 30;
