// admin-web/src/utils/reconBucketMap.ts
//
// Single source of truth for the Round3 four-bucket wallet classification
// labels (MATCHED excluded from "needs attention"; IN_TRANSIT/COMPENSATING/BREAK
// are the three that can open a Case). Authoritative bucket enum:
// ReconWalletBucket in src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts.

export type ReconBucket = 'MATCHED' | 'IN_TRANSIT' | 'COMPENSATING' | 'BREAK';

export const BUCKET_LABELS: Record<ReconBucket, { en: string; tone: 'green' | 'blue' | 'amber' | 'red' }> = {
  MATCHED:      { en: 'Matched',      tone: 'green' },
  IN_TRANSIT:   { en: 'In-transit',   tone: 'blue'  },
  COMPENSATING: { en: 'Compensating', tone: 'amber' },
  BREAK:        { en: 'Break',        tone: 'red'   },
};

export function formatBucket(bucket: ReconBucket): string {
  return BUCKET_LABELS[bucket].en;
}

// adm-* tone tokens for the four bucket tones (BUCKET_LABELS[].tone), shared
// by the Health Check cards and the table's status badge — single mapping so
// card colour and badge colour never drift apart.
export const TONE_CLASSES: Record<'green' | 'blue' | 'amber' | 'red', { border: string; bg: string; text: string }> = {
  green: { border: 'border-adm-green/30', bg: 'bg-adm-green/10', text: 'text-adm-green' },
  blue:  { border: 'border-adm-blue/30',  bg: 'bg-adm-blue/10',  text: 'text-adm-blue' },
  amber: { border: 'border-adm-amber/30', bg: 'bg-adm-amber/10', text: 'text-adm-amber' },
  red:   { border: 'border-adm-red/30',   bg: 'bg-adm-red/10',   text: 'text-adm-red' },
};
