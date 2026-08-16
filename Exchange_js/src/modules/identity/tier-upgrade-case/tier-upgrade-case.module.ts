import { Module, forwardRef } from '@nestjs/common';
import { TierUpgradeCaseService } from './tier-upgrade-case.service';
import { TierUpgradeCaseApprovalProjectionService } from './tier-upgrade-case-approval-projection.service';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [
    // Task 7：本模块的自动写入点改走限制账（CustomerRestrictionsService /
    // CustomerRestrictionWorkflowService），两者由 CustomersModule exports。
    forwardRef(() => CustomersModule),
    ApprovalsModule,
    forwardRef(() => OnboardingModule), // provides SumsubClient
  ],
  providers: [TierUpgradeCaseService, TierUpgradeCaseApprovalProjectionService],
  exports: [TierUpgradeCaseService],
})
export class TierUpgradeCaseModule {}
