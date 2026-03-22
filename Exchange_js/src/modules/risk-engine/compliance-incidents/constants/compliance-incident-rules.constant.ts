export enum ComplianceIncidentSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum ComplianceCaseType {
  ONBOARDING = 'ONBOARDING',
  PERIODIC_REVIEW = 'PERIODIC_REVIEW',
  TRANSACTION = 'TRANSACTION',
  GENERIC = 'GENERIC',
}

export enum ComplianceCaseFreezeStatus {
  ACTIVE = 'ACTIVE',
  FROZEN = 'FROZEN',
}

export enum ComplianceCaseReportStatus {
  // Compatibility mirror only. Investigation report lifecycle is managed separately
  // by ComplianceIncidentReportVersionStatus and external filing status.
  NOT_REPORTED = 'NOT_REPORTED',
  REPORTED = 'REPORTED',
}

export enum ComplianceCaseFilingStatus {
  REQUIRED = 'REQUIRED',
  SUBMITTED = 'SUBMITTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  RETURNED = 'RETURNED',
  CLOSED = 'CLOSED',
}

export enum ComplianceIncidentReportVersionStatus {
  DRAFT = 'DRAFT',
  FINALIZED = 'FINALIZED',
  SUPERSEDED = 'SUPERSEDED',
}

export enum ComplianceIncidentStatus {
  OPEN = 'OPEN',
  ASSIGNED = 'ASSIGNED',
  INVESTIGATING = 'INVESTIGATING',
  PENDING_MLRO_REVIEW = 'PENDING_MLRO_REVIEW',
  // Legacy value kept for read compatibility. New flow does not transition to RESOLVED.
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum ComplianceIncidentAction {
  ASSIGN = 'ASSIGN',
  LINK_ALERT = 'LINK_ALERT',
  FREEZE = 'FREEZE',
  UNFREEZE = 'UNFREEZE',
  RESTRICT = 'RESTRICT',
  UNRESTRICT = 'UNRESTRICT',
}

export enum ComplianceIncidentMlroAction {
  RETURN_FOR_INVESTIGATION = 'RETURN_FOR_INVESTIGATION',
  APPROVE_FINAL_DISPOSITION = 'APPROVE_FINAL_DISPOSITION',
}

export enum ComplianceIncidentExternalFilingAction {
  SUBMIT = 'SUBMIT',
  ACKNOWLEDGE = 'ACKNOWLEDGE',
  RETURN = 'RETURN',
  CLOSE = 'CLOSE',
}

export enum ComplianceIncidentEventType {
  CREATED = 'CREATED',
  ASSIGNED = 'ASSIGNED',
  ALERT_LINKED = 'ALERT_LINKED',
  REPORT_DRAFT_SAVED = 'REPORT_DRAFT_SAVED',
  REPORT_FINALIZED = 'REPORT_FINALIZED',
  MLRO_SUBMITTED = 'MLRO_SUBMITTED',
  MLRO_RETURNED = 'MLRO_RETURNED',
  FINAL_DISPOSITION_APPROVED = 'FINAL_DISPOSITION_APPROVED',
  FILING_REQUIRED = 'FILING_REQUIRED',
  FILING_SUBMITTED = 'FILING_SUBMITTED',
  FILING_ACKNOWLEDGED = 'FILING_ACKNOWLEDGED',
  FILING_RETURNED = 'FILING_RETURNED',
  FILING_CLOSED = 'FILING_CLOSED',
  FROZEN = 'FROZEN',
  UNFROZEN = 'UNFROZEN',
  RESTRICTED = 'RESTRICTED',
  UNRESTRICTED = 'UNRESTRICTED',
  OVERDUE_MARKED = 'OVERDUE_MARKED',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum ComplianceIncidentAlertRelationType {
  PRIMARY = 'PRIMARY',
  RELATED = 'RELATED',
}

export const CLOSED_INCIDENT_STATUSES: ComplianceIncidentStatus[] = [
  ComplianceIncidentStatus.CLOSED,
];

export const INCIDENT_SLA_HOURS: Record<ComplianceIncidentSeverity, number> = {
  [ComplianceIncidentSeverity.CRITICAL]: 4,
  [ComplianceIncidentSeverity.HIGH]: 24,
  [ComplianceIncidentSeverity.MEDIUM]: 72,
  [ComplianceIncidentSeverity.LOW]: 24 * 7,
};

export const DEFAULT_COMPLIANCE_CASE_SLA_SCAN_MS = 60_000;
