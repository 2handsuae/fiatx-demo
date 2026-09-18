import { BadRequestException } from '@nestjs/common';
import { assertTierUpgradeTransition, TIER_UPGRADE_TRANSITIONS } from './tier-upgrade.constant';

describe('tier-upgrade 迁移表（4 态 4 边，铁律④）', () => {
  it.each([
    ['IN_REVIEW', 'MATERIALS_CLEARED'],
    ['IN_REVIEW', 'REJECTED'],
    ['MATERIALS_CLEARED', 'APPROVED'],
    ['MATERIALS_CLEARED', 'REJECTED'],
  ] as const)('合法边 %s → %s 放行', (from, to) => {
    expect(() => assertTierUpgradeTransition(from, to)).not.toThrow();
  });

  it.each([
    ['APPROVED', 'REJECTED'],   // 终态零出边
    ['REJECTED', 'IN_REVIEW'],  // 被拒不复活——再申请开新单
    ['IN_REVIEW', 'APPROVED'],  // 不许跳过材料审
    ['MATERIALS_CLEARED', 'IN_REVIEW'], // 不回头
  ] as const)('非法边 %s → %s 显式拒', (from, to) => {
    expect(() => assertTierUpgradeTransition(from as any, to as any)).toThrow(BadRequestException);
  });

  it('恰好 4 条边（防边表悄悄长草）', () => {
    expect(Object.values(TIER_UPGRADE_TRANSITIONS).flat()).toHaveLength(4);
  });
});
