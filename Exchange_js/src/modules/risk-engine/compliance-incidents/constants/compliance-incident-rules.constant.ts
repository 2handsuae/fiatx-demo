export enum ComplianceIncidentSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum ComplianceIncidentStatus {
  NEW = 'NEW',
  ASSIGNED = 'ASSIGNED',
  INVESTIGATING = 'INVESTIGATING',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
  FALSE_POSITIVE = 'FALSE_POSITIVE',
}

export enum ComplianceIncidentAction {
  ASSIGN = 'ASSIGN',
  START_INVESTIGATION = 'START_INVESTIGATION',
  LINK_ALERT = 'LINK_ALERT',
  MARK_RESOLVED = 'MARK_RESOLVED',
  CLOSE = 'CLOSE',
  MARK_FALSE_POSITIVE = 'MARK_FALSE_POSITIVE',
}

export enum ComplianceIncidentEventType {
  CREATED = 'CREATED',
  ASSIGNED = 'ASSIGNED',
  INVESTIGATION_STARTED = 'INVESTIGATION_STARTED',
  ALERT_LINKED = 'ALERT_LINKED',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
  FALSE_POSITIVE = 'FALSE_POSITIVE',
}

export enum ComplianceIncidentAlertRelationType {
  PRIMARY = 'PRIMARY',
  RELATED = 'RELATED',
}

export const CLOSED_INCIDENT_STATUSES: ComplianceIncidentStatus[] = [
  ComplianceIncidentStatus.CLOSED,
  ComplianceIncidentStatus.FALSE_POSITIVE,
];

export const INCIDENT_SLA_HOURS: Record<ComplianceIncidentSeverity, number> = {
  [ComplianceIncidentSeverity.CRITICAL]: 4,
  [ComplianceIncidentSeverity.HIGH]: 24,
  [ComplianceIncidentSeverity.MEDIUM]: 72,
  [ComplianceIncidentSeverity.LOW]: 24 * 7,
};
