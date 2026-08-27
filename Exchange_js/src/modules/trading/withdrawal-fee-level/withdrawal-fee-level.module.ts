import { Module} from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';
import { WithdrawalFeeLevelService } from './withdrawal-fee-level.service';
import { WithdrawalFeeLevelCreationApprovalService } from './withdrawal-fee-level-creation-approval.service';
import { WithdrawalFeeLevelChangeApprovalService } from './withdrawal-fee-level-change-approval.service';
import { WithdrawalFeeLevelCreationWorkflowService } from './withdrawal-fee-level-creation-workflow.service';
import { WithdrawalFeeLevelChangeWorkflowService } from './withdrawal-fee-level-change-workflow.service';
import { WithdrawQuoteService } from './withdraw-quote.service';
import { WithdrawalFeeLevelController } from './withdrawal-fee-level.controller';
import { WithdrawQuoteCustomerController } from './withdraw-quote-customer.controller';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { CustomerTagModule } from '../../identity/customer-tags/customer-tag.module';

@Module({
  imports: [PrismaModule, ApprovalsModule, AuditLogsModule, PricingCenterModule, OnboardingModule, CustomerTagModule],
  controllers: [WithdrawalFeeLevelController, WithdrawQuoteCustomerController],
  providers: [
    WithdrawalFeeLevelService,
    WithdrawalFeeLevelCreationApprovalService,
    WithdrawalFeeLevelChangeApprovalService,
    WithdrawalFeeLevelCreationWorkflowService,
    WithdrawalFeeLevelChangeWorkflowService,
    WithdrawQuoteService,
  ],
  exports: [WithdrawalFeeLevelService, WithdrawQuoteService],
})
export class WithdrawalFeeLevelModule {}
