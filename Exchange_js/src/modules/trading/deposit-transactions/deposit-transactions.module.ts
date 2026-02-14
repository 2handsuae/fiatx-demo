import { Module } from '@nestjs/common';
import { DepositTransactionsController } from './deposit-transactions.controller';
import { DepositTransactionsService } from './deposit-transactions.service';
import { TransactionComplianceModule } from '../../risk-engine/transaction-compliance/transaction-compliance.module';

@Module({
  imports: [TransactionComplianceModule],
  controllers: [DepositTransactionsController],
  providers: [DepositTransactionsService],
  exports: [DepositTransactionsService],
})
export class DepositTransactionsModule {}
