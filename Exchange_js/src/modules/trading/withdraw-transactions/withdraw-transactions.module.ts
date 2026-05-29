import { Module, forwardRef } from '@nestjs/common';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { WithdrawTransactionsController } from './withdraw-transactions.controller';
import { CustomerWithdrawController } from './customer-withdraw.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { TransactionComplianceModule } from '../../risk-engine/transaction-compliance/transaction-compliance.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';
import { WithdrawTransactionWorkflowService } from './withdraw-transaction-workflow.service';
import { WithdrawWorkflowService } from './withdraw-workflow.service';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { PayoutsModule } from '../../asset-treasury/payouts/payouts.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => OnboardingModule),
    forwardRef(() => TransactionComplianceModule),
    forwardRef(() => PricingCenterModule),
    TigerBeetleModule,
    forwardRef(() => PayoutsModule),
  ],
  controllers: [WithdrawTransactionsController, CustomerWithdrawController],
  providers: [
    WithdrawTransactionsService,
    WithdrawTransactionWorkflowService,
    WithdrawWorkflowService,
  ],
  exports: [
    WithdrawTransactionsService,
    WithdrawTransactionWorkflowService,
    WithdrawWorkflowService,
  ],
})
export class WithdrawTransactionsModule {}
