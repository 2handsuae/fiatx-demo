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
