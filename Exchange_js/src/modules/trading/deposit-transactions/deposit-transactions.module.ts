import { Module, forwardRef } from '@nestjs/common';
import { DepositTransactionsController } from './deposit-transactions.controller';
import { DepositTransactionsService } from './deposit-transactions.service';
import { InboundTransferSignalsService } from './inbound-transfer-signals.service';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { DepositWorkflowService } from './deposit-workflow.service';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { FundsLayerModule } from '../../funds-layer/funds-layer.module';
import { FundsOrdersModule } from '../../funds-orders/funds-orders.module';
import { WithdrawalAddressesModule } from '../../asset-treasury/withdrawal-addresses/withdrawal-addresses.module';
import { TransactionLimitsModule } from '../../asset-treasury/transaction-limits/transaction-limits.module';

@Module({
  imports: [forwardRef(() => OnboardingModule), TigerBeetleModule, FundsLayerModule, FundsOrdersModule, WithdrawalAddressesModule, TransactionLimitsModule],
  controllers: [DepositTransactionsController],
  providers: [
    DepositTransactionsService,
    InboundTransferSignalsService,
    DepositWorkflowService,
  ],
  exports: [DepositTransactionsService, DepositWorkflowService],
})
export class DepositTransactionsModule {}
