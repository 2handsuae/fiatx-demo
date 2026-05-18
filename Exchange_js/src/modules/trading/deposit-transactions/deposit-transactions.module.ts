import { Module } from '@nestjs/common';
import { DepositTransactionsController } from './deposit-transactions.controller';
import { DepositTransactionsService } from './deposit-transactions.service';
import { InboundTransferSignalsService } from './inbound-transfer-signals.service';
import { PayinsModule } from '../../asset-treasury/payins/payins.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { TransactionDepositWorkflowService } from './transaction-deposit-workflow.service';

@Module({
  imports: [PayinsModule, OnboardingModule],
  controllers: [DepositTransactionsController],
  providers: [
    DepositTransactionsService,
    InboundTransferSignalsService,
    TransactionDepositWorkflowService,
  ],
  exports: [DepositTransactionsService, TransactionDepositWorkflowService],
})
export class DepositTransactionsModule {}
