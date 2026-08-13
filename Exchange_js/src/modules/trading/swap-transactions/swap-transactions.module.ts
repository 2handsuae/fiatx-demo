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
import { CustomersModule } from '../../identity/customers/customers.module';

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
    // Task 5: forwardRef — SwapSumsubModule → SwapTransactionsModule is now
    // reachable via a deep require chain that starts inside WalletsModule's own
    // file (AppModule → AssetsModule/WalletsModule → OnboardingModule → ... →
    // SumsubIngestionModule → SwapSumsubModule → here), i.e. before
    // wallets.module.ts finishes executing and exports its WalletsModule class.
    // A plain (non-forwardRef) reference here captures `undefined` at
    // @Module() decoration time in that ordering and fails at bootstrap ("The
    // module at index [n] ... is undefined") — TypeScript compiles clean, this
    // only surfaces when the app/DI graph actually boots. forwardRef defers
    // reading the binding until Nest's scanner runs, by which point the
    // (shared, live) module.exports object has been fully populated.
    forwardRef(() => WalletsModule),
    TransactionLimitsModule,
    // Task 4: SwapWorkflowService injects SUMSUB_TXN_CLIENT (submitSumsubTxnOut)
    // — same provider deposit/withdraw already use. forwardRef mirrors
    // WithdrawTransactionsModule's identical import (future SwapSumsubModule →
    // SumsubIngestionModule → SwapTransactionsModule would otherwise cycle).
    forwardRef(() => DepositSumsubModule),
    // Task 7: SwapWorkflowService injects CustomerRestrictionsService +
    // CustomerPendingActionService (handleRejectDisposition). Plain import
    // (no forwardRef) — CustomersModule only depends on PrismaModule
    // (@Global) and NotificationsModule (a leaf module), so there is no path
    // back from CustomersModule to SwapTransactionsModule to cycle on.
    CustomersModule,
  ],
  controllers: [SwapTransactionsController, SwapTransactionsCustomerController],
  providers: [SwapTransactionsService, SwapWorkflowService, SwapLegAccounting],
  exports: [SwapTransactionsService, SwapWorkflowService],
})
export class SwapTransactionsModule {}
