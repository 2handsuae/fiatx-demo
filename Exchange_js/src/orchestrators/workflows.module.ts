import { Module } from '@nestjs/common';
import { WithdrawWorkflowOrchestrator } from './withdraw-workflow.orchestrator';
import { PayinsModule } from '../modules/asset-treasury/payins/payins.module';
import { SwapTransactionsModule } from '../modules/trading/swap-transactions/swap-transactions.module';
import { WithdrawTransactionsModule } from '../modules/trading/withdraw-transactions/withdraw-transactions.module';
import { PayoutsModule } from '../modules/asset-treasury/payouts/payouts.module';
import { PrismaModule } from '../core/prisma/prisma.module';
import { PayoutCloseoutRepairController } from './payout-closeout-repair.controller';

@Module({
  imports: [
    PayinsModule,
    SwapTransactionsModule,
    WithdrawTransactionsModule,
    PayoutsModule,
    PrismaModule,
  ],
  controllers: [PayoutCloseoutRepairController],
  providers: [
    WithdrawWorkflowOrchestrator,
  ],
  exports: [
    WithdrawWorkflowOrchestrator,
  ],
})
export class WorkflowsModule {}
