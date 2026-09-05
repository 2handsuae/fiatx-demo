// 平账二期：内部划转单的状态 / 用途人话。唯一真相在后端 dto/internal-transfer.dto.ts，这里只是展示词。
export const INTERNAL_TRANSFER_STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: '待 CFO 复核',
  EXECUTING: '执行中 · 钱在路上',
  SUCCESS: '已到账',
  FAILED: '失败',
  REJECTED: '已拒绝',
  CANCELLED: '已撤回',
};

export const INTERNAL_TRANSFER_PURPOSE_LABEL: Record<string, string> = {
  CLIENT_COMPENSATION: '补款 · 认损后公司补齐',
  CLIENT_ADVANCE: '垫款 · 退汇差额先垫后扣',
};

export const INTERNAL_TRANSFER_STATUSES = [
  'PENDING_APPROVAL',
  'EXECUTING',
  'SUCCESS',
  'FAILED',
  'REJECTED',
  'CANCELLED',
] as const;
