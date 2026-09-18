/**
 * Friendly text for transaction-limit gate rejections.
 *
 * The backend gate throws `BadRequestException({ code, ruleNo, ...context })`, so
 * the HTTP error body carries the machine `code` plus the context fields each
 * message needs (see transaction-limit-gate.service.ts).
 */
export const LIMIT_ERROR_TEXT: Record<string, (d: any) => string> = {
  TRANSACTION_LIMIT_BELOW_MIN: (d) => `Amount below minimum (${d.minAmount} ${d.assetCode})`,
  TRANSACTION_LIMIT_ABOVE_MAX: (d) => `Amount exceeds maximum (${d.maxAmount} ${d.assetCode})`,
  TRANSACTION_LIMIT_CUMULATIVE_EXCEEDED: (d) =>
    `${d.period === 'DAILY' ? 'Daily' : 'Monthly'} limit exceeded — remaining ${d.remainingAed} AED`,
  TRANSACTION_LIMIT_UNPRICEABLE: () => 'Pricing temporarily unavailable, please retry later',
};

/** 超限两码给升级 CTA（spec §8）；BELOW_MIN/UNPRICEABLE 提示条无 CTA；非限额码走 alert 原路。 */
export const TIER_UPGRADE_HINT_CODES = new Set([
  'TRANSACTION_LIMIT_ABOVE_MAX',
  'TRANSACTION_LIMIT_CUMULATIVE_EXCEEDED',
]);

/**
 * Resolve a submit-error `Response` into user-facing text plus the limit
 * `code` when the body carries a known one, so the caller can render an
 * inline banner (with an upgrade hint for the two over-limit codes) instead
 * of falling back to a plain alert.
 */
export const resolveSubmitErrorInfo = async (
  response: Response,
  fallback = 'Request failed.',
): Promise<{ message: string; limitCode: string | null }> => {
  let payload: Record<string, unknown> = {};
  try {
    const json = await response.clone().json();
    if (json && typeof json === 'object') payload = json as Record<string, unknown>;
  } catch {
    /* body not JSON — fall through to fallback */
  }
  const code = typeof payload.code === 'string' ? payload.code : undefined;
  if (code && LIMIT_ERROR_TEXT[code]) return { message: LIMIT_ERROR_TEXT[code](payload), limitCode: code };
  const message = typeof payload.message === 'string' && payload.message.trim() ? payload.message : fallback;
  return { message, limitCode: null };
};
