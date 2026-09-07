// 平账二期：内部划转单的状态 / 用途人话。唯一真相在后端 dto/internal-transfer.dto.ts，这里只是展示词。
export const INTERNAL_TRANSFER_STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: 'Pending CFO review',
  EXECUTING: 'Executing · funds in transit',
  SUCCESS: 'Received',
  FAILED: 'Failed',
  REJECTED: 'Rejected',
  CANCELLED: 'Withdrawn',
};

export const INTERNAL_TRANSFER_PURPOSE_LABEL: Record<string, string> = {
  CLIENT_COMPENSATION: 'Compensation · firm tops up after loss recognition',
  CLIENT_ADVANCE: 'Advance · fronts the recall shortfall, recovered later',
};

export const INTERNAL_TRANSFER_STATUSES = [
  'PENDING_APPROVAL',
  'EXECUTING',
  'SUCCESS',
  'FAILED',
  'REJECTED',
  'CANCELLED',
] as const;
