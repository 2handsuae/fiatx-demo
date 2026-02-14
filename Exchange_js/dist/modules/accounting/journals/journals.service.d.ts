import { PrismaService } from '../../../core/prisma/prisma.service';
import { JournalQueryDto } from './dto/journal.dto';
import { Prisma } from '@prisma/client';
export declare class JournalsService {
    private prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    private toCanonicalSourcePath;
    private resolveTemplateValue;
    private processTemplateString;
    private parseDecimal;
    private assertJournalBalancedByAsset;
    getCustomerLiabilityBalance(params: {
        ownerId: string;
        assetId: string;
        ownerType?: string;
    }, tx?: Prisma.TransactionClient): Promise<{
        ownerId: string;
        ownerType: string;
        assetId: string;
        availableBalance: Prisma.Decimal;
        creditBalance: Prisma.Decimal;
        heldBalance: Prisma.Decimal;
    }>;
    createJournal(params: {
        sourceType: string;
        sourceId: string;
        eventCode: string;
        context: any;
    }, tx?: Prisma.TransactionClient): Promise<any>;
    triggerEvent(params: {
        entityType: string;
        triggerKey: string;
        fromStatus?: string | null;
        toStatus: string;
        assetType: 'FIAT' | 'CRYPTO' | 'ALL';
        context: any;
        sourceId: string;
    }, tx?: Prisma.TransactionClient): Promise<any>;
    reverseJournal(params: {
        sourceType: string;
        sourceId: string;
        reversalEventCode: string;
        targetEventCode: string;
        context: any;
    }, tx?: Prisma.TransactionClient): Promise<any>;
    createDepositJournal(depositId: string, eventCode: string, amount: string, assetId: string, ownerId: string): Promise<any>;
    findAll(query: JournalQueryDto): Promise<{
        items: any;
        total: any;
    }>;
    findOne(id: string): Promise<any>;
}
