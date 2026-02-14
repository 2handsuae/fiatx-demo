export declare enum TemplateStatus {
    ACTIVE = "ACTIVE",
    INACTIVE = "INACTIVE"
}
export declare class CreateJournalHeaderTemplateDto {
    templateCode: string;
    eventCode: string;
    version?: number;
    status?: TemplateStatus;
    baseAssetId: string;
    description?: string;
    effectiveFrom?: string;
}
export declare class UpdateJournalHeaderTemplateDto {
    version?: number;
    status?: TemplateStatus;
    baseAssetId?: string;
    description?: string;
    effectiveFrom?: string;
}
export declare class JournalHeaderTemplateQueryDto {
    skip?: string;
    take?: string;
    templateCode?: string;
    eventCode?: string;
    status?: TemplateStatus;
}
