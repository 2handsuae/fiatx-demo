export declare const DEFAULT_CLEARING_TEMPLATES: {
    code: string;
    clearingType: string;
    sourceType: string;
    description: string;
    isEnabled: boolean;
    feeMethod: string;
    outAssetSource: string;
    outAmountSource: string;
    inAssetSource: string;
    inAmountSource: string;
    feeAssetSource: string;
    feeAmountSource: string;
    lineTemplates: ({
        lineNo: number;
        lineType: string;
        partyType: string;
        assetSource: string;
        amountSource: string;
        partyIdSource?: undefined;
    } | {
        lineNo: number;
        lineType: string;
        partyType: string;
        partyIdSource: string;
        assetSource: string;
        amountSource: string;
    })[];
}[];
