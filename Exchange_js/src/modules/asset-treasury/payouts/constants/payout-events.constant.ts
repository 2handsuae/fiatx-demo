export const PayoutEvents = {
  EVT_PAYOUT_CREATED: 'payout.created',
  EVT_PAYOUT_CONFIRMED: 'payout.status.confirmed',
  EVT_PAYOUT_CLEAR: 'payout.status.clear',
  EVT_PAYOUT_FAILED: 'payout.status.failed',
  EVT_PAYOUT_TIMEOUT: 'payout.status.timeout',
  EVT_PAYOUT_RETURNED: 'payout.status.returned',
} as const;

export type PayoutEventType = (typeof PayoutEvents)[keyof typeof PayoutEvents];
