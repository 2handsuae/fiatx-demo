const MAX_DECIMALS = 18;

export function normalizeDecimals(
  decimals?: number | null,
  fallback = 8,
): number {
  if (typeof decimals !== 'number' || !Number.isFinite(decimals)) {
    return fallback;
  }
  if (decimals < 0) return fallback;
  if (decimals > MAX_DECIMALS) return MAX_DECIMALS;
  return Math.floor(decimals);
}

export function formatAssetAmount(
  value: number | string | null | undefined,
  decimals?: number | null,
): string {
  if (value === null || value === undefined || value === '') return '-';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '-';
  const precision = normalizeDecimals(decimals, 8);
  return parsed.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

export function formatRate8(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '-';
  return parsed.toLocaleString('en-US', {
    minimumFractionDigits: 8,
    maximumFractionDigits: 8,
  });
}
