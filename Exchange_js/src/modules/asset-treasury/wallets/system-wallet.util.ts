import { buildDeterministicWalletNo } from '../../../common/utils/no-generator.util';

export type CryptoSystemWalletRole = 'MASTER' | 'PAYOUT' | 'LIQ';
export type FiatPoolWalletRole = 'CUST_BANK' | 'LIQ_BANK';

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

function resolveWalletRole(input: WalletRoleLike): string {
  if (typeof input === 'object' && input !== null) {
    return String(input.walletRole || '').toUpperCase();
  }

  const walletNo = String(input || '').toUpperCase();
  if (walletNo.startsWith('WA-MST-')) return 'MASTER';
  if (walletNo.startsWith('WA-PAY-')) return 'PAYOUT';
  if (walletNo.startsWith('WA-LIQ-')) return 'LIQ';
  if (walletNo.startsWith('WA-CBK-')) return 'CUST_BANK';
  if (walletNo.startsWith('WA-LBK-')) return 'LIQ_BANK';

  // Legacy fallback for historical SYS_* numbers.
  if (walletNo.startsWith('SYS_CUST_CRYPTO_MASTER_')) return 'MASTER';
  if (walletNo.startsWith('SYS_CUST_CRYPTO_PAYOUT_')) return 'PAYOUT';
  if (walletNo.startsWith('SYS_PLATFORM_CRYPTO_LIQ_')) return 'LIQ';
  if (walletNo.startsWith('SYS_CUST_BANK_')) return 'CUST_BANK';
  if (walletNo.startsWith('SYS_LIQ_BANK_')) return 'LIQ_BANK';

  return '';
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
