import { Module } from '@nestjs/common';
import { DepositWorkflowService } from './deposit-workflow.service';
import { SwapWorkflowService } from './swap-workflow.service';
import { WithdrawWorkflowOrchestrator } from './withdraw-workflow.orchestrator';
import { PayinsModule } from '../modules/asset-treasury/payins/payins.module';
import { DepositTransactionsModule } from '../modules/trading/deposit-transactions/deposit-transactions.module';
import { SwapTransactionsModule } from '../modules/trading/swap-transactions/swap-transactions.module';
import { JournalsModule } from '../modules/accounting/journals/journals.module';
import { WithdrawTransactionsModule } from '../modules/trading/withdraw-transactions/withdraw-transactions.module';
import { PayoutsModule } from '../modules/asset-treasury/payouts/payouts.module';
import { ClearingModule } from '../modules/clearing-settle/clearing/clearing.module';
import { PrismaModule } from '../core/prisma/prisma.module';

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
  ],
  providers: [
    DepositWorkflowService,
    SwapWorkflowService,
    WithdrawWorkflowOrchestrator,
  ],
  exports: [
    DepositWorkflowService,
    SwapWorkflowService,
    WithdrawWorkflowOrchestrator,
  ],
})
export class WorkflowsModule {}
