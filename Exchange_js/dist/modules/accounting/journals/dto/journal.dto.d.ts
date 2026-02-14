export declare enum JournalSourceType {
    DEPOSIT = "DEPOSIT",
    WITHDRAWAL = "WITHDRAWAL",
    SWAP = "SWAP",
    OTC_ORDER = "OTC_ORDER"
}
export declare enum JournalPostingStatus {
    POSTED = "POSTED",
    VOID = "VOID"
}
export declare class JournalQueryDto {
    skip?: string;
    take?: string;
    id?: string;
    sourceType?: JournalSourceType;
    eventCode?: string;
    postingStatus?: JournalPostingStatus;
    baseAssetId?: string;
    createdAtStart?: string;
    createdAtEnd?: string;
    postedAtStart?: string;
    postedAtEnd?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}
