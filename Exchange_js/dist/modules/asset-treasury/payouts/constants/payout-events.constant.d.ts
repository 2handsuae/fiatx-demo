export declare const PayoutEvents: {
    readonly EVT_PAYOUT_CREATED: "payout.created";
    readonly EVT_PAYOUT_CONFIRMED: "payout.status.confirmed";
    readonly EVT_PAYOUT_CLEAR: "payout.status.clear";
    readonly EVT_PAYOUT_FAILED: "payout.status.failed";
    readonly EVT_PAYOUT_TIMEOUT: "payout.status.timeout";
    readonly EVT_PAYOUT_RETURNED: "payout.status.returned";
};
export type PayoutEventType = (typeof PayoutEvents)[keyof typeof PayoutEvents];
