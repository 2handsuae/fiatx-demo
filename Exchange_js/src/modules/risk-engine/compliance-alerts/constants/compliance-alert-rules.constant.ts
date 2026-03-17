export enum ComplianceAlertSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum ComplianceAlertStatus {
  OPEN = 'OPEN',
  ASSIGNED = 'ASSIGNED',
  ESCALATED = 'ESCALATED',
  CLOSED = 'CLOSED',
}

export enum ComplianceAlertAction {
  ASSIGN = 'ASSIGN',
  UNASSIGN = 'UNASSIGN',
  ESCALATE = 'ESCALATE',
  CLOSE = 'CLOSE',
}

export enum ComplianceAlertEventType {
  TRIGGERED = 'TRIGGERED',
  ASSIGNED = 'ASSIGNED',
  UNASSIGNED = 'UNASSIGNED',
  ESCALATED = 'ESCALATED',
  OVERDUE_MARKED = 'OVERDUE_MARKED',
  CLOSED = 'CLOSED',
  UPDATED = 'UPDATED',
}

export const CLOSED_ALERT_STATUSES: ComplianceAlertStatus[] = [
  ComplianceAlertStatus.CLOSED,
];

export const ALERT_SLA_HOURS: Record<ComplianceAlertSeverity, number> = {
  [ComplianceAlertSeverity.CRITICAL]: 4,
  [ComplianceAlertSeverity.HIGH]: 24,
  [ComplianceAlertSeverity.MEDIUM]: 72,
  [ComplianceAlertSeverity.LOW]: 24 * 7,
};

export interface ComplianceAlertRuleDefinition {
  ruleCode: string;
  capCode?: string;
  severity: ComplianceAlertSeverity;
  title: string;
  defaultMessage: string;
}

export const COMPLIANCE_ALERT_RULES: Record<string, ComplianceAlertRuleDefinition> = {
  ONB_CDD_REVIEW_REQUIRED: {
    ruleCode: 'ONB_CDD_REVIEW_REQUIRED',
    severity: ComplianceAlertSeverity.HIGH,
    capCode: 'CAP-004',
    title: 'Onboarding CDD Review Required',
    defaultMessage: 'CDD review requires compliance handling.',
  },
  ONB_EDD_REVIEW_REQUIRED: {
    ruleCode: 'ONB_EDD_REVIEW_REQUIRED',
    capCode: 'CAP-006',
    severity: ComplianceAlertSeverity.HIGH,
    title: 'Onboarding EDD Review Required',
    defaultMessage: 'EDD review requires compliance handling.',
  },
  ONB_ONBOARDING_JOURNEY_REVIEW: {
    ruleCode: 'ONB_ONBOARDING_JOURNEY_REVIEW',
    capCode: 'CAP-004',
    severity: ComplianceAlertSeverity.CRITICAL,
    title: 'Legacy Onboarding Review Alias',
    defaultMessage: 'Legacy alias for onboarding journey review.',
  },
};

export function getComplianceAlertRule(
  ruleCode: string,
): ComplianceAlertRuleDefinition | null {
  return COMPLIANCE_ALERT_RULES[ruleCode] || null;
}
