import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { InternalFundsModule } from '../internal-funds/internal-funds.module';
import { InternalTransactionsModule } from '../internal-transactions/internal-transactions.module';
import { InternalTransactionWorkflowController } from './internal-transaction-workflow.controller';
import { InternalTransactionWorkflowService } from './internal-transaction-workflow.service';

@Module({
  imports: [PrismaModule, InternalTransactionsModule, InternalFundsModule],
  controllers: [InternalTransactionWorkflowController],
  providers: [InternalTransactionWorkflowService],
  exports: [InternalTransactionWorkflowService],
})
export class InternalTransactionWorkflowModule {}

