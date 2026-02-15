import { Module } from '@nestjs/common';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowOrchestrator } from './swap-workflow.orchestrator';
import { SwapTransactionsController } from './swap-transactions.controller';
import { SwapTransactionsCustomerController } from './swap-transactions-customer.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { JournalsModule } from '../../accounting/journals/journals.module';
import { CustomerSwapRatesModule } from '../../identity/customer-swap-rates/customer-swap-rates.module';
import { SwapQuotesService } from './swap-quotes.service';
import { OutstandingsModule } from '../../clearing-settle/outstandings/outstandings.module';

@Module({
  imports: [PrismaModule, OnboardingModule, JournalsModule, CustomerSwapRatesModule, OutstandingsModule],
  controllers: [SwapTransactionsController, SwapTransactionsCustomerController],
  providers: [SwapTransactionsService, SwapWorkflowOrchestrator, SwapQuotesService],
  exports: [SwapTransactionsService, SwapWorkflowOrchestrator, SwapQuotesService],
})
export class SwapTransactionsModule {}
