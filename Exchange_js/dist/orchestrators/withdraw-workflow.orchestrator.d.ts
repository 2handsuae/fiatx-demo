import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../core/prisma/prisma.service';
import { WithdrawTransactionsService } from '../modules/trading/withdraw-transactions/withdraw-transactions.service';
import { PayoutsService } from '../modules/asset-treasury/payouts/payouts.service';
import { JournalsService } from '../modules/accounting/journals/journals.service';
import { ClearingsService } from '../modules/clearing-settle/clearing/clearings.service';
import { PayoutStatus } from '../modules/asset-treasury/payouts/dto/payout.dto';
export interface OrchestrationResult {
    updated_withdrawal_status?: string;
    updated_payout_status?: string;
    payout_binding_status: 'created' | 'bound' | 'unchanged';
    emitted_events: string[];
    created_or_reversed_journal_entry_ids: string[];
    audit_log_id: string;
}
export declare class WithdrawWorkflowOrchestrator {
    private prisma;
    private eventEmitter;
    private withdrawalService;
    private payoutsService;
    private journalsService;
    private clearingsService;
    private readonly logger;
    constructor(prisma: PrismaService, eventEmitter: EventEmitter2, withdrawalService: WithdrawTransactionsService, payoutsService: PayoutsService, journalsService: JournalsService, clearingsService: ClearingsService);
    onWithdrawalCreated(payload: {
        withdrawId: string;
    }): Promise<OrchestrationResult | null>;
    onWithdrawalCancelled(payload: {
        withdrawId: string;
    }): Promise<OrchestrationResult | null>;
    onWithdrawalRejected(payload: {
        withdrawId: string;
    }): Promise<OrchestrationResult | null>;
    onWithdrawalApprovedCrypto(payload: {
        withdrawId: string;
    }): Promise<OrchestrationResult | null>;
    onWithdrawalApprovedFiat(payload: {
        withdrawId: string;
    }): Promise<OrchestrationResult | null>;
    onPayoutConfirmed(payload: {
        withdrawId: string;
        payoutId: string;
    }): Promise<OrchestrationResult | null>;
    onWithdrawalFailedCrypto(payload: {
        withdrawId: string;
        payoutId: string;
        status: PayoutStatus;
    }): Promise<OrchestrationResult | null>;
    onWithdrawalFailedFiat(payload: {
        withdrawId: string;
        payoutId: string;
        status: PayoutStatus;
    }): Promise<OrchestrationResult | null>;
    onPayoutReturned(payload: {
        withdrawId: string;
        payoutId: string;
    }): Promise<OrchestrationResult | null>;
    private orchestrateWithdrawalEvent;
    private orchestrateSuccessPath;
    private orchestratePayoutEvent;
    private getSuffix;
    private checkIdempotency;
    private getLatestAuditLog;
    private createAccountingContext;
}
