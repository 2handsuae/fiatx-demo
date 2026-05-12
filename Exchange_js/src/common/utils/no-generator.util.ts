export function generateReferenceNo(prefix: string): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const random = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `${prefix}${year}${month}${day}${random}`;
}

const WALLET_ROLE_SEGMENT_MAP: Record<string, string> = {
  // V3 canonical role names
  C_DEP: 'DEP',
  C_VIBAN: 'VIB',
  C_MAIN: 'MST',
  C_OUT: 'PAY',
  C_CMA: 'CBK',
  F_LIQ: 'LIQ',
  F_OPS: 'GEN',
  // Legacy aliases (kept for backward-compatible walletNo generation)
  DEPOSIT: 'DEP',
  MASTER: 'MST',
  PAYOUT: 'PAY',
  LIQ: 'LIQ',
  CUST_BANK: 'CBK',
  LIQ_BANK: 'LBK',
  GENERAL: 'GEN',
};

function normalizeWalletSegment(value: string | null | undefined): string {
  const cleaned = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'NA';
}

function resolveWalletRoleSegment(
  walletRole: string | null | undefined,
): string {
  const normalizedRole = normalizeWalletSegment(
    walletRole || 'F_OPS',
  ).replace(/-/g, '_');
  return (
    WALLET_ROLE_SEGMENT_MAP[normalizedRole] || WALLET_ROLE_SEGMENT_MAP.F_OPS
  );
}

export function buildDeterministicWalletNo(
  walletRole: string,
  assetCode: string,
  network: string | null | undefined,
): string {
  const roleSegment = resolveWalletRoleSegment(walletRole);
  const assetSegment = normalizeWalletSegment(assetCode).replace(/-/g, '');
  const networkSegment = normalizeWalletSegment(network || 'NA').replace(
    /-/g,
    '',
  );
  return `WA-${roleSegment}-${assetSegment}-${networkSegment}`;
}

export function generateRandomWalletNo(
  walletRole: string,
  at: Date = new Date(),
): string {
  const roleSegment = resolveWalletRoleSegment(walletRole);
  const year = at.getFullYear().toString().slice(-2);
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `WA-${roleSegment}-${year}${month}${day}${random}`;
}
