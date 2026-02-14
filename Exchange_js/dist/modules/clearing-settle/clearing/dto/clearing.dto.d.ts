export declare class CreateClearingLineTemplateDto {
    lineNo: number;
    lineType: string;
    partyType: string;
    partyIdSource?: string;
    assetSource: string;
    amountSource: string;
    refTypeConst?: string;
    refIdSource?: string;
    memoTemplate?: string;
    isEnabled?: boolean;
}
export declare class CreateClearingTemplateDto {
    code: string;
    clearingType: string;
    sourceType: string;
    isEnabled?: boolean;
    description: string;
    feeMethod?: string;
    outAssetSource: string;
    outAmountSource: string;
    inAssetSource: string;
    inAmountSource: string;
    feeAssetSource: string;
    feeAmountSource: string;
    outPayoutIdSource?: string;
    inPayinIdSource?: string;
    memoTemplate?: string;
    lineTemplates?: CreateClearingLineTemplateDto[];
}
export declare class UpdateClearingTemplateDto extends CreateClearingTemplateDto {
}
export declare class QueryClearingTemplateDto {
    code?: string;
    status?: string;
    skip?: number;
    take?: number;
}
export declare class QueryClearingLineDto {
    clearingId?: string;
    skip?: number;
    take?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}
export declare class QueryClearingDto {
    sourceId?: string;
    clearingStatus?: string;
    skip?: number;
    take?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}
