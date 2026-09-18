import { Module } from '@nestjs/common';
import { WithdrawTransactionsModule } from '../modules/trading/withdraw-transactions/withdraw-transactions.module';

// The payout-closeout-repair controller was removed with the C2b withdraw
// event-driven cutover (payouts no longer drive the withdrawal). Operator repair
// of stuck legs moves to the unified admin/funds-orders/:id/actions/:action
// endpoint in C6. The module stays registered as a thin shell for now.
@Module({
  imports: [
    WithdrawTransactionsModule,
  ],
})
export class WorkflowsModule {}
