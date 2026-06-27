import { Module, forwardRef } from '@nestjs/common';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { WithdrawTransactionsController } from './withdraw-transactions.controller';
import { CustomerWithdrawController } from './customer-withdraw.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { WithdrawWorkflowService } from './withdraw-workflow.service';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { PayoutsModule } from '../../asset-treasury/payouts/payouts.module';
import { WithdrawalFeeLevelModule } from '../withdrawal-fee-level/withdrawal-fee-level.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';
import { WithdrawLargeValueApprovalService } from './withdraw-large-value-approval.service';
import { FundsLayerModule } from '../../funds-layer/funds-layer.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => OnboardingModule),
    TigerBeetleModule,
    forwardRef(() => PayoutsModule),
    WithdrawalFeeLevelModule,
    ApprovalsModule,
    PricingCenterModule,
    FundsLayerModule,
  ],
  controllers: [WithdrawTransactionsController, CustomerWithdrawController],
  providers: [
    WithdrawTransactionsService,
    WithdrawWorkflowService,
    WithdrawLargeValueApprovalService,
  ],
  exports: [
    WithdrawTransactionsService,
    WithdrawWorkflowService,
  ],
})
export class WithdrawTransactionsModule {}
