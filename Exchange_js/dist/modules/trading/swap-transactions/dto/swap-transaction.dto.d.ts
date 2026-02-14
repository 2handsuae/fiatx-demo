export declare enum SwapTransactionStatus {
    PENDING_COMPLIANCE = "PENDING_COMPLIANCE",
    UNDER_REVIEW = "UNDER_REVIEW",
    SUCCESS = "SUCCESS",
    REJECTED = "REJECTED"
}
export declare enum SwapTransactionAction {
    SUCCESS = "success",
    REJECT = "reject",
    FLAG = "flag"
}
export declare class CreateSwapTransactionDto {
    swapNo?: string;
    ownerType: string;
    ownerId: string;
    fromAssetId: string;
    fromAmount: number;
    toAssetId: string;
    toAmount: number;
}
export declare class UpdateSwapTransactionStatusDto {
    action: SwapTransactionAction;
    reason?: string;
}
export declare class SwapTransactionQueryDto {
    skip?: number;
    take?: number;
    swapNo?: string;
    ownerId?: string;
    ownerType?: string;
    status?: SwapTransactionStatus;
    startDate?: string;
    endDate?: string;
}
