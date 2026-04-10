export type Stage = 'FRESH' | 'NOTIFIED' | 'URGENT' | 'BLOCKING' | 'GRACE_EXPIRED';

export function computeStage(daysFromExpiry: number): Stage {
  if (daysFromExpiry > 30) return 'FRESH';
  if (daysFromExpiry > 7) return 'NOTIFIED';
  if (daysFromExpiry > 0) return 'URGENT';
  if (daysFromExpiry > -30) return 'BLOCKING';
  return 'GRACE_EXPIRED';
}
