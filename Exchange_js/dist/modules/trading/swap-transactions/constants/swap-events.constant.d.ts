export declare const SwapEvents: {
    readonly EVT_SWAP_CREATED: "EVT_SWAP_CREATED";
    readonly EVT_SWAP_SUCCESS: "EVT_SWAP_SUCCESS";
    readonly EVT_SWAP_REJECTED: "EVT_SWAP_REJECTED";
};
export type SwapEventType = (typeof SwapEvents)[keyof typeof SwapEvents];
