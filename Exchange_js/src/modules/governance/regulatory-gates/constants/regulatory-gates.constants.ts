export const RegulatoryGateTypes = {
  CONTROL_CHANGE: 'CONTROL_CHANGE',
  REGULATED_APPOINTMENT_CHANGE: 'REGULATED_APPOINTMENT_CHANGE',
  CLIENT_BANK_ACCOUNT_ENABLEMENT: 'CLIENT_BANK_ACCOUNT_ENABLEMENT',
} as const;

export const RegulatoryGateAuthorities = {
  VARA: 'VARA',
} as const;

export const RegulatoryGateSubjectTypes = {
  SHAREHOLDING_REGISTRY_VERSION: 'SHAREHOLDING_REGISTRY_VERSION',
  APPOINTMENT_RECORD: 'APPOINTMENT_RECORD',
  WALLET: 'WALLET',
} as const;

export const RegulatoryGateInternalApprovalStatuses = {
  NOT_REQUIRED: 'NOT_REQUIRED',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;

export const RegulatoryGateFilingStatuses = {
  REQUIRED: 'REQUIRED',
  SUBMITTED: 'SUBMITTED',
  ACCEPTED: 'ACCEPTED',
  RETURNED: 'RETURNED',
  REJECTED: 'REJECTED',
} as const;

export const RegulatoryGateReceiptStatuses = {
  PENDING: 'PENDING',
  BOUND: 'BOUND',
  REPLACED: 'REPLACED',
} as const;

export const RegulatoryGateEffectivenessStatuses = {
  BLOCKED: 'BLOCKED',
  READY: 'READY',
  EFFECTIVE: 'EFFECTIVE',
  REVOKED: 'REVOKED',
} as const;

export const RegulatoryGateResults = {
  BLOCKED: 'BLOCKED',
  READY: 'READY',
  EFFECTIVE: 'EFFECTIVE',
  REVOKED: 'REVOKED',
} as const;

export const RegulatoryGateReceiptTypes = {
  VARA_APPROVAL: 'VARA_APPROVAL',
  VARA_ACK: 'VARA_ACK',
  NO_OBJECTION: 'NO_OBJECTION',
} as const;

export const RegulatoryGatePrefixes = {
  GATE: 'RGT',
} as const;

export const REGULATORY_GATE_TYPE_VALUES = Object.values(RegulatoryGateTypes);
export const REGULATORY_GATE_AUTHORITY_VALUES = Object.values(
  RegulatoryGateAuthorities,
);
export const REGULATORY_GATE_SUBJECT_TYPE_VALUES = Object.values(
  RegulatoryGateSubjectTypes,
);
export const REGULATORY_GATE_INTERNAL_APPROVAL_STATUS_VALUES = Object.values(
  RegulatoryGateInternalApprovalStatuses,
);
export const REGULATORY_GATE_FILING_STATUS_VALUES = Object.values(
  RegulatoryGateFilingStatuses,
);
export const REGULATORY_GATE_RECEIPT_STATUS_VALUES = Object.values(
  RegulatoryGateReceiptStatuses,
);
export const REGULATORY_GATE_EFFECTIVENESS_STATUS_VALUES = Object.values(
  RegulatoryGateEffectivenessStatuses,
);
export const REGULATORY_GATE_RESULT_VALUES = Object.values(
  RegulatoryGateResults,
);
export const REGULATORY_GATE_RECEIPT_TYPE_VALUES = Object.values(
  RegulatoryGateReceiptTypes,
);
