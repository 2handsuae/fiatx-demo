// client-risk-assessment.module.ts
import { Module, forwardRef, OnModuleInit } from '@nestjs/common';
import { ClientRiskAssessmentService } from './client-risk-assessment.service';
import { ClientRiskAssessmentCronService } from './client-risk-assessment-cron.service';
import { ClientRiskAssessmentApprovalProjectionService } from './client-risk-assessment-approval-projection.service';
import { ClientRiskAssessmentController, RiskAssessmentAdminController } from './client-risk-assessment.controller';
import { ClientRiskAssessmentCustomerController } from './client-risk-assessment-customer.controller';
import { ClientRiskAssessmentPolicyLoader } from './policy/policy-loader';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { MaterialRefreshModule } from '../material-refresh/material-refresh.module';
import { MaterialRefreshService } from '../material-refresh/material-refresh.service';
import { TierUpgradeCaseModule } from '../tier-upgrade-case/tier-upgrade-case.module';
import { SumsubIngestionModule } from '../../sumsub-ingestion/sumsub-ingestion.module';

@Module({
  imports: [
    forwardRef(() => OnboardingModule),
    forwardRef(() => MaterialRefreshModule),
    ApprovalsModule,
    TierUpgradeCaseModule,
    forwardRef(() => SumsubIngestionModule),
  ],
  providers: [
    ClientRiskAssessmentService,
    ClientRiskAssessmentCronService,
    ClientRiskAssessmentApprovalProjectionService,
    ClientRiskAssessmentPolicyLoader,
  ],
  controllers: [ClientRiskAssessmentController, RiskAssessmentAdminController, ClientRiskAssessmentCustomerController],
  exports: [ClientRiskAssessmentService],
})
export class ClientRiskAssessmentModule implements OnModuleInit {
  constructor(
    private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
    private readonly materialRefreshService: MaterialRefreshService,
  ) {}

  onModuleInit() {
    this.clientRiskAssessmentService.materialRefreshService =
      this.materialRefreshService;
  }
}
