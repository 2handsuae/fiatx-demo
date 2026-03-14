export const ChangeTicketStatuses = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVAL_PENDING: 'APPROVAL_PENDING',
  REJECTED: 'REJECTED',
  READY_FOR_DEPLOY: 'READY_FOR_DEPLOY',
  DEPLOYED: 'DEPLOYED',
  DEPLOY_FAILED: 'DEPLOY_FAILED',
  CLOSED: 'CLOSED',
} as const;

export const ChangeTicketTypes = {
  SYSTEM: 'SYSTEM',
  SECURITY: 'SECURITY',
  ACCESS_CONTROL: 'ACCESS_CONTROL',
  CONFIG: 'CONFIG',
  HOTFIX: 'HOTFIX',
  ACCOUNTING: 'ACCOUNTING',
} as const;

export const ChangeTicketReleaseEnvironments = {
  DEV: 'DEV',
  UAT: 'UAT',
  PROD: 'PROD',
} as const;

export const ChangeTicketGateRunStatuses = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
} as const;

export const ChangeTicketDeployStatuses = {
  DEPLOYED: 'DEPLOYED',
  DEPLOY_FAILED: 'DEPLOY_FAILED',
} as const;

export const ChangeTicketRiskLevels = {
  HIGH: 'HIGH',
} as const;

export const ChangeTicketWorkflowTypes = {
  CHANGE_TICKET: 'CHANGE_TICKET',
} as const;

export const ChangeTicketEvents = {
  DEPLOY_MARKED: 'governance.change-ticket.deploy-marked',
} as const;

export interface ChangeTicketDeployEvent {
  ticketId: string;
  ticketNo: string;
  traceId: string;
  status: string;
}

export const CHANGE_TICKET_STATUS_VALUES = Object.values(ChangeTicketStatuses);
export const CHANGE_TICKET_TYPE_VALUES = Object.values(ChangeTicketTypes);
export const CHANGE_TICKET_RELEASE_ENV_VALUES = Object.values(
  ChangeTicketReleaseEnvironments,
);
export const CHANGE_TICKET_GATE_RUN_STATUS_VALUES = Object.values(
  ChangeTicketGateRunStatuses,
);
export const CHANGE_TICKET_DEPLOY_STATUS_VALUES = Object.values(
  ChangeTicketDeployStatuses,
);
