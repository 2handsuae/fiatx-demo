import { WalletRole } from './dto/wallet.dto';

export interface WalletRolePolicy {
  maxPerOwnerPerAsset: number;
  allowedOwnerTypes: readonly string[];
  allowedAssetTypes: readonly string[];
  requiresCustodian: boolean;
}

export const WALLET_ROLE_POLICIES: Record<string, WalletRolePolicy> = {
  [WalletRole.C_DEP]: {
    maxPerOwnerPerAsset: 1,
    allowedOwnerTypes: ['CUSTOMER'],
    allowedAssetTypes: ['CRYPTO'],
    requiresCustodian: true,
  },
  [WalletRole.C_VIBAN]: {
    maxPerOwnerPerAsset: 1,
    allowedOwnerTypes: ['CUSTOMER'],
    allowedAssetTypes: ['FIAT'],
    requiresCustodian: true,
  },
  [WalletRole.C_MAIN]: {
    maxPerOwnerPerAsset: Infinity,
    allowedOwnerTypes: ['PLATFORM'],
    allowedAssetTypes: ['CRYPTO'],
    requiresCustodian: true,
  },
  [WalletRole.C_OUT]: {
    maxPerOwnerPerAsset: Infinity,
    allowedOwnerTypes: ['PLATFORM'],
    allowedAssetTypes: ['CRYPTO'],
    requiresCustodian: true,
  },
  [WalletRole.C_CMA]: {
    maxPerOwnerPerAsset: Infinity,
    allowedOwnerTypes: ['PLATFORM'],
    allowedAssetTypes: ['FIAT'],
    requiresCustodian: true,
  },
  [WalletRole.F_LIQ]: {
    maxPerOwnerPerAsset: Infinity,
    allowedOwnerTypes: ['PLATFORM'],
    allowedAssetTypes: ['CRYPTO', 'FIAT'],
    requiresCustodian: true,
  },
  [WalletRole.F_OPS]: {
    maxPerOwnerPerAsset: Infinity,
    allowedOwnerTypes: ['PLATFORM'],
    allowedAssetTypes: ['CRYPTO', 'FIAT'],
    requiresCustodian: true,
  },
  [WalletRole.F_SET]: {
    maxPerOwnerPerAsset: Infinity,
    allowedOwnerTypes: ['PLATFORM'],
    allowedAssetTypes: ['FIAT'],
    requiresCustodian: true,
  },
  [WalletRole.F_FEE]: {
    maxPerOwnerPerAsset: Infinity,
    allowedOwnerTypes: ['PLATFORM'],
    allowedAssetTypes: ['FIAT'],
    requiresCustodian: true,
  },
};

export function getWalletRolePolicy(role: string): WalletRolePolicy | undefined {
  return WALLET_ROLE_POLICIES[role];
}
