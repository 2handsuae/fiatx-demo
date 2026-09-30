import { Module } from '@nestjs/common';
import { DepositTransactionsController } from './deposit-transactions.controller';
import { DepositTransactionsService } from './deposit-transactions.service';
import { InboundTransferSignalsService } from './inbound-transfer-signals.service';
import { DepositWorkflowService } from './deposit-workflow.service';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { FundsLayerModule } from '../../funds-layer/funds-layer.module';
import { FundsOrdersModule } from '../../funds-orders/funds-orders.module';
import { WithdrawalAddressesModule } from '../../asset-treasury/withdrawal-addresses/withdrawal-addresses.module';
import { SumsubTxnClientModule } from '../../sumsub-shared/sumsub-txn-client.module';
import { TransactionLimitsModule } from '../../asset-treasury/transaction-limits/transaction-limits.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { DepositConfiscationApprovalService } from './deposit-confiscation-approval.service';
import { DepositReturnApprovalService } from './deposit-return-approval.service';
import { DepositSeizeApprovalService } from './deposit-seize-approval.service';
import { DepositUnfreezeApprovalService } from './deposit-unfreeze-approval.service';
import { DepositApplicantActionsService } from './deposit-applicant-actions.service';
import { CustomersModule } from '../../identity/customers/customers.module';
import { MaterialRequestsModule } from '../../identity/material-requests/material-requests.module';
import { L1GateModule } from '../shared/l1-gate/l1-gate.module';
import { ReconciliationModule } from '../../clearing-settle/reconciliation/reconciliation.module';
import { DepositSupplementApprovalService } from './deposit-supplement-approval.service';
import { DepositClawbackApprovalService } from './deposit-clawback-approval.service';
import { NotificationsModule } from '../../../core/notifications/notifications.module';

@Module({
  imports: [
    // Task 9：本域 workflow 注入 CustomerAccessService（客户级能力闸 + 在途单冻结订阅）。
    // 站3-α2（2026-08-27）解包完成：站1b 实测钉住这三张的两条文件级装载链
    // （identity→swap-sumsub 直调环、identity→CRA→ingestion 枢纽环）已分别以
    // 事件化与演示件独立挂载拆断（链路图见站3 α2 提交），开机考通过后全部平引用。
    CustomersModule,
    TigerBeetleModule,
    FundsLayerModule,
    FundsOrdersModule,
    WithdrawalAddressesModule,
    // 站1b-α2：本域只需要 SUMSUB_TXN_CLIENT 一个 provider——改引零依赖的令牌
    // 叶子模块，与 DepositSumsubModule 的双向环就地解开（详见该模块头注）。
    SumsubTxnClientModule,
    TransactionLimitsModule,
    ApprovalsModule,
    // Task 8：DepositApplicantActionsService 改走材料账，需要 issuer/requests service。
    MaterialRequestsModule,
    // B4（第四批）：DepositWorkflowService 的 L1 注入 L1GateService（三域共用的
    // L1 快照求值器）。与提现/兑换同形状的平引用即可 —— L1GateModule 自己已用
    // forwardRef 解开与 CustomersModule 的真实 require 环。
    L1GateModule,
    // 平账 B 批 ①：initiateSupplement 要靠 SupplementEvidenceService 查证账单行、
    // onSupplementDecided 批准后要靠 DispositionService 回挂/改写补单号。
    ReconciliationModule,
    // 战役丙波一 T5：updateStatus 每次状态落地都调
    // NotificationsService.notifyOrderStatusChange 通知客户。
    NotificationsModule,
  ],
  controllers: [DepositTransactionsController],
  providers: [
    DepositTransactionsService,
    InboundTransferSignalsService,
    DepositWorkflowService,
    DepositConfiscationApprovalService,
    DepositReturnApprovalService,
    DepositSeizeApprovalService,
    DepositUnfreezeApprovalService,
    DepositApplicantActionsService,
    DepositSupplementApprovalService,
    DepositClawbackApprovalService,
  ],
  exports: [DepositTransactionsService, DepositWorkflowService, DepositApplicantActionsService],
})
export class DepositTransactionsModule {}
