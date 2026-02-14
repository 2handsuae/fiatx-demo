import { PrismaService } from '../../../core/prisma/prisma.service';
import { JournalLineQueryDto } from './dto/journal-line.dto';
import { CustomerBalanceHistoryQueryDto } from './dto/customer-balance-history.dto';
import { Prisma } from '@prisma/client';
export declare class JournalLinesService {
    private prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    findAll(query: JournalLineQueryDto): Promise<{
        items: any;
        total: any;
    }>;
    findOne(id: string): Promise<any>;
    getCustomerBalanceHistory(query: CustomerBalanceHistoryQueryDto): Promise<{
        items: any;
        total: any;
        openingBalance: Prisma.Decimal;
        closingBalance: Prisma.Decimal;
    }>;
}
