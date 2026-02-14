import { OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PayinStatusChangedEvent, PayinCreatedEvent } from '../modules/asset-treasury/payins/events/payin.events';
import { DepositTransactionsService } from '../modules/trading/deposit-transactions/deposit-transactions.service';
import { JournalsService } from '../modules/accounting/journals/journals.service';
import { PayinsService } from '../modules/asset-treasury/payins/payins.service';
import { DepositStatusChangedEvent } from '../modules/trading/deposit-transactions/events/deposit-transaction.events';
import { PrismaService } from '../core/prisma/prisma.service';
interface OrchestrationResult {
    updated_payin_status?: string;
    updated_deposit_status?: string;
    emitted_events: string[];
    created_or_reversed_journal_entry_ids: string[];
    audit_log_id?: string;
}
export declare class DepositWorkflowService implements OnModuleInit {
    private readonly depositService;
    private readonly journalService;
    private readonly payinsService;
    private readonly eventEmitter;
    private readonly prisma;
    private readonly logger;
    constructor(depositService: DepositTransactionsService, journalService: JournalsService, payinsService: PayinsService, eventEmitter: EventEmitter2, prisma: PrismaService);
    onModuleInit(): void;
    handlePayinCreated(event: PayinCreatedEvent): Promise<OrchestrationResult | null>;
    handlePayinStatusChanged(event: PayinStatusChangedEvent): Promise<OrchestrationResult | null>;
    handleDepositStatusChanged(event: DepositStatusChangedEvent): Promise<OrchestrationResult | null>;
    private orchestratePayinDetected;
    private orchestratePayinFailed;
    private orchestratePayinConfirmed;
    private orchestrateDepositSuccess;
    private orchestrateDepositRejected;
    private triggerAccounting;
    private getSuffix;
    private findDepositByPayinId;
}
export {};
