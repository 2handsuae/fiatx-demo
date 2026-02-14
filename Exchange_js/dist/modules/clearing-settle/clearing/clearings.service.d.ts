import { PrismaService } from '../../../core/prisma/prisma.service';
import { QueryClearingDto } from './dto/clearing.dto';
import { Prisma } from '@prisma/client';
export declare class ClearingsService {
    private prisma;
    constructor(prisma: PrismaService);
    private toCanonicalSourcePath;
    private resolveTemplatePath;
    private evalDecimal;
    private evalString;
    triggerClearing(params: {
        sourceType: string;
        sourceId: string;
        eventCode: string;
        context: any;
    }, tx?: Prisma.TransactionClient): Promise<any>;
    findAll(query: QueryClearingDto): Promise<{
        items: any[];
        total: any;
    }>;
    findOne(id: string): Promise<any>;
    findLine(id: string): Promise<any>;
    findAllLines(query: any): Promise<{
        items: any[];
        total: any;
    }>;
    reClear(id: string): Promise<any>;
    updateStatusBySource(sourceId: string, status: string, tx?: Prisma.TransactionClient): Promise<any>;
}
