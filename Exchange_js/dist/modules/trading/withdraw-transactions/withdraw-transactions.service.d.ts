import { PrismaService } from '../../../core/prisma/prisma.service';
import { WithdrawTransactionQueryDto, UpdateWithdrawTransactionStatusDto, CreateWithdrawTransactionDto } from './dto/withdraw-transaction.dto';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JournalsService } from '../../accounting/journals/journals.service';
export declare class WithdrawTransactionsService {
    private prisma;
    private eventEmitter;
    private journalsService;
    private readonly logger;
    private generateWithdrawNo;
    private readonly transitions;
    constructor(prisma: PrismaService, eventEmitter: EventEmitter2, journalsService: JournalsService);
    private createAccountingContext;
    private assertComplianceGate;
    findAll(query: WithdrawTransactionQueryDto): Promise<{
        items: any;
        total: any;
    }>;
    findOne(id: string): Promise<any>;
    create(dto: CreateWithdrawTransactionDto, userId: string, ownerType?: string): Promise<any>;
    updateStatus(id: string, dto: UpdateWithdrawTransactionStatusDto, tx?: Prisma.TransactionClient): Promise<any>;
    createMockData(): Promise<any[]>;
}
