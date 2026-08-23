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
import { DepositSumsubModule } from '../../deposit-sumsub/deposit-sumsub.module';
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

@Module({
  imports: [
    // Task 9：本域 workflow 注入 CustomerAccessService（客户级能力闸 + 在途单冻结订阅）
    forwardRef(() => CustomersModule),
    forwardRef(() => OnboardingModule),
    TigerBeetleModule,
    FundsLayerModule,
    FundsOrdersModule,
    WithdrawalAddressesModule,
    forwardRef(() => DepositSumsubModule),
    TransactionLimitsModule,
    ApprovalsModule,
    // Task 8：DepositApplicantActionsService 改走材料账，需要 issuer/requests service
    forwardRef(() => MaterialRequestsModule),
    // B4（第四批）：DepositWorkflowService 的 Gate 0 注入 L1GateService（三域共用的
    // L1 快照求值器）。与提现/兑换同形状的平引用即可 —— L1GateModule 自己已用
    // forwardRef 解开与 CustomersModule 的真实 require 环。
    L1GateModule,
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
  ],
  exports: [DepositTransactionsService, DepositWorkflowService, DepositApplicantActionsService],
})
export class DepositTransactionsModule {}
