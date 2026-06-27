import { Module } from '@nestjs/common';
import { WithdrawTransactionsModule } from '../modules/trading/withdraw-transactions/withdraw-transactions.module';
import { PayoutCloseoutRepairController } from './payout-closeout-repair.controller';

@Module({
  imports: [
    WithdrawTransactionsModule,
  ],
  controllers: [PayoutCloseoutRepairController],
})
export class WorkflowsModule {}
