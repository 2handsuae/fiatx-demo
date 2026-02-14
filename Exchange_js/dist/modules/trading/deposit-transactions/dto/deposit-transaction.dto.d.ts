export declare enum DepositTransactionStatus {
    PAYIN_PENDING = "PAYIN_PENDING",
    COMPLIANCE_PENDING = "COMPLIANCE_PENDING",
    SUCCESS = "SUCCESS",
    UNDER_REVIEW = "UNDER_REVIEW",
    REJECTED = "REJECTED",
    FAILED = "FAILED"
}
export declare enum DepositOwnerType {
    CUSTOMER = "CUSTOMER",
    LP = "LP"
}
export declare class DepositTransactionQueryDto {
    skip?: number;
    take?: number;
    depositNo?: string;
    ownerId?: string;
    ownerType?: DepositOwnerType;
    assetId?: string;
    toWalletId?: string;
    status?: DepositTransactionStatus;
    kytStatus?: string;
    travelRuleStatus?: string;
    startDate?: string;
    endDate?: string;
}
export declare enum DepositTransactionAction {
    PAYIN_CONFIRMED = "payin_confirmed",
    SUCCESS = "success",
    FLAG = "flag",
    REJECT = "reject",
    FAIL = "fail"
}
export declare class UpdateDepositTransactionStatusDto {
    action: DepositTransactionAction;
    reason?: string;
}
