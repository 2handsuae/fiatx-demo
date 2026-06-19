// Asia/Dubai is UTC+4 year-round (no DST), so a fixed offset is exact and matches
// the EOD cron's `timeZone: 'Asia/Dubai'`.
export const EOD_OFFSET_MS = 4 * 60 * 60 * 1000;

/**
 * The EOD cutoff = start of `now`'s calendar day in Asia/Dubai, returned as the
 * equivalent UTC instant. EOD selects rows with `createdAt < cutoff` (half-open:
 * a row at exactly the cutoff belongs to the next day).
 */
export function resolveEodCutoff(now: Date): Date {
  const dubaiMs = now.getTime() + EOD_OFFSET_MS;
  const midnightDubaiMs = Math.floor(dubaiMs / 86_400_000) * 86_400_000;
  return new Date(midnightDubaiMs - EOD_OFFSET_MS);
}
