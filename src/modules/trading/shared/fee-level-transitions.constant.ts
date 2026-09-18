import { ConflictException } from '@nestjs/common';

export enum FeeLevelAction {
  APPROVE = 'APPROVE',
  DECLINE = 'DECLINE',
  CANCEL = 'CANCEL',   // 审批取消 / 超时都走这条边（CANCELLED）
  RETIRE = 'RETIRE',
}

/** 费率等级状态迁移表（两族共用，spec §7）。创建被拒不再物理删行；"删" = 退役终态。
 *  落地失败是故障路径：只留 *_APPLY_FAILED 审计，行停在 PENDING_APPROVAL，没有 FAILED 状态。 */
export const FEE_LEVEL_TRANSITIONS: Record<string, Partial<Record<FeeLevelAction, string>>> = {
  PENDING_APPROVAL: { [FeeLevelAction.APPROVE]: 'ACTIVE', [FeeLevelAction.DECLINE]: 'REJECTED', [FeeLevelAction.CANCEL]: 'CANCELLED' },
  ACTIVE:           { [FeeLevelAction.RETIRE]: 'RETIRED' },
  REJECTED:         {},
  CANCELLED:        {},
  RETIRED:          {},
};

export function assertFeeLevelTransition(from: string, action: FeeLevelAction): string {
  const to = FEE_LEVEL_TRANSITIONS[from]?.[action];
  if (!to) throw new ConflictException(`Invalid transition: fee level in ${from} cannot ${action}`);
  return to;
}

export enum FeeChangeRequestAction {
  APPROVE = 'APPROVE',
  DECLINE = 'DECLINE',
  CANCEL = 'CANCEL',
  EXPIRE = 'EXPIRE',
}

/** 变更请求单：四个终态各自分明（EXPIRED 单独一格，第七幕按单号查得到"时间到了没人批"） */
export const FEE_CHANGE_REQUEST_TRANSITIONS: Record<string, Partial<Record<FeeChangeRequestAction, string>>> = {
  PENDING_APPROVAL: {
    [FeeChangeRequestAction.APPROVE]: 'APPROVED',
    [FeeChangeRequestAction.DECLINE]: 'REJECTED',
    [FeeChangeRequestAction.CANCEL]: 'CANCELLED',
    [FeeChangeRequestAction.EXPIRE]: 'EXPIRED',
  },
  APPROVED: {},
  REJECTED: {},
  CANCELLED: {},
  EXPIRED: {},
};

export function assertFeeChangeRequestTransition(from: string, action: FeeChangeRequestAction): string {
  const to = FEE_CHANGE_REQUEST_TRANSITIONS[from]?.[action];
  if (!to) throw new ConflictException(`Invalid transition: fee level change request in ${from} cannot ${action}`);
  return to;
}
