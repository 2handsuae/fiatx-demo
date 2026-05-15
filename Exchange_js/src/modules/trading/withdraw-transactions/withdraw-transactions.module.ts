import { Module } from '@nestjs/common';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { WithdrawTransactionsController } from './withdraw-transactions.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { TransactionComplianceModule } from '../../risk-engine/transaction-compliance/transaction-compliance.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';
import { WithdrawTransactionWorkflowService } from './withdraw-transaction-workflow.service';

@Module({
  imports: [
    PrismaModule,
    OnboardingModule,
    TransactionComplianceModule,
    PricingCenterModule,
  ],
  controllers: [WithdrawTransactionsController],
  providers: [WithdrawTransactionsService, WithdrawTransactionWorkflowService],
  exports: [WithdrawTransactionsService, WithdrawTransactionWorkflowService],
})
export class WithdrawTransactionsModule {}
