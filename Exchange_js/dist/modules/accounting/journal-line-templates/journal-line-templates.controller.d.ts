import { JournalLineTemplatesService } from './journal-line-templates.service';
import { CreateJournalLineTemplateDto, UpdateJournalLineTemplateDto, JournalLineTemplateQueryDto } from './dto/journal-line-template.dto';
export declare class JournalLineTemplatesController {
    private readonly service;
    constructor(service: JournalLineTemplatesService);
    create(createDto: CreateJournalLineTemplateDto): Promise<{
        id: string;
        createdAt: Date;
        description: string | null;
        lineNo: number;
        drCr: string;
        amountSource: string;
        assetSource: string;
        ownerTypeSource: string | null;
        ownerIdSource: string | null;
        fxRateSource: string | null;
        referenceSource: string | null;
        dimensionsRule: string;
        conditionExpr: string | null;
        templateId: string;
        accountCode: string;
    }>;
    findAll(query: JournalLineTemplateQueryDto): Promise<({
        account: {
            name: string;
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            type: string;
            code: string;
            requiredTags: string;
        };
    } & {
        id: string;
        createdAt: Date;
        description: string | null;
        lineNo: number;
        drCr: string;
        amountSource: string;
        assetSource: string;
        ownerTypeSource: string | null;
        ownerIdSource: string | null;
        fxRateSource: string | null;
        referenceSource: string | null;
        dimensionsRule: string;
        conditionExpr: string | null;
        templateId: string;
        accountCode: string;
    })[]>;
    findOne(id: string): Promise<{
        account: {
            name: string;
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            type: string;
            code: string;
            requiredTags: string;
        };
    } & {
        id: string;
        createdAt: Date;
        description: string | null;
        lineNo: number;
        drCr: string;
        amountSource: string;
        assetSource: string;
        ownerTypeSource: string | null;
        ownerIdSource: string | null;
        fxRateSource: string | null;
        referenceSource: string | null;
        dimensionsRule: string;
        conditionExpr: string | null;
        templateId: string;
        accountCode: string;
    }>;
    update(id: string, updateDto: UpdateJournalLineTemplateDto): Promise<{
        id: string;
        createdAt: Date;
        description: string | null;
        lineNo: number;
        drCr: string;
        amountSource: string;
        assetSource: string;
        ownerTypeSource: string | null;
        ownerIdSource: string | null;
        fxRateSource: string | null;
        referenceSource: string | null;
        dimensionsRule: string;
        conditionExpr: string | null;
        templateId: string;
        accountCode: string;
    }>;
    remove(id: string): Promise<{
        id: string;
        createdAt: Date;
        description: string | null;
        lineNo: number;
        drCr: string;
        amountSource: string;
        assetSource: string;
        ownerTypeSource: string | null;
        ownerIdSource: string | null;
        fxRateSource: string | null;
        referenceSource: string | null;
        dimensionsRule: string;
        conditionExpr: string | null;
        templateId: string;
        accountCode: string;
    }>;
}
