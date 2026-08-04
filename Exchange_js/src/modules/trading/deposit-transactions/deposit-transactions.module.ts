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
import { DepositVerificationSessionService } from './deposit-verification-session.service';

@Module({
  imports: [
    forwardRef(() => OnboardingModule),
    TigerBeetleModule,
    FundsLayerModule,
    FundsOrdersModule,
    WithdrawalAddressesModule,
    forwardRef(() => DepositSumsubModule),
    TransactionLimitsModule,
    ApprovalsModule,
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
    DepositVerificationSessionService,
  ],
  exports: [DepositTransactionsService, DepositWorkflowService],
})
export class DepositTransactionsModule {}
