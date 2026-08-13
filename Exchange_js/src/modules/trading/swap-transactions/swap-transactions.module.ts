import { Module, forwardRef } from '@nestjs/common';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowService } from './swap-workflow.service';
import { SwapLegAccounting } from './swap-leg-accounting';
import { SwapTransactionsController } from './swap-transactions.controller';
import { SwapTransactionsCustomerController } from './swap-transactions-customer.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';
import { SwapFeeLevelModule } from '../swap-fee-level/swap-fee-level.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { FundsLayerModule } from '../../funds-layer/funds-layer.module';
import { FundsOrdersModule } from '../../funds-orders/funds-orders.module';
import { WalletsModule } from '../../asset-treasury/wallets/wallets.module';
import { TransactionLimitsModule } from '../../asset-treasury/transaction-limits/transaction-limits.module';
import { DepositSumsubModule } from '../../deposit-sumsub/deposit-sumsub.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => OnboardingModule),
    PricingCenterModule,
    forwardRef(() => SwapFeeLevelModule),
    TigerBeetleModule,
    AuditLogsModule,
    FundsLayerModule,
    FundsOrdersModule,
    WalletsModule,
    TransactionLimitsModule,
    // Task 4: SwapWorkflowService injects SUMSUB_TXN_CLIENT (submitSumsubTxnOut)
    // — same provider deposit/withdraw already use. forwardRef mirrors
    // WithdrawTransactionsModule's identical import (future SwapSumsubModule →
    // SumsubIngestionModule → SwapTransactionsModule would otherwise cycle).
    forwardRef(() => DepositSumsubModule),
  ],
  controllers: [SwapTransactionsController, SwapTransactionsCustomerController],
  providers: [SwapTransactionsService, SwapWorkflowService, SwapLegAccounting],
  exports: [SwapTransactionsService, SwapWorkflowService],
})
export class SwapTransactionsModule {}
