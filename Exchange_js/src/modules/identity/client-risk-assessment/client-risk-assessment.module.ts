// client-risk-assessment.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { ClientRiskAssessmentService } from './client-risk-assessment.service';
import { ClientRiskAssessmentCronService } from './client-risk-assessment-cron.service';
import { ClientRiskAssessmentController } from './client-risk-assessment.controller';
import { ClientRiskAssessmentPolicyLoader } from './policy/policy-loader';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';

@Module({
  imports: [
    forwardRef(() => OnboardingModule),
    ApprovalsModule,
  ],
  providers: [
    ClientRiskAssessmentService,
    ClientRiskAssessmentCronService,
    ClientRiskAssessmentPolicyLoader,
  ],
  controllers: [ClientRiskAssessmentController],
  exports: [ClientRiskAssessmentService],
})
export class ClientRiskAssessmentModule {}
