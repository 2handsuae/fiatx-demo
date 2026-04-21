// material-refresh.module.ts
import { Module, forwardRef, OnModuleInit } from '@nestjs/common';
import { MaterialRefreshService } from './material-refresh.service';
import { MaterialFreshnessCronService } from './material-freshness-cron.service';
import { MaterialRefreshCyclesController } from './material-refresh-cycles.controller';
import { AdminMaterialManagementController } from './admin-material-management.controller';
import { MaterialRefreshPolicyLoader } from './policy/material-refresh-policy';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { ClientRiskAssessmentModule } from '../client-risk-assessment/client-risk-assessment.module';
import { ClientRiskAssessmentService } from '../client-risk-assessment/client-risk-assessment.service';

@Module({
  imports: [
    forwardRef(() => OnboardingModule),
    forwardRef(() => ClientRiskAssessmentModule),
  ],
  providers: [
    MaterialRefreshService,
    MaterialFreshnessCronService,
    MaterialRefreshPolicyLoader,
  ],
  controllers: [MaterialRefreshCyclesController, AdminMaterialManagementController],
  exports: [MaterialRefreshService],
})
export class MaterialRefreshModule implements OnModuleInit {
  constructor(
    private readonly materialRefreshService: MaterialRefreshService,
    private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
  ) {}

  onModuleInit() {
    this.materialRefreshService.clientRiskAssessmentService = this.clientRiskAssessmentService;
  }
}
