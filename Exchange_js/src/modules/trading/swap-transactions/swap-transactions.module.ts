import { Module } from '@nestjs/common';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowOrchestrator } from './swap-workflow.orchestrator';
import { SwapTransactionsController } from './swap-transactions.controller';
import { SwapTransactionsCustomerController } from './swap-transactions-customer.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { OutstandingsModule } from '../../clearing-settle/outstandings/outstandings.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';
import { TransactionComplianceModule } from '../../risk-engine/transaction-compliance/transaction-compliance.module';
import { SwapTransactionWorkflowService } from './swap-transaction-workflow.service';

@Module({
  imports: [
    PrismaModule,
    OnboardingModule,
    PricingCenterModule,
    OutstandingsModule,
    TransactionComplianceModule,
  ],
  controllers: [SwapTransactionsController, SwapTransactionsCustomerController],
  providers: [
    SwapTransactionsService,
    SwapWorkflowOrchestrator,
    SwapTransactionWorkflowService,
  ],
  exports: [
    SwapTransactionsService,
    SwapWorkflowOrchestrator,
    SwapTransactionWorkflowService,
  ],
})
export class SwapTransactionsModule {}
