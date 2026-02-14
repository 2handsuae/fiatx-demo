export declare enum DrCr {
    DR = "DR",
    CR = "CR"
}
export declare enum AmountSource {
    AMOUNT = "AMOUNT",
    FEE_AMOUNT = "FEE_AMOUNT",
    FROM_AMOUNT = "FROM_AMOUNT",
    TO_AMOUNT = "TO_AMOUNT"
}
export declare enum AssetSource {
    ASSET_ID = "ASSET_ID",
    FEE_ASSET_ID = "FEE_ASSET_ID",
    FROM_ASSET_ID = "FROM_ASSET_ID",
    TO_ASSET_ID = "TO_ASSET_ID"
}
export declare class CreateJournalLineTemplateDto {
    templateId: string;
    lineNo: number;
    accountCode: string;
    drCr: DrCr;
    amountSource: AmountSource;
    assetSource: AssetSource;
    ownerTypeSource?: string;
    ownerIdSource?: string;
    fxRateSource?: string;
    referenceSource?: string;
    dimensionsRule?: string;
    conditionExpr?: string;
    description?: string;
}
export declare class UpdateJournalLineTemplateDto {
    accountCode?: string;
    drCr?: DrCr;
    amountSource?: AmountSource;
    assetSource?: AssetSource;
    ownerTypeSource?: string;
    ownerIdSource?: string;
    fxRateSource?: string;
    referenceSource?: string;
    dimensionsRule?: string;
    conditionExpr?: string;
    description?: string;
}
export declare class JournalLineTemplateQueryDto {
    templateId?: string;
}
