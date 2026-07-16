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

/**
 * Resolve a submit-error `Response` into user-facing text: a friendly limit
 * message when the body carries a known limit `code`, otherwise the backend
 * `message`, otherwise the caller's fallback.
 */
export const resolveSubmitErrorMessage = async (
  response: Response,
  fallback = 'Request failed.',
): Promise<string> => {
  let payload: Record<string, unknown> = {};
  try {
    const json = await response.clone().json();
    if (json && typeof json === 'object') payload = json as Record<string, unknown>;
  } catch {
    /* body not JSON — fall through to fallback */
  }

  const code = typeof payload.code === 'string' ? payload.code : undefined;
  if (code && LIMIT_ERROR_TEXT[code]) {
    return LIMIT_ERROR_TEXT[code](payload);
  }

  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }
  return fallback;
};
