// admin-web/src/utils/fundsOrderStatusMap.ts
//
// Unified status labels for the funds-orders admin surface (C6).
// Authoritative source: FundsOrderStatus enum in
// src/modules/funds-orders/dto/funds-order.dto.ts and Round 2 spec §3.
//
// The only asset-type-dependent labels are:
//   - SUBMITTED  → crypto "Broadcasted" (on-chain) vs fiat "Processing" (bank)
//   - CONFIRMED  → crypto "Confirmed"   vs fiat "Settled" (funds landed)
// Everything else is asset-agnostic.

type AssetType = string | null | undefined;

const isFiat = (assetType: AssetType): boolean =>
  String(assetType || '').toUpperCase() === 'FIAT';

const BASE_LABELS: Record<string, string> = {
  CREATED: 'Created',
  CONFIRMING: 'Confirming',
  CLEARED: 'Cleared',
  FAILED: 'Failed',
  TIMEOUT: 'Timeout',
};

/**
 * Asset-type-aware label for a funds_order status.
 * Falls back to the raw status when unknown so nothing silently blanks.
 */
export function formatFundsOrderStatusLabel(
  status: string,
  assetType: AssetType,
): string {
  const s = String(status || '').toUpperCase();
  const fiat = isFiat(assetType);

  if (s === 'SUBMITTED') return fiat ? 'Processing' : 'Broadcasted';
  if (s === 'CONFIRMED') return fiat ? 'Settled' : 'Confirmed';
  return BASE_LABELS[s] ?? (s || '—');
}

/* ── Badge color tokens (adm-*) ─────────────────────────────────── */

const BADGE_TONE: Record<string, string> = {
  CREATED: 'border-adm-border text-adm-t2',
  SUBMITTED: 'border-adm-amber/40 text-adm-amber',
  CONFIRMING: 'border-adm-amber/40 text-adm-amber',
  CONFIRMED: 'border-adm-green/40 text-adm-green',
  CLEARED: 'border-adm-green/50 text-adm-green',
  FAILED: 'border-adm-red/40 text-adm-red',
  TIMEOUT: 'border-adm-red/40 text-adm-red',
};

export function getFundsOrderStatusTone(status: string): string {
  return (
    BADGE_TONE[String(status || '').toUpperCase()] ??
    'border-adm-border text-adm-t3'
  );
}
