import { buildDeterministicWalletNo } from '../../../common/utils/no-generator.util';

export type CryptoSystemWalletRole = 'MASTER' | 'PAYOUT' | 'LIQ';
export type FiatPoolWalletRole = 'CUST_BANK' | 'LIQ_BANK';
export type ProtectedPoolWalletRole =
  | CryptoSystemWalletRole
  | FiatPoolWalletRole;

export const CUSTOMER_POOL_WALLET_ROLES = [
  'MASTER',
  'PAYOUT',
  'CUST_BANK',
] as const;
export const PLATFORM_POOL_WALLET_ROLES = ['LIQ', 'LIQ_BANK'] as const;
export const PROTECTED_POOL_WALLET_ROLES = [
  ...CUSTOMER_POOL_WALLET_ROLES,
  ...PLATFORM_POOL_WALLET_ROLES,
] as const;
const CUSTOMER_POOL_WALLET_ROLE_SET = new Set<string>(CUSTOMER_POOL_WALLET_ROLES);
const PLATFORM_POOL_WALLET_ROLE_SET = new Set<string>(PLATFORM_POOL_WALLET_ROLES);
const PROTECTED_POOL_WALLET_ROLE_SET = new Set<string>(PROTECTED_POOL_WALLET_ROLES);

export type WalletSurfaceCategory =
  | 'CUSTOMER_POOL'
  | 'PLATFORM_POOL'
  | 'CUSTOMER_DEPOSIT'
  | 'CUSTOMER_PAYOUT_TARGET'
  | 'LIQUIDITY_PROVIDER_ACCOUNT'
  | 'OTHER';

export function buildCryptoSystemWalletNo(
  role: CryptoSystemWalletRole,
  assetCode: string,
  network: string | null | undefined,
) {
  return buildDeterministicWalletNo(role, assetCode, network || 'NA');
}

export function buildFiatPoolWalletNo(
  role: FiatPoolWalletRole,
  assetCode: string,
) {
  return buildDeterministicWalletNo(role, assetCode, 'NA');
}

type WalletRoleLike =
  | string
  | null
  | undefined
  | { walletRole?: string | null };

type WalletSurfaceLike = {
  ownerType?: string | null;
  ownerId?: string | null;
  ownerNo?: string | null;
  direction?: string | null;
  walletRole?: string | null;
};

function resolveWalletRole(input: WalletRoleLike): string {
  if (typeof input === 'object' && input !== null) {
    return String(input.walletRole || '').toUpperCase();
  }

  const walletNo = String(input || '').trim().toUpperCase();
  if (
    PROTECTED_POOL_WALLET_ROLE_SET.has(walletNo)
  ) {
    return walletNo;
  }
  if (walletNo.startsWith('WA-MST-')) return 'MASTER';
  if (walletNo.startsWith('WA-PAY-')) return 'PAYOUT';
  if (walletNo.startsWith('WA-LIQ-')) return 'LIQ';
  if (walletNo.startsWith('WA-CBK-')) return 'CUST_BANK';
  if (walletNo.startsWith('WA-LBK-')) return 'LIQ_BANK';

  return '';
}

export function isProtectedPoolWalletRole(
  walletRole: string | null | undefined,
): walletRole is ProtectedPoolWalletRole {
  const resolved = resolveWalletRole(walletRole);
  return PROTECTED_POOL_WALLET_ROLE_SET.has(resolved);
}

export function classifyWalletSurface(
  wallet: WalletSurfaceLike,
): WalletSurfaceCategory {
  const role = resolveWalletRole(wallet);

  if (
    wallet.ownerType === 'CUSTOMER' &&
    wallet.ownerId == null &&
    wallet.ownerNo === 'CUSTOMER_POOL' &&
    CUSTOMER_POOL_WALLET_ROLE_SET.has(role)
  ) {
    return 'CUSTOMER_POOL';
  }

  if (
    wallet.ownerType === 'PLATFORM' &&
    wallet.ownerId == null &&
    wallet.ownerNo === 'PLATFORM' &&
    PLATFORM_POOL_WALLET_ROLE_SET.has(role)
  ) {
    return 'PLATFORM_POOL';
  }

  if (
    wallet.ownerType === 'CUSTOMER' &&
    typeof wallet.ownerId === 'string' &&
    wallet.direction === 'INBOUND' &&
    role === 'DEPOSIT'
  ) {
    return 'CUSTOMER_DEPOSIT';
  }

  if (
    wallet.ownerType === 'CUSTOMER' &&
    typeof wallet.ownerId === 'string' &&
    wallet.direction === 'OUTBOUND' &&
    (role === 'GENERAL' || role === '')
  ) {
    return 'CUSTOMER_PAYOUT_TARGET';
  }

  if (wallet.ownerType === 'LIQUIDITY_PROVIDER') {
    return 'LIQUIDITY_PROVIDER_ACCOUNT';
  }

  return 'OTHER';
}

export function isCryptoMasterWalletNo(wallet: WalletRoleLike) {
  return resolveWalletRole(wallet) === 'MASTER';
}

export function isCryptoLiqWalletNo(wallet: WalletRoleLike) {
  return resolveWalletRole(wallet) === 'LIQ';
}

export function isCryptoPayoutWalletNo(wallet: WalletRoleLike) {
  return resolveWalletRole(wallet) === 'PAYOUT';
}
