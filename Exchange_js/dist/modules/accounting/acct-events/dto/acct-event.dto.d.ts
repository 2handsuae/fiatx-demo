export declare enum OwnerScope {
    CUSTOMER = "CUSTOMER",
    LP = "LP",
    ALL = "ALL"
}
export declare enum AssetType {
    FIAT = "FIAT",
    CRYPTO = "CRYPTO",
    ALL = "ALL"
}
export declare enum TriggerType {
    STATUS_TRANSITION = "STATUS_TRANSITION",
    EXTERNAL_CALLBACK = "EXTERNAL_CALLBACK",
    COMMAND = "COMMAND",
    SYSTEM_RULE = "SYSTEM_RULE",
    SCHEDULED = "SCHEDULED"
}
export declare enum PostingMode {
    TEMPLATE = "TEMPLATE",
    AUTO_REVERSAL = "AUTO_REVERSAL",
    NONE = "NONE"
}
export declare enum ClearingMode {
    TEMPLATE = "TEMPLATE",
    NONE = "NONE"
}
export declare class CreateAcctEventDto {
    eventCode: string;
    entityType: string;
    ownerScope: OwnerScope;
    assetType: AssetType;
    triggerType: TriggerType;
    postingMode: PostingMode;
    clearingMode: ClearingMode;
    postingReversalOfEventCode?: string;
    clearingReversalOfEventCode?: string;
    description?: string;
}
export declare class UpdateAcctEventDto {
    entityType?: string;
    ownerScope?: OwnerScope;
    assetType?: AssetType;
    triggerType?: TriggerType;
    postingMode?: PostingMode;
    clearingMode?: ClearingMode;
    postingReversalOfEventCode?: string;
    clearingReversalOfEventCode?: string;
    isActive?: boolean;
    description?: string;
}
export declare class AcctEventQueryDto {
    skip?: string;
    take?: string;
    eventCode?: string;
    entityType?: string;
    ownerScope?: OwnerScope;
    assetType?: AssetType;
    triggerType?: TriggerType;
    isActive?: string;
}
