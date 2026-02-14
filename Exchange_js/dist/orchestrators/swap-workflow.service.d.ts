import { OnModuleInit } from '@nestjs/common';
import { SwapTransactionsService } from '../modules/trading/swap-transactions/swap-transactions.service';
import { JournalsService } from '../modules/accounting/journals/journals.service';
export declare class SwapWorkflowService implements OnModuleInit {
    private readonly swapService;
    private readonly journalService;
    private readonly logger;
    constructor(swapService: SwapTransactionsService, journalService: JournalsService);
    onModuleInit(): void;
    handleSwapCreated(payload: {
        swapId: string;
    }): Promise<void>;
    handleSwapSuccess(payload: {
        swapId: string;
        oldStatus: string;
    }): Promise<void>;
    handleSwapRejected(payload: {
        swapId: string;
        oldStatus: string;
        reason?: string;
    }): Promise<void>;
    private triggerAccounting;
}
