import { PrismaService } from '../../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SwapTransactionStatus, CreateSwapTransactionDto, UpdateSwapTransactionStatusDto } from './dto/swap-transaction.dto';
import { SwapTransactionsService } from './swap-transactions.service';
import { JournalsService } from '../../accounting/journals/journals.service';
export interface SwapOrchestratorOutput {
    swap_status_after: SwapTransactionStatus;
    emitted_events: string[];
    audit_log_id: string;
    transaction: any;
}
export declare class SwapWorkflowOrchestrator {
    private prisma;
    private eventEmitter;
    private swapService;
    private journalsService;
    private readonly logger;
    constructor(prisma: PrismaService, eventEmitter: EventEmitter2, swapService: SwapTransactionsService, journalsService: JournalsService);
    private createAccountingContext;
    createSwap(dto: CreateSwapTransactionDto): Promise<SwapOrchestratorOutput>;
    handleStatusTransition(id: string, dto: UpdateSwapTransactionStatusDto, operatorId: string): Promise<SwapOrchestratorOutput>;
    private getNextStatus;
}
