import { WalletRole } from './dto/wallet.dto';
import type { NetworkKind } from '../../../config/manifests/networks.manifest';

/** 平台侧钱包角色 = vault 码本身（F_*）；四个 vault 在 vaults.manifest.ts 定义 */
export const PLATFORM_WALLET_ROLES: ReadonlySet<string> = new Set([
  WalletRole.F_OPS, WalletRole.F_SET, WalletRole.F_FEE, WalletRole.F_LIQ,
]);

/** 客户收款账户角色（CLIENT_DEPOSIT vault 下的行） */
export const CUSTOMER_DEPOSIT_ROLES: ReadonlySet<string> = new Set([
  WalletRole.C_DEP, WalletRole.C_VIBAN,
]);

export function isPlatformWalletRole(role: string): boolean {
  return PLATFORM_WALLET_ROLES.has(role);
}

/** 客户充值地址的角色由网络种类决定：链上 C_DEP，银行通道 C_VIBAN */
export function customerRoleForNetworkKind(kind: NetworkKind): WalletRole {
  return kind === 'CHAIN' ? WalletRole.C_DEP : WalletRole.C_VIBAN;
}
