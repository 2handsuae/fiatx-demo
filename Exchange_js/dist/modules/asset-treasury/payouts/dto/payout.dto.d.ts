export declare enum PayoutStatus {
    CREATED = "CREATED",
    SIGNING = "SIGNING",
    BROADCASTED = "BROADCASTED",
    CONFIRMING = "CONFIRMING",
    CONFIRMED = "CONFIRMED",
    CLEAR = "CLEAR",
    FAILED = "FAILED",
    TIMEOUT = "TIMEOUT",
    RETURNED = "RETURNED"
}
export declare enum PayoutAction {
    SIGN = "SIGN",
    BROADCAST = "BROADCAST",
    SIGN_FAIL = "SIGN_FAIL",
    SEEN_IN_MEMPOOL = "SEEN_IN_MEMPOOL",
    DROP = "DROP",
    TIMEOUT = "TIMEOUT",
    CONFIRM = "CONFIRM",
    FAIL = "FAIL",
    CLEAR = "CLEAR",
    SUBMIT = "SUBMIT",
    RETURN = "RETURN"
}
export declare enum PayoutType {
    CRYPTO = "CRYPTO",
    FIAT = "FIAT"
}
export declare class PayoutQueryDto {
    skip?: number;
    take?: number;
    withdrawId?: string;
    status?: PayoutStatus;
    type?: PayoutType;
    assetId?: string;
}
export declare class CreatePayoutDto {
    withdrawId: string;
    type: PayoutType;
    amount: number;
    assetId: string;
    toWalletId?: string;
    toAddress?: string;
    toIban?: string;
}
export declare class UpdatePayoutStatusDto {
    action: PayoutAction;
    txHash?: string;
    referenceNo?: string;
    reason?: string;
}
