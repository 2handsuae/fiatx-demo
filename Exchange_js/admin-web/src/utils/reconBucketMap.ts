// admin-web/src/utils/reconBucketMap.ts
//
// Single source of truth for the Round3 five-bucket wallet classification
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
