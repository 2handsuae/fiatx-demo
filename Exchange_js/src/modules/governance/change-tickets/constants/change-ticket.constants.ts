export const ChangeTicketStatuses = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  READY: 'READY',
  DONE: 'DONE',
  FAILED: 'FAILED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;

export const ChangeTicketTypes = {
  ADMIN_ACCESS_CHANGE: 'ADMIN_ACCESS_CHANGE',
  RBAC_CATALOG_CHANGE: 'RBAC_CATALOG_CHANGE',
} as const;

export const CHANGE_TICKET_STATUS_VALUES = Object.values(ChangeTicketStatuses);
export const CHANGE_TICKET_TYPE_VALUES = Object.values(ChangeTicketTypes);
