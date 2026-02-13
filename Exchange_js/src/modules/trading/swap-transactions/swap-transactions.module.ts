import { Module } from '@nestjs/common';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowOrchestrator } from './swap-workflow.orchestrator';
import { SwapTransactionsController } from './swap-transactions.controller';
import { SwapTransactionsCustomerController } from './swap-transactions-customer.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { JournalsModule } from '../../accounting/journals/journals.module';

@Module({
  imports: [PrismaModule, OnboardingModule, JournalsModule],
  controllers: [SwapTransactionsController, SwapTransactionsCustomerController],
  providers: [SwapTransactionsService, SwapWorkflowOrchestrator],
  exports: [SwapTransactionsService, SwapWorkflowOrchestrator],
})
export class SwapTransactionsModule {}
