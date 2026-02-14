import { JournalHeaderTemplatesService } from './journal-header-templates.service';
import { CreateJournalHeaderTemplateDto, UpdateJournalHeaderTemplateDto, JournalHeaderTemplateQueryDto } from './dto/journal-header-template.dto';
export declare class JournalHeaderTemplatesController {
    private readonly service;
    constructor(service: JournalHeaderTemplatesService);
    create(createDto: CreateJournalHeaderTemplateDto): Promise<{
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        description: string | null;
        eventCode: string;
        baseAssetId: string;
        templateCode: string;
        version: number;
        effectiveFrom: Date | null;
        effectiveTo: Date | null;
    }>;
    findAll(query: JournalHeaderTemplateQueryDto): Promise<{
        items: ({
            acctEvent: {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                description: string | null;
                eventCode: string;
                entityType: string;
                triggerKey: string | null;
                fromStatus: string | null;
                toStatus: string | null;
                assetType: string;
                ownerScope: string;
                triggerType: string;
                postingMode: string;
                clearingMode: string;
                postingReversalOfEventCode: string | null;
                clearingReversalOfEventCode: string | null;
                isActive: boolean;
                clearingTemplateCode: string | null;
            };
            baseAsset: {
                id: string;
                status: string;
                createdAt: Date;
                updatedAt: Date;
                description: string | null;
                type: string;
                code: string;
                network: string | null;
                decimals: number;
                assetNo: string | null;
            };
        } & {
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            description: string | null;
            eventCode: string;
            baseAssetId: string;
            templateCode: string;
            version: number;
            effectiveFrom: Date | null;
            effectiveTo: Date | null;
        })[];
        total: number;
    }>;
    findOne(id: string): Promise<{
        acctEvent: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            description: string | null;
            eventCode: string;
            entityType: string;
            triggerKey: string | null;
            fromStatus: string | null;
            toStatus: string | null;
            assetType: string;
            ownerScope: string;
            triggerType: string;
            postingMode: string;
            clearingMode: string;
            postingReversalOfEventCode: string | null;
            clearingReversalOfEventCode: string | null;
            isActive: boolean;
            clearingTemplateCode: string | null;
        };
        baseAsset: {
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            description: string | null;
            type: string;
            code: string;
            network: string | null;
            decimals: number;
            assetNo: string | null;
        };
    } & {
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        description: string | null;
        eventCode: string;
        baseAssetId: string;
        templateCode: string;
        version: number;
        effectiveFrom: Date | null;
        effectiveTo: Date | null;
    }>;
    update(id: string, updateDto: UpdateJournalHeaderTemplateDto): Promise<{
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        description: string | null;
        eventCode: string;
        baseAssetId: string;
        templateCode: string;
        version: number;
        effectiveFrom: Date | null;
        effectiveTo: Date | null;
    }>;
    remove(id: string): Promise<{
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        description: string | null;
        eventCode: string;
        baseAssetId: string;
        templateCode: string;
        version: number;
        effectiveFrom: Date | null;
        effectiveTo: Date | null;
    }>;
}
