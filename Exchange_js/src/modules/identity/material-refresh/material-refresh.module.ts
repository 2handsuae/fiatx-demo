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
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [
    // Task 7：本模块的自动写入点改走限制账（CustomerRestrictionsService /
    // CustomerRestrictionWorkflowService），两者由 CustomersModule exports。
    forwardRef(() => CustomersModule),
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
