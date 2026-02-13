export const SwapEvents = {
  EVT_SWAP_CREATED: 'EVT_SWAP_CREATED',
  EVT_SWAP_SUCCESS: 'EVT_SWAP_SUCCESS',
  EVT_SWAP_REJECTED: 'EVT_SWAP_REJECTED',
} as const;

export type SwapEventType = (typeof SwapEvents)[keyof typeof SwapEvents];
