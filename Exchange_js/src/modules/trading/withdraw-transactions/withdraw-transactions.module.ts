import { Module } from '@nestjs/common';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { WithdrawTransactionsController } from './withdraw-transactions.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { JournalsModule } from '../../accounting/journals/journals.module';
import { TransactionComplianceModule } from '../../risk-engine/transaction-compliance/transaction-compliance.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';

@Module({
  imports: [
    PrismaModule,
    OnboardingModule,
    JournalsModule,
    TransactionComplianceModule,
    PricingCenterModule,
  ],
  controllers: [WithdrawTransactionsController],
  providers: [WithdrawTransactionsService],
  exports: [WithdrawTransactionsService],
})
export class WithdrawTransactionsModule {}
