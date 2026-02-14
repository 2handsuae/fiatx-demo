import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowOrchestrator } from './swap-workflow.orchestrator';
import { OnboardingService } from '../../identity/onboarding/onboarding.service';
import { CreateSwapTransactionDto, SwapTransactionQueryDto } from './dto/swap-transaction.dto';
export declare class SwapTransactionsCustomerController {
    private readonly swapTransactionsService;
    private readonly orchestrator;
    private readonly onboardingService;
    constructor(swapTransactionsService: SwapTransactionsService, orchestrator: SwapWorkflowOrchestrator, onboardingService: OnboardingService);
    preview(dto: {
        fromAssetId: string;
        fromAmount: number;
        toAssetId: string;
    }): Promise<{
        fromAssetId: any;
        fromAssetCode: any;
        fromAmount: number;
        toAssetId: any;
        toAssetCode: any;
        toAmount: number;
        exchangeRate: number;
    }>;
    create(req: any, dto: CreateSwapTransactionDto): Promise<import("./swap-workflow.orchestrator").SwapOrchestratorOutput>;
    findMy(req: any, query: SwapTransactionQueryDto): Promise<{
        items: any;
        total: any;
    }>;
    findOne(req: any, id: string): Promise<any>;
}
