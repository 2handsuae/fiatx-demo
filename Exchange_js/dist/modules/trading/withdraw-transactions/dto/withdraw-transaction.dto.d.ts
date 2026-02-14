export declare enum WithdrawTransactionStatus {
    CREATED = "CREATED",
    PENDING_COMPLIANCE = "PENDING_COMPLIANCE",
    UNDER_REVIEW = "UNDER_REVIEW",
    APPROVED = "APPROVED",
    PAYOUT_PENDING = "PAYOUT_PENDING",
    SUCCESS = "SUCCESS",
    FAILED = "FAILED",
    REJECTED = "REJECTED",
    CANCELLED = "CANCELLED",
    RETURNED = "RETURNED",
    HELD = "HELD"
}
export declare enum WithdrawTransactionAction {
    CHECK = "check",
    FLAG = "flag",
    REJECT = "reject",
    APPROVE = "approve",
    CANCEL = "cancel",
    SUCCESS = "success",
    FAIL = "fail",
    RETURN = "return"
}
export declare class UpdateWithdrawTransactionStatusDto {
    action: WithdrawTransactionAction;
    reason?: string;
}
export declare class CreateWithdrawTransactionDto {
    assetId: string;
    amount: number;
    toWalletId?: string;
    toAddress?: string;
    toIban?: string;
    parentType?: string;
    parentId?: string;
}
export declare enum WithdrawOwnerType {
    CUSTOMER = "CUSTOMER",
    LP = "LP"
}
export declare enum WithdrawType {
    CRYPTO = "crypto",
    FIAT = "fiat"
}
export declare enum ComplianceStatus {
    PENDING = "PENDING",
    CLEAR = "CLEAR",
    HOLD = "HOLD",
    REJECT = "REJECT"
}
export declare enum KytStatus {
    PENDING = "PENDING",
    PASS = "PASS",
    REVIEW = "REVIEW",
    FAIL = "FAIL"
}
export declare enum TravelRuleStatus {
    NOT_REQUIRED = "NOT_REQUIRED",
    PENDING = "PENDING",
    SENT = "SENT",
    RECEIVED = "RECEIVED",
    ACCEPTED = "ACCEPTED",
    REJECTED = "REJECTED",
    EXPIRED = "EXPIRED"
}
export declare class WithdrawTransactionQueryDto {
    skip?: number;
    take?: number;
    withdrawNo?: string;
    ownerId?: string;
    ownerType?: WithdrawOwnerType;
    assetId?: string;
    status?: WithdrawTransactionStatus;
    startDate?: string;
    endDate?: string;
}
