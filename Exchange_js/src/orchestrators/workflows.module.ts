import { forwardRef, Module } from '@nestjs/common';
import { WithdrawWorkflowOrchestrator } from './withdraw-workflow.orchestrator';
import { PayinsModule } from '../modules/asset-treasury/payins/payins.module';
import { SwapTransactionsModule } from '../modules/trading/swap-transactions/swap-transactions.module';
import { WithdrawTransactionsModule } from '../modules/trading/withdraw-transactions/withdraw-transactions.module';
import { PayoutsModule } from '../modules/asset-treasury/payouts/payouts.module';
import { PrismaModule } from '../core/prisma/prisma.module';
import { TransactionComplianceModule } from '../modules/risk-engine/transaction-compliance/transaction-compliance.module';
import { InternalTransactionsModule } from '../modules/asset-treasury/internal-transactions/internal-transactions.module';
import { InternalFundsModule } from '../modules/asset-treasury/internal-funds/internal-funds.module';
import { WalletsModule } from '../modules/asset-treasury/wallets/wallets.module';
import { InternalCollectionWorkflowOrchestrator } from './internal-collection-workflow.orchestrator';
import { PayoutCloseoutRepairController } from './payout-closeout-repair.controller';

@Module({
  imports: [
    PayinsModule,
    SwapTransactionsModule,
    WithdrawTransactionsModule,
    PayoutsModule,
    PrismaModule,
    TransactionComplianceModule,
    forwardRef(() => InternalTransactionsModule),
    InternalFundsModule,
    WalletsModule,
  ],
  controllers: [PayoutCloseoutRepairController],
  providers: [
    WithdrawWorkflowOrchestrator,
    InternalCollectionWorkflowOrchestrator,
  ],
  exports: [
    WithdrawWorkflowOrchestrator,
    InternalCollectionWorkflowOrchestrator,
  ],
})
export class WorkflowsModule {}
