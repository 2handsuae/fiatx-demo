import { Module, forwardRef } from '@nestjs/common';
import { TierUpgradeCaseService } from './tier-upgrade-case.service';
import { TierUpgradeCaseApprovalProjectionService } from './tier-upgrade-case-approval-projection.service';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
  imports: [
    ApprovalsModule,
    forwardRef(() => OnboardingModule), // provides SumsubClient
  ],
  providers: [TierUpgradeCaseService, TierUpgradeCaseApprovalProjectionService],
  exports: [TierUpgradeCaseService],
})
export class TierUpgradeCaseModule {}
