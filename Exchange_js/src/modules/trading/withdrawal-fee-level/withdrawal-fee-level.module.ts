import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';
import { WithdrawalFeeLevelService } from './withdrawal-fee-level.service';
import { WithdrawalFeeLevelBindingService } from './withdrawal-fee-level-binding.service';
import { WithdrawalFeeLevelCreationApprovalService } from './withdrawal-fee-level-creation-approval.service';
import { WithdrawalFeeLevelChangeApprovalService } from './withdrawal-fee-level-change-approval.service';
import { WithdrawalFeeLevelCreationWorkflowService } from './withdrawal-fee-level-creation-workflow.service';
import { WithdrawalFeeLevelChangeWorkflowService } from './withdrawal-fee-level-change-workflow.service';
import { WithdrawalFeeLevelBindingWorkflowService } from './withdrawal-fee-level-binding-workflow.service';
import { WithdrawQuoteService } from './withdraw-quote.service';
import { WithdrawalFeeLevelController } from './withdrawal-fee-level.controller';
import { WithdrawQuoteCustomerController } from './withdraw-quote-customer.controller';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';

@Module({
  imports: [PrismaModule, ApprovalsModule, AuditLogsModule, forwardRef(() => PricingCenterModule), forwardRef(() => OnboardingModule)],
  controllers: [WithdrawalFeeLevelController, WithdrawQuoteCustomerController],
  providers: [
    WithdrawalFeeLevelService,
    WithdrawalFeeLevelBindingService,
    WithdrawalFeeLevelCreationApprovalService,
    WithdrawalFeeLevelChangeApprovalService,
    WithdrawalFeeLevelCreationWorkflowService,
    WithdrawalFeeLevelChangeWorkflowService,
    WithdrawalFeeLevelBindingWorkflowService,
    WithdrawQuoteService,
  ],
  exports: [WithdrawalFeeLevelService, WithdrawQuoteService],
})
export class WithdrawalFeeLevelModule {}
