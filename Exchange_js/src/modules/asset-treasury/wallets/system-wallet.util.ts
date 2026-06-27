import { WalletRole } from './dto/wallet.dto';

// Realtime 1:1 mirror model: customer crypto withdrawals source funds directly
// from the customer's own C_DEP wallet (the deposit address that received the
// funds). The legacy C_MAIN/C_OUT platform pool was V7 collect-then-pay-out
// and is no longer provisioned. The enum entries (C_MAIN/C_OUT in WalletRole)
// stay defined so dead-code references compile until Phase C cleanup.
export const CRYPTO_SYSTEM_WALLET_ROLES: WalletRole[] = [
  WalletRole.F_LIQ, WalletRole.F_OPS, WalletRole.F_FEE,
];

export const FIAT_SYSTEM_WALLET_ROLES: WalletRole[] = [
  WalletRole.C_CMA, WalletRole.F_SET, WalletRole.F_FEE, WalletRole.F_OPS, WalletRole.F_LIQ,
];

export const PROTECTED_SYSTEM_WALLET_ROLES: ReadonlySet<string> = new Set([
  ...CRYPTO_SYSTEM_WALLET_ROLES, ...FIAT_SYSTEM_WALLET_ROLES,
]);

export const CUSTOMER_POOL_ROLES: ReadonlySet<string> = new Set([
  WalletRole.C_MAIN, WalletRole.C_OUT, WalletRole.C_CMA,
]);

export const PLATFORM_POOL_ROLES: ReadonlySet<string> = new Set([
  WalletRole.F_LIQ, WalletRole.F_OPS, WalletRole.F_SET, WalletRole.F_FEE,
]);

export enum WalletSurfaceCategory {
  CUSTOMER_POOL = 'CUSTOMER_POOL',
  PLATFORM_POOL = 'PLATFORM_POOL',
  CUSTOMER_DEPOSIT = 'CUSTOMER_DEPOSIT',
  CUSTOMER_PAYOUT_TARGET = 'CUSTOMER_PAYOUT_TARGET',
  LIQUIDITY_PROVIDER_ACCOUNT = 'LIQUIDITY_PROVIDER_ACCOUNT',
  OTHER = 'OTHER',
}

export function isProtectedSystemWalletRole(role: string): boolean {
  return PROTECTED_SYSTEM_WALLET_ROLES.has(role);
}

export function classifyWalletSurface(wallet: {
  walletRole: string;
  ownerType: string;
}): WalletSurfaceCategory {
  if (wallet.ownerType === 'LIQUIDITY_PROVIDER') {
    return WalletSurfaceCategory.LIQUIDITY_PROVIDER_ACCOUNT;
  }
  if (wallet.ownerType === 'CUSTOMER') {
    if (wallet.walletRole === WalletRole.C_DEP || wallet.walletRole === WalletRole.C_VIBAN) {
      return WalletSurfaceCategory.CUSTOMER_DEPOSIT;
    }
    return WalletSurfaceCategory.OTHER;
  }
  if (CUSTOMER_POOL_ROLES.has(wallet.walletRole)) {
    return WalletSurfaceCategory.CUSTOMER_POOL;
  }
  if (PLATFORM_POOL_ROLES.has(wallet.walletRole)) {
    return WalletSurfaceCategory.PLATFORM_POOL;
  }
  return WalletSurfaceCategory.OTHER;
}
