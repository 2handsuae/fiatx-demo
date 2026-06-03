import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { InternalFundsModule } from '../internal-funds/internal-funds.module';
import { InternalTransactionsModule } from '../internal-transactions/internal-transactions.module';
import { InternalTransactionApprovalProjectionService } from './internal-transaction-approval-projection.service';
import { InternalTransactionWorkflowController } from './internal-transaction-workflow.controller';
import { InternalTransactionWorkflowService } from './internal-transaction-workflow.service';

@Module({
  imports: [
    PrismaModule,
    InternalTransactionsModule,
    InternalFundsModule,
    ApprovalsModule,
  ],
  controllers: [InternalTransactionWorkflowController],
  providers: [
    InternalTransactionWorkflowService,
    InternalTransactionApprovalProjectionService,
  ],
  exports: [InternalTransactionWorkflowService],
})
export class InternalTransactionWorkflowModule {}
