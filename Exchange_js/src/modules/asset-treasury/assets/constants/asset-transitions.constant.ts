import { ConflictException } from '@nestjs/common';

export enum AssetAction {
  ACTIVATE = 'ACTIVATE',
  SUSPEND = 'SUSPEND',
  REACTIVATE = 'REACTIVATE',
}

/** 资产状态迁移表（法二）。此前三处散落 if 守，无单一真相处（铁律④）。 */
export const ASSET_TRANSITIONS: Record<string, Partial<Record<AssetAction, string>>> = {
  PROVISIONING: { [AssetAction.ACTIVATE]: 'ACTIVE' },
  ACTIVE:       { [AssetAction.SUSPEND]: 'SUSPENDED' },
  SUSPENDED:    { [AssetAction.REACTIVATE]: 'ACTIVE' },
};

export function assertAssetTransition(from: string, action: AssetAction): string {
  const to = ASSET_TRANSITIONS[from]?.[action];
  if (!to) throw new ConflictException(`Invalid transition: asset in ${from} cannot ${action}`);
  return to;
}
