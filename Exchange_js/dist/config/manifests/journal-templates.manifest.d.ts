export declare const DEFAULT_JOURNAL_TEMPLATES: ({
    header: {
        templateCode: string;
        eventCode: string;
        version: number;
        status: string;
        description: string;
    };
    lines: ({
        lineNo: number;
        accountCode: string;
        drCr: string;
        amountSource: string;
        assetSource: string;
        ownerTypeSource: string;
        dimensionsRule: string;
        description: string;
        ownerIdSource?: undefined;
    } | {
        lineNo: number;
        accountCode: string;
        drCr: string;
        amountSource: string;
        assetSource: string;
        ownerTypeSource: string;
        ownerIdSource: string;
        dimensionsRule: string;
        description: string;
    })[];
} | {
    header: {
        templateCode: string;
        eventCode: string;
        version: number;
        status: string;
        description: string;
    };
    lines: {
        lineNo: number;
        accountCode: string;
        drCr: string;
        amountSource: string;
        assetSource: string;
        ownerTypeSource: string;
        ownerIdSource: string;
        referenceSource: string;
        dimensionsRule: string;
        description: string;
    }[];
} | {
    header: {
        templateCode: string;
        eventCode: string;
        version: number;
        status: string;
        description: string;
    };
    lines: ({
        lineNo: number;
        accountCode: string;
        drCr: string;
        amountSource: string;
        assetSource: string;
        ownerTypeSource: string;
        ownerIdSource: string;
        fxRateSource: string;
        referenceSource: string;
        dimensionsRule: string;
        description: string;
    } | {
        lineNo: number;
        accountCode: string;
        drCr: string;
        amountSource: string;
        assetSource: string;
        ownerTypeSource: string;
        fxRateSource: string;
        referenceSource: string;
        dimensionsRule: string;
        description: string;
        ownerIdSource?: undefined;
    })[];
})[];
