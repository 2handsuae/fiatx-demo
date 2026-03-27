import { Module } from '@nestjs/common';
import { DepositWorkflowService } from './deposit-workflow.service';
import { WithdrawWorkflowOrchestrator } from './withdraw-workflow.orchestrator';
import { PayinsModule } from '../modules/asset-treasury/payins/payins.module';
import { DepositTransactionsModule } from '../modules/trading/deposit-transactions/deposit-transactions.module';
import { SwapTransactionsModule } from '../modules/trading/swap-transactions/swap-transactions.module';
import { JournalsModule } from '../modules/accounting/journals/journals.module';
import { WithdrawTransactionsModule } from '../modules/trading/withdraw-transactions/withdraw-transactions.module';
import { PayoutsModule } from '../modules/asset-treasury/payouts/payouts.module';
import { ClearingModule } from '../modules/clearing-settle/clearing/clearing.module';
import { PrismaModule } from '../core/prisma/prisma.module';
import { TransactionComplianceModule } from '../modules/risk-engine/transaction-compliance/transaction-compliance.module';
import { InternalTransactionsModule } from '../modules/asset-treasury/internal-transactions/internal-transactions.module';
import { InternalFundsModule } from '../modules/asset-treasury/internal-funds/internal-funds.module';
import { InternalCollectionWorkflowOrchestrator } from './internal-collection-workflow.orchestrator';
import { AccountingEventExecutionService } from './accounting-event-execution.service';

@Module({
  imports: [
    PayinsModule,
    DepositTransactionsModule,
    SwapTransactionsModule,
    JournalsModule,
    WithdrawTransactionsModule,
    PayoutsModule,
    ClearingModule,
    PrismaModule,
    TransactionComplianceModule,
    InternalTransactionsModule,
    InternalFundsModule,
  ],
  providers: [
    DepositWorkflowService,
    AccountingEventExecutionService,
    WithdrawWorkflowOrchestrator,
    InternalCollectionWorkflowOrchestrator,
  ],
  exports: [
    DepositWorkflowService,
    WithdrawWorkflowOrchestrator,
    InternalCollectionWorkflowOrchestrator,
  ],
})
export class WorkflowsModule {}
