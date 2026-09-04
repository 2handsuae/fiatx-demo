import { ConflictException } from '@nestjs/common';

export enum AssetAction {
  SUSPEND = 'SUSPEND',
  REACTIVATE = 'REACTIVATE',
}

/** 资产状态迁移表（法二）。波一：上架 / 激活整条路退役，只剩暂停与恢复两边（spec §3）。 */
export const ASSET_TRANSITIONS: Record<string, Partial<Record<AssetAction, string>>> = {
  ACTIVE:    { [AssetAction.SUSPEND]: 'SUSPENDED' },
  SUSPENDED: { [AssetAction.REACTIVATE]: 'ACTIVE' },
};

export function assertAssetTransition(from: string, action: AssetAction): string {
  const to = ASSET_TRANSITIONS[from]?.[action];
  if (!to) throw new ConflictException(`Invalid transition: asset in ${from} cannot ${action}`);
  return to;
}
