import { JournalLinesService } from './journal-lines.service';
import { JournalLineQueryDto } from './dto/journal-line.dto';
import { CustomerBalanceHistoryQueryDto } from './dto/customer-balance-history.dto';
export declare class JournalLinesController {
    private readonly journalLinesService;
    constructor(journalLinesService: JournalLinesService);
    findAll(query: JournalLineQueryDto, req: any): Promise<{
        items: any;
        total: any;
    }>;
    getCustomerBalanceHistory(query: CustomerBalanceHistoryQueryDto, req: any): Promise<{
        items: any;
        total: any;
        openingBalance: import("@prisma/client/runtime/library").Decimal;
        closingBalance: import("@prisma/client/runtime/library").Decimal;
    }>;
    findOne(id: string): Promise<any>;
}
