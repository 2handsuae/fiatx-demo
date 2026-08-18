import { Module, forwardRef } from '@nestjs/common';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { WithdrawTransactionsController } from './withdraw-transactions.controller';
import { CustomerWithdrawController } from './customer-withdraw.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { CustomersModule } from '../../identity/customers/customers.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
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
import { DepositSumsubModule } from '../../deposit-sumsub/deposit-sumsub.module';
import { MaterialRequestsModule } from '../../identity/material-requests/material-requests.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => OnboardingModule),
    // Task 5：WithdrawWorkflowService 注入 CustomerAccessService（客户级能力闸）
    forwardRef(() => CustomersModule),
    TigerBeetleModule,
    WithdrawalFeeLevelModule,
    ApprovalsModule,
    PricingCenterModule,
    FundsLayerModule,
    FundsOrdersModule,
    TransactionLimitsModule,
    // Task 5: WithdrawWorkflowService injects SUMSUB_TXN_CLIENT (submitSumsubTxn) —
    // same provider deposit already uses. forwardRef: WithdrawTransactionsModule →
    // DepositSumsubModule → SumsubIngestionModule → WithdrawTransactionsModule closes
    // a cycle (mirrors DepositTransactionsModule's identical import).
    forwardRef(() => DepositSumsubModule),
    // Task 9：WithdrawApplicantActionsService 改走材料账，需要 issuer/requests service
    forwardRef(() => MaterialRequestsModule),
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
