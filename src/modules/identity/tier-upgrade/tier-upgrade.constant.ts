import { BadRequestException } from '@nestjs/common';

/**
 * 升级申请单状态机 —— 4 态 4 边，唯一真相源（铁律④）。
 * RED-RETRY 不是边：停留 IN_REVIEW、清 materialsSubmittedAt 重开会话（spec §4）。
 * 「审批中」不是状态：从关联审批单推导展示（波二教义）。
 */
export type TierUpgradeStatus = 'IN_REVIEW' | 'MATERIALS_CLEARED' | 'APPROVED' | 'REJECTED';

export const TIER_UPGRADE_TRANSITIONS: Record<TierUpgradeStatus, TierUpgradeStatus[]> = {
  IN_REVIEW: ['MATERIALS_CLEARED', 'REJECTED'], // GREEN ｜ RED-FINAL
  MATERIALS_CLEARED: ['APPROVED', 'REJECTED'],  // 高管批 ｜ 高管否
  APPROVED: [],
  REJECTED: [],
};

export function assertTierUpgradeTransition(from: TierUpgradeStatus, to: TierUpgradeStatus): void {
  if (!TIER_UPGRADE_TRANSITIONS[from]?.includes(to)) {
    throw new BadRequestException(`Illegal tier-upgrade transition: ${from} -> ${to}`);
  }
}
