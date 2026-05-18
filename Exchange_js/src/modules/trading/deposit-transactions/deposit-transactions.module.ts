import { Module } from '@nestjs/common';
import { DepositTransactionsController } from './deposit-transactions.controller';
import { DepositTransactionsService } from './deposit-transactions.service';
import { InboundTransferSignalsService } from './inbound-transfer-signals.service';
import { PayinsModule } from '../../asset-treasury/payins/payins.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { DepositWorkflowService } from './deposit-workflow.service';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';

@Module({
  imports: [PayinsModule, OnboardingModule, TigerBeetleModule],
  controllers: [DepositTransactionsController],
  providers: [
    DepositTransactionsService,
    InboundTransferSignalsService,
    DepositWorkflowService,
  ],
  exports: [DepositTransactionsService, DepositWorkflowService],
})
export class DepositTransactionsModule {}
