const TRANSACTION_ROOT_STATUS_LABELS: Record<string, string> = {
  PAYIN_PENDING: 'Payin Pending',
  COMPLIANCE_PENDING: 'Compliance Pending',
  ACTION_PENDING: 'Action Pending',
  PAYOUT_PENDING: 'Payout Pending',
  SEEN_IN_MEMPOOL: 'Seen In Mempool',
};

const COMPLIANCE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  HOLD: 'Hold',
  CLEAR: 'Clear',
  REJECT: 'Reject',
};

const RESPONSE_LIFECYCLE_LABELS: Record<string, string> = {
  CREATED: 'CREATED',
  RECEIVED: 'RECEIVED',
  FINAL: 'FINAL',
};

const RESPONSE_LIFECYCLE_BADGES: Record<string, string> = {
  CREATED: 'bg-gray-100 text-gray-700',
  RECEIVED: 'bg-yellow-100 text-yellow-800',
  FINAL: 'bg-green-100 text-green-800',
};

const LEGACY_WITHDRAW_STATUS_SET = new Set(['CREATED', 'APPROVED', 'HELD']);

export const formatStatusLabel = (status?: string | null): string => {
  const normalized = String(status || '').trim();
  if (!normalized) return 'N/A';

  const upper = normalized.toUpperCase();
  if (TRANSACTION_ROOT_STATUS_LABELS[upper]) {
    return TRANSACTION_ROOT_STATUS_LABELS[upper];
  }

  return upper
    .split('_')
    .filter(Boolean)
    .map((segment) => segment.charAt(0) + segment.slice(1).toLowerCase())
    .join(' ');
};

export const formatDerivedComplianceStatusLabel = (
  status?: string | null,
): string => {
  const normalized = String(status || 'PENDING').trim().toUpperCase();
  return COMPLIANCE_STATUS_LABELS[normalized] || formatStatusLabel(normalized);
};

export const formatTransactionTypeLabel = (type?: string | null): string => {
  const normalized = String(type || '').trim().toUpperCase();
  if (normalized === 'CRYPTO') return 'CRYPTO';
  if (normalized === 'FIAT') return 'FIAT';
  return normalized || 'N/A';
};

export const normalizeRailDisplayStatus = (
  status?: string | null,
): string => {
  const normalized = String(status || '').trim().toUpperCase();
  if (!normalized) return '';
  if (normalized === 'CLEAR') return 'CLEARED';
  return normalized;
};

export const formatRailStatusLabel = (status?: string | null): string => {
  const normalized = normalizeRailDisplayStatus(status);
  return normalized ? formatStatusLabel(normalized) : 'N/A';
};

export const isLegacyWithdrawStatus = (status?: string | null): boolean => {
  const normalized = String(status || '').trim().toUpperCase();
  return LEGACY_WITHDRAW_STATUS_SET.has(normalized);
};

export const normalizeResponseLifecycle = (
  status?: string | null,
): string => {
  const normalized = String(status || '').trim().toUpperCase();
  if (!normalized) return '';
  if (normalized === 'CREATED') return 'CREATED';
  if (['RECEIVED', 'SENT', 'PENDING'].includes(normalized)) return 'RECEIVED';
  return 'FINAL';
};

export const formatResponseLifecycleLabel = (
  status?: string | null,
  options?: { missingLabel?: string },
): string => {
  const normalized = normalizeResponseLifecycle(status);
  if (!normalized) {
    return options?.missingLabel || 'N/A';
  }
  return RESPONSE_LIFECYCLE_LABELS[normalized] || normalized;
};

export const getResponseLifecycleBadgeClass = (
  status?: string | null,
): string => {
  const normalized = normalizeResponseLifecycle(status);
  if (!normalized) return 'bg-gray-100 text-gray-700';
  return RESPONSE_LIFECYCLE_BADGES[normalized] || 'bg-gray-100 text-gray-700';
};
