// 调账单 4 态迁移表（spec §6.3）。POSTED / REJECTED 终态——账本只进不出，
// 开错了只能再开一张反向单，不能撤销。
export const AdjustmentStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  POSTED: 'POSTED',
  REJECTED: 'REJECTED',
} as const;

export type AdjustmentStatusValue = (typeof AdjustmentStatus)[keyof typeof AdjustmentStatus];

export const ADJUSTMENT_TRANSITIONS: Record<string, string[]> = {
  [AdjustmentStatus.DRAFT]: [AdjustmentStatus.PENDING_APPROVAL],
  [AdjustmentStatus.PENDING_APPROVAL]: [AdjustmentStatus.POSTED, AdjustmentStatus.REJECTED],
  [AdjustmentStatus.POSTED]: [],
  [AdjustmentStatus.REJECTED]: [],
};
