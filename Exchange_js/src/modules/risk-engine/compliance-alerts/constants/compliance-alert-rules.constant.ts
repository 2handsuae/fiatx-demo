export enum ComplianceAlertSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum ComplianceAlertStatus {
  NEW = 'NEW',
  ASSIGNED = 'ASSIGNED',
  IN_REVIEW = 'IN_REVIEW',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
  FALSE_POSITIVE = 'FALSE_POSITIVE',
}

export enum ComplianceAlertAction {
  START_REVIEW = 'START_REVIEW',
  ASSIGN = 'ASSIGN',
  ESCALATE = 'ESCALATE',
  RESOLVE = 'RESOLVE',
  MARK_FALSE_POSITIVE = 'MARK_FALSE_POSITIVE',
}

export enum ComplianceAlertEventType {
  TRIGGERED = 'TRIGGERED',
  REOPENED = 'REOPENED',
  ACKED = 'ACKED',
  REVIEW_STARTED = 'REVIEW_STARTED',
  ASSIGNED = 'ASSIGNED',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
  FALSE_POSITIVE = 'FALSE_POSITIVE',
  MANUAL_REOPENED = 'MANUAL_REOPENED',
}

export const CLOSED_ALERT_STATUSES: ComplianceAlertStatus[] = [
  ComplianceAlertStatus.ESCALATED,
  ComplianceAlertStatus.RESOLVED,
  ComplianceAlertStatus.FALSE_POSITIVE,
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
  TX_KYT_REVIEW: {
    ruleCode: 'TX_KYT_REVIEW',
    capCode: 'CAP-027',
    severity: ComplianceAlertSeverity.HIGH,
    title: 'Transaction KYT Review Required',
    defaultMessage: 'KYT case reached REVIEW status and needs compliance review.',
  },
  TX_KYT_FAIL: {
    ruleCode: 'TX_KYT_FAIL',
    capCode: 'CAP-027',
    severity: ComplianceAlertSeverity.CRITICAL,
    title: 'Transaction KYT Failed',
    defaultMessage: 'KYT case reached FAIL status and requires immediate action.',
  },
  TX_TRAVEL_RULE_REJECTED: {
    ruleCode: 'TX_TRAVEL_RULE_REJECTED',
    capCode: 'CAP-029',
    severity: ComplianceAlertSeverity.CRITICAL,
    title: 'Travel Rule Rejected',
    defaultMessage: 'Travel Rule case was rejected for a required transfer.',
  },
  TX_TRAVEL_RULE_EXPIRED: {
    ruleCode: 'TX_TRAVEL_RULE_EXPIRED',
    capCode: 'CAP-029',
    severity: ComplianceAlertSeverity.HIGH,
    title: 'Travel Rule Expired',
    defaultMessage: 'Travel Rule case expired before completion.',
  },
  TX_COMPLIANCE_GATE_BLOCKED: {
    ruleCode: 'TX_COMPLIANCE_GATE_BLOCKED',
    capCode: 'CAP-027',
    severity: ComplianceAlertSeverity.HIGH,
    title: 'Transaction Blocked by Compliance Gate',
    defaultMessage: 'Transaction progression was blocked by compliance gate checks.',
  },
  ONB_SANCTIONS_HIT: {
    ruleCode: 'ONB_SANCTIONS_HIT',
    capCode: 'CAP-030',
    severity: ComplianceAlertSeverity.CRITICAL,
    title: 'Onboarding Sanctions Hit',
    defaultMessage: 'CDD indicates sanctions hit and requires immediate escalation.',
  },
  ONB_PEP_HIT: {
    ruleCode: 'ONB_PEP_HIT',
    capCode: 'CAP-006',
    severity: ComplianceAlertSeverity.HIGH,
    title: 'Onboarding PEP Hit',
    defaultMessage: 'CDD indicates PEP hit and requires enhanced due diligence.',
  },
  ONB_CDD_REJECTED: {
    ruleCode: 'ONB_CDD_REJECTED',
    capCode: 'CAP-004',
    severity: ComplianceAlertSeverity.HIGH,
    title: 'CDD Case Rejected',
    defaultMessage: 'CDD case was rejected by compliance reviewer.',
  },
  ONB_EDD_REJECTED: {
    ruleCode: 'ONB_EDD_REJECTED',
    capCode: 'CAP-006',
    severity: ComplianceAlertSeverity.HIGH,
    title: 'EDD Case Rejected',
    defaultMessage: 'EDD case was rejected by MLRO review.',
  },
  ONB_FINAL_REJECTED: {
    ruleCode: 'ONB_FINAL_REJECTED',
    capCode: 'CAP-006',
    severity: ComplianceAlertSeverity.CRITICAL,
    title: 'Final Approval Rejected',
    defaultMessage: 'Customer final approval was rejected after EDD approval.',
  },
  ONB_COMPLIANCE_BLOCKED_OR_RESTRICTED: {
    ruleCode: 'ONB_COMPLIANCE_BLOCKED_OR_RESTRICTED',
    capCode: 'CAP-004',
    severity: ComplianceAlertSeverity.HIGH,
    title: 'Customer Compliance Restricted or Blocked',
    defaultMessage:
      'Customer compliance status changed to RESTRICTED or BLOCKED.',
  },
};

export function getComplianceAlertRule(
  ruleCode: string,
): ComplianceAlertRuleDefinition | null {
  return COMPLIANCE_ALERT_RULES[ruleCode] || null;
}
