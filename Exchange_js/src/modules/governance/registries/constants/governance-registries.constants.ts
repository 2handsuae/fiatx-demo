export const ShareholdingRegistryStatuses = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  SUPERSEDED: 'SUPERSEDED',
  ARCHIVED: 'ARCHIVED',
} as const;

export const ShareholdingParticipantTypes = {
  SHAREHOLDER: 'SHAREHOLDER',
  CONTROLLER: 'CONTROLLER',
  UBO: 'UBO',
} as const;

export const AppointmentStatuses = {
  PLANNED: 'PLANNED',
  ACTIVE: 'ACTIVE',
  ENDED: 'ENDED',
  CANCELLED: 'CANCELLED',
} as const;

export const TrainingStatuses = {
  ASSIGNED: 'ASSIGNED',
  COMPLETED: 'COMPLETED',
  OVERDUE: 'OVERDUE',
  WAIVED: 'WAIVED',
} as const;

export const ConflictDisclosureStatuses = {
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  MITIGATED: 'MITIGATED',
  CLOSED: 'CLOSED',
} as const;

export const WindDownMaterialStatuses = {
  ACTIVE: 'ACTIVE',
  SUPERSEDED: 'SUPERSEDED',
  ARCHIVED: 'ARCHIVED',
} as const;

export const GovernanceRegistrySubjectTypes = {
  SHAREHOLDING_REGISTRY_VERSION: 'SHAREHOLDING_REGISTRY_VERSION',
  APPOINTMENT_RECORD: 'APPOINTMENT_RECORD',
  TRAINING_RECORD: 'TRAINING_RECORD',
  CONFLICT_DISCLOSURE: 'CONFLICT_DISCLOSURE',
  WIND_DOWN_MATERIAL: 'WIND_DOWN_MATERIAL',
} as const;

export const GovernanceRegistryPrefixes = {
  SHAREHOLDING: 'SHR',
  APPOINTMENT: 'APT',
  TRAINING: 'TRN',
  CONFLICT: 'CFD',
  WIND_DOWN: 'WDM',
} as const;

export const SHAREHOLDING_REGISTRY_STATUS_VALUES = Object.values(
  ShareholdingRegistryStatuses,
);
export const SHAREHOLDING_PARTICIPANT_TYPE_VALUES = Object.values(
  ShareholdingParticipantTypes,
);
export const APPOINTMENT_STATUS_VALUES = Object.values(AppointmentStatuses);
export const TRAINING_STATUS_VALUES = Object.values(TrainingStatuses);
export const CONFLICT_DISCLOSURE_STATUS_VALUES = Object.values(
  ConflictDisclosureStatuses,
);
export const WIND_DOWN_MATERIAL_STATUS_VALUES = Object.values(
  WindDownMaterialStatuses,
);
