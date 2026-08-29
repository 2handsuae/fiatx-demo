import { Module } from '@nestjs/common';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { WithdrawTransactionsController } from './withdraw-transactions.controller';
import { CustomerWithdrawController } from './customer-withdraw.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { CustomersModule } from '../../identity/customers/customers.module';
import { WithdrawWorkflowService } from './withdraw-workflow.service';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { WithdrawalFeeLevelModule } from '../withdrawal-fee-level/withdrawal-fee-level.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';
import { WithdrawLargeValueApprovalService } from './withdraw-large-value-approval.service';
import { WithdrawUnfreezeApprovalService } from './withdraw-unfreeze-approval.service';
import { WithdrawSanctionRefundApprovalService } from './withdraw-sanction-refund-approval.service';
import { WithdrawApplicantActionsService } from './withdraw-applicant-actions.service';
import { FundsLayerModule } from '../../funds-layer/funds-layer.module';
import { FundsOrdersModule } from '../../funds-orders/funds-orders.module';
import { TransactionLimitsModule } from '../../asset-treasury/transaction-limits/transaction-limits.module';
import { SumsubTxnClientModule } from '../../sumsub-shared/sumsub-txn-client.module';
import { MaterialRequestsModule } from '../../identity/material-requests/material-requests.module';
import { L1GateModule } from '../shared/l1-gate/l1-gate.module';

@Module({
  imports: [
    PrismaModule,
    // 站3-α2（2026-08-27）解包完成：站2 实测钉住的装载链已在站3 拆断
    // （swap-sumsub 直调环事件化 + CRA→ingestion 演示件独立挂载），开机考通过后平引用。
    CustomersModule,
    TigerBeetleModule,
    WithdrawalFeeLevelModule,
    ApprovalsModule,
    PricingCenterModule,
    FundsLayerModule,
    FundsOrdersModule,
    TransactionLimitsModule,
    // 站2-α2：本域只需要 SUMSUB_TXN_CLIENT 一个 provider——改引零依赖的令牌
    // 叶子模块（站1b 抽出），对 DepositSumsubModule 的 forwardRef 环就地拆除。
    SumsubTxnClientModule,
    // Task 9：WithdrawApplicantActionsService 改走材料账，需要 issuer/requests service
    MaterialRequestsModule,
    // B2（第四批）：WithdrawWorkflowService 注入 L1GateService（三域共用的 L1 快照求值器）。
    L1GateModule,
  ],
  controllers: [WithdrawTransactionsController, CustomerWithdrawController],
  providers: [
    WithdrawTransactionsService,
    WithdrawWorkflowService,
    WithdrawLargeValueApprovalService,
    WithdrawUnfreezeApprovalService,
    WithdrawSanctionRefundApprovalService,
    WithdrawApplicantActionsService,
  ],
  exports: [
    WithdrawTransactionsService,
    WithdrawWorkflowService,
    WithdrawApplicantActionsService,
  ],
})
export class WithdrawTransactionsModule {}
