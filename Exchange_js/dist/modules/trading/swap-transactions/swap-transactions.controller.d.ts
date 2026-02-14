import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowOrchestrator } from './swap-workflow.orchestrator';
import { CreateSwapTransactionDto, SwapTransactionQueryDto, UpdateSwapTransactionStatusDto } from './dto/swap-transaction.dto';
export declare class SwapTransactionsController {
    private readonly swapTransactionsService;
    private readonly orchestrator;
    constructor(swapTransactionsService: SwapTransactionsService, orchestrator: SwapWorkflowOrchestrator);
    create(createSwapTransactionDto: CreateSwapTransactionDto): Promise<import("./swap-workflow.orchestrator").SwapOrchestratorOutput>;
    findAll(query: SwapTransactionQueryDto): Promise<{
        items: any;
        total: any;
    }>;
    findOne(id: string): Promise<any>;
    updateStatus(id: string, updateStatusDto: UpdateSwapTransactionStatusDto, req: any): Promise<import("./swap-workflow.orchestrator").SwapOrchestratorOutput>;
}
