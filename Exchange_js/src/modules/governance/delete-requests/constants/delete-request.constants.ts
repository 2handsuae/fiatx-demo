export const DeleteRequestStatuses = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVAL_PENDING: 'APPROVAL_PENDING',
  READY_TO_EXECUTE: 'READY_TO_EXECUTE',
  EXECUTED: 'EXECUTED',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;

export const DeleteRequestTargetTypes = {
  CHANGE_TICKET: 'CHANGE_TICKET',
  APPROVAL_CASE: 'APPROVAL_CASE',
  AUDIT_EVIDENCE_PACKAGE: 'AUDIT_EVIDENCE_PACKAGE',
} as const;

export const DeleteRequestWorkflowTypes = {
  DELETE_REQUEST: 'DELETE_REQUEST',
} as const;

export const DELETE_REQUEST_STATUS_VALUES = Object.values(DeleteRequestStatuses);
export const DELETE_REQUEST_TARGET_TYPE_VALUES = Object.values(DeleteRequestTargetTypes);

export const DeleteRequestActiveStatuses = [
  DeleteRequestStatuses.SUBMITTED,
  DeleteRequestStatuses.APPROVAL_PENDING,
  DeleteRequestStatuses.READY_TO_EXECUTE,
] as const;
