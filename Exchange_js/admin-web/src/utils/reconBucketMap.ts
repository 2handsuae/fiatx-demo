// admin-web/src/utils/reconBucketMap.ts
//
// Single source of truth for the Round3 five-bucket wallet classification
// labels (MATCHED excluded from "needs attention"; IN_TRANSIT/SOFT_FLAG/BREAK
// are the three that can open a Case). Authoritative bucket enum:
// ReconWalletBucket in src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts.

export type ReconBucket = 'MATCHED' | 'IN_TRANSIT' | 'SOFT_FLAG' | 'BREAK';

export const BUCKET_LABELS: Record<ReconBucket, { en: string; zh: string; tone: 'green' | 'blue' | 'amber' | 'red' }> = {
  MATCHED:    { en: 'Matched',    zh: '已匹配', tone: 'green' },
  IN_TRANSIT: { en: 'In-transit', zh: '在途',   tone: 'blue'  },
  SOFT_FLAG:  { en: 'Soft flag',  zh: '软标',   tone: 'amber' },
  BREAK:      { en: 'Break',      zh: '硬断',   tone: 'red'   },
};

export function formatBucketBilingual(bucket: ReconBucket): string {
  const l = BUCKET_LABELS[bucket];
  return `${l.en} / ${l.zh}`;
}
