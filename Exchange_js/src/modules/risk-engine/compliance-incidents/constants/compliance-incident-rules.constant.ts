export enum ComplianceIncidentSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum ComplianceIncidentStatus {
  OPEN = 'OPEN',
  ASSIGNED = 'ASSIGNED',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum ComplianceIncidentAction {
  ASSIGN = 'ASSIGN',
  LINK_ALERT = 'LINK_ALERT',
  RESOLVE = 'RESOLVE',
  CLOSE = 'CLOSE',
}

export enum ComplianceIncidentEventType {
  CREATED = 'CREATED',
  ASSIGNED = 'ASSIGNED',
  ALERT_LINKED = 'ALERT_LINKED',
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
