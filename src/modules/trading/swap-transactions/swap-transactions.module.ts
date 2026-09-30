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
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { NotificationsModule } from '../../../core/notifications/notifications.module';
import { SwapUnfreezeApprovalService } from './swap-unfreeze-approval.service';
import { SwapSanctionRefundApprovalService } from './swap-sanction-refund-approval.service';

@Module({
  imports: [
    PrismaModule,
    PricingCenterModule,
    SwapFeeLevelModule,
    TigerBeetleModule,
    AuditLogsModule,
    FundsLayerModule,
    FundsOrdersModule,
    // Task 5：曾经 forwardRef —— SwapSumsubModule → SwapTransactionsModule 曾经
    // 可经一条深层 require 链到达 WalletsModule 自己的文件（AppModule →
    // AssetsModule/WalletsModule → OnboardingModule → ... → SumsubIngestionModule
    // → SwapSumsubModule → here），早于 wallets.module.ts 执行完并导出
    // WalletsModule 类；当时若用 plain reference 会在 @Module() 装饰期捕获到
    // `undefined`，编译期不报错、启动期才炸（"module at index [n] is
    // undefined"）。
    // 站3-α2（2026-08-27）：那条深层 require 链已断根（演示件摘入 SwapDemoModule，
    // 模块↔ingestion 环就地解开），此处已改回 plain reference，不再是 forwardRef。
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
    // 曾经 forwardRef kept defensively — CustomersModule pulls in ApprovalsModule
    // and FundsOrdersModule, either of which could plausibly cycle back to
    // this module through the app's deep import graph.
    // 站3-α2（2026-08-27）：这条防御性 forwardRef 已随两条装载链断根一并拆除并
    // 通过开机考——顾虑的环路未真实存在，此处已改回 plain reference。
    CustomersModule,
    // Task 10: SwapWorkflowService injects MaterialRequestsService +
    // MaterialRequestIssuerService (handleRejectDisposition 改走材料账).
    // 曾经 forwardRef：MaterialRequestsModule 反过来 import SwapSumsubModule（拿
    // SwapApplicantActionHandler 的 GREEN 回调），而 SwapSumsubModule 又
    // forwardRef 本模块 —— 同一条环上再加一段，同样必须 forwardRef。
    // 站3-α2（2026-08-27）：材料复核→兑换的直调已事件化（SwapApplicantActionHandler
    // 改听 MATERIAL_REQUEST_REVIEWED 域事件），MaterialRequestsModule 不再 import
    // SwapSumsubModule，上述环路已不存在；此处已改回 plain reference。
    MaterialRequestsModule,
    // B2（第四批）：SwapWorkflowService 注入 L1GateService（三域共用的 L1 快照求值器）。
    L1GateModule,
    // 波五 Task 3：SwapWorkflowService 注入 ApprovalsService（initiateUnfreeze/
    // initiateRefund 走 maker-checker 正门），同 WithdrawTransactionsModule 的引法。
    ApprovalsModule,
    // 战役丙波一 T7：SwapTransactionsService.markStatus 每次状态落地都调
    // NotificationsService.notifyOrderStatusChange 通知客户（同 T5/T6 引法）。
    NotificationsModule,
  ],
  controllers: [SwapTransactionsController, SwapTransactionsCustomerController],
  providers: [
    SwapTransactionsService,
    SwapWorkflowService,
    SwapLegAccounting,
    SwapUnfreezeApprovalService,
    SwapSanctionRefundApprovalService,
  ],
  exports: [SwapTransactionsService, SwapWorkflowService],
})
export class SwapTransactionsModule {}
