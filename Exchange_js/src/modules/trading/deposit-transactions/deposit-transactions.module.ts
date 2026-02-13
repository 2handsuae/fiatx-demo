import { Module } from '@nestjs/common';
import { DepositTransactionsController } from './deposit-transactions.controller';
import { DepositTransactionsService } from './deposit-transactions.service';

@Module({
  controllers: [DepositTransactionsController],
  providers: [DepositTransactionsService],
  exports: [DepositTransactionsService],
})
export class DepositTransactionsModule {}
