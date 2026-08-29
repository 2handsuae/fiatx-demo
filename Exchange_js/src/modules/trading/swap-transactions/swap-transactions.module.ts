import { Module } from '@nestjs/common';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowService } from './swap-workflow.service';
import { SwapLegAccounting } from './swap-leg-accounting';
import { SwapTransactionsController } from './swap-transactions.controller';
import { SwapTransactionsCustomerController } from './swap-transactions-customer.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';
import { SwapFeeLevelModule } from '../swap-fee-level/swap-fee-level.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { FundsLayerModule } from '../../funds-layer/funds-layer.module';
import { FundsOrdersModule } from '../../funds-orders/funds-orders.module';
import { WalletsModule } from '../../asset-treasury/wallets/wallets.module';
import { TransactionLimitsModule } from '../../asset-treasury/transaction-limits/transaction-limits.module';
import { SumsubTxnClientModule } from '../../sumsub-shared/sumsub-txn-client.module';
import { CustomersModule } from '../../identity/customers/customers.module';
import { MaterialRequestsModule } from '../../identity/material-requests/material-requests.module';
import { L1GateModule } from '../shared/l1-gate/l1-gate.module';

@Module({
  imports: [
    PrismaModule,
    PricingCenterModule,
    SwapFeeLevelModule,
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
    WalletsModule,
    TransactionLimitsModule,
    // Task 4: SwapWorkflowService injects SUMSUB_TXN_CLIENT (submitSumsubTxnOut)
    // — same provider deposit/withdraw already use. forwardRef mirrors
    // WithdrawTransactionsModule's identical import (future SwapSumsubModule →
    // SumsubIngestionModule → SwapTransactionsModule would otherwise cycle).
    // 站3-α2：本域只需要 SUMSUB_TXN_CLIENT 一个 provider——改引零依赖令牌叶子，
    // 对 DepositSumsubModule 的 forwardRef 环就地拆除（镜像站1b/站2）。
    SumsubTxnClientModule,
    // Task 7: SwapWorkflowService injects CustomerRestrictionsService +
    // CustomersService (handleRejectDisposition; Task 12 moved the hard-line
    // marker here from the now-deleted customer-pending-action service).
    // forwardRef kept defensively — CustomersModule pulls in ApprovalsModule
    // and FundsOrdersModule, either of which could plausibly cycle back to
    // this module through the app's deep import graph; same defensive
    // stance as the (Wallets/此处) pair below.
    CustomersModule,
    // Task 10: SwapWorkflowService injects MaterialRequestsService +
    // MaterialRequestIssuerService (handleRejectDisposition 改走材料账).
    // forwardRef: MaterialRequestsModule 反过来 import SwapSumsubModule（拿
    // SwapApplicantActionHandler 的 GREEN 回调），而 SwapSumsubModule 又
    // forwardRef 本模块 —— 同一条环上再加一段，同样必须 forwardRef。
    MaterialRequestsModule,
    // B2（第四批）：SwapWorkflowService 注入 L1GateService（三域共用的 L1 快照求值器）。
    L1GateModule,
  ],
  controllers: [SwapTransactionsController, SwapTransactionsCustomerController],
  providers: [SwapTransactionsService, SwapWorkflowService, SwapLegAccounting],
  exports: [SwapTransactionsService, SwapWorkflowService],
})
export class SwapTransactionsModule {}
