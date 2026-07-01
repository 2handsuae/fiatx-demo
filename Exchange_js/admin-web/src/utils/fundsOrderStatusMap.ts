// admin-web/src/utils/fundsOrderStatusMap.ts
//
// Unified bilingual status labels for the funds-orders admin surface (C6).
// Authoritative source: FundsOrderStatus enum in
// src/modules/funds-orders/dto/funds-order.dto.ts and Round 2 spec §3.
//
// The only asset-type-dependent labels are:
//   - SUBMITTED  → crypto "Broadcasted" (on-chain) vs fiat "Processing" (bank)
//   - CONFIRMED  → crypto "Confirmed"   vs fiat "Settled" (funds landed)
// Everything else is asset-agnostic.

export type FundsOrderLang = 'en' | 'zh';
type AssetType = string | null | undefined;

interface Label {
  en: string;
  zh: string;
}

const isFiat = (assetType: AssetType): boolean =>
  String(assetType || '').toUpperCase() === 'FIAT';

const BASE_LABELS: Record<string, Label> = {
  CREATED: { en: 'Created', zh: '已建单' },
  CONFIRMING: { en: 'Confirming', zh: '确认中' },
  CLEARED: { en: 'Cleared', zh: '已完成' },
  FAILED: { en: 'Failed', zh: '失败' },
  TIMEOUT: { en: 'Timeout', zh: '超时' },
};

/**
 * Bilingual, asset-type-aware label for a funds_order status.
 * Falls back to the raw status when unknown so nothing silently blanks.
 */
export function formatFundsOrderStatusLabel(
  status: string,
  assetType: AssetType,
  lang: FundsOrderLang = 'en',
): string {
  const s = String(status || '').toUpperCase();
  const fiat = isFiat(assetType);

  let label: Label;
  if (s === 'SUBMITTED') {
    label = fiat
      ? { en: 'Processing', zh: '处理中' }
      : { en: 'Broadcasted', zh: '已广播' };
  } else if (s === 'CONFIRMED') {
    label = fiat
      ? { en: 'Settled', zh: '已到账' }
      : { en: 'Confirmed', zh: '已确认' };
  } else {
    label = BASE_LABELS[s] ?? { en: s || '—', zh: s || '—' };
  }

  return label[lang];
}

/**
 * Combined "En / 中文" label for compact table/badge display where both
 * languages are shown at once.
 */
export function formatFundsOrderStatusBilingual(
  status: string,
  assetType: AssetType,
): string {
  const en = formatFundsOrderStatusLabel(status, assetType, 'en');
  const zh = formatFundsOrderStatusLabel(status, assetType, 'zh');
  return en === zh ? en : `${en} / ${zh}`;
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
