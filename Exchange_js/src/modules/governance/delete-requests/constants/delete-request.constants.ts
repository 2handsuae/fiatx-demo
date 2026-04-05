export const DeleteRequestStatuses = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  READY: 'READY',
  DONE: 'DONE',
  FAILED: 'FAILED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;

export const DeleteRequestTargetTypes = {
  CHANGE_TICKET: 'CHANGE_TICKET',
  AUDIT_EVIDENCE_PACKAGE: 'AUDIT_EVIDENCE_PACKAGE',
  ADMIN_USER: 'ADMIN_USER',
} as const;

export const DELETE_REQUEST_STATUS_VALUES = Object.values(DeleteRequestStatuses);
export const DELETE_REQUEST_TARGET_TYPE_VALUES = Object.values(DeleteRequestTargetTypes);

export const DeleteRequestActiveStatuses = [
  DeleteRequestStatuses.PENDING_APPROVAL,
  DeleteRequestStatuses.READY,
] as const;
