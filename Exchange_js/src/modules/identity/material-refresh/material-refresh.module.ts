// material-refresh.module.ts
import { Module, forwardRef, OnModuleInit } from '@nestjs/common';
import { MaterialRefreshService } from './material-refresh.service';
import { MaterialFreshnessCronService } from './material-freshness-cron.service';
import { MaterialRefreshReviewListener } from './material-refresh-review.listener';
import { AdminMaterialManagementController } from './admin-material-management.controller';
import { MaterialRefreshPolicyLoader } from './policy/material-refresh-policy';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { ClientRiskAssessmentModule } from '../client-risk-assessment/client-risk-assessment.module';
import { ClientRiskAssessmentService } from '../client-risk-assessment/client-risk-assessment.service';
import { CustomersModule } from '../customers/customers.module';
import { MaterialRequestsModule } from '../material-requests/material-requests.module';

@Module({
  imports: [
    // Task 7：本模块的自动写入点改走限制账（CustomerRestrictionsService /
    // CustomerRestrictionWorkflowService），两者由 CustomersModule exports。
    forwardRef(() => CustomersModule),
    forwardRef(() => OnboardingModule),
    forwardRef(() => ClientRiskAssessmentModule),
    // Task 11：T-30 建行改走 MaterialRequestIssuerService.issue()，T-0 升档补挂
    // 限制改走 MaterialRequestsService.attachRestriction()。forwardRef：
    // MaterialRequestsModule 反过来也引本模块拿 MaterialRefreshPolicyLoader。
    forwardRef(() => MaterialRequestsModule),
  ],
  providers: [
    MaterialRefreshService,
    MaterialFreshnessCronService,
    MaterialRefreshPolicyLoader,
    // 2026-08-18 修回归：材料重检域自己监听 MATERIAL_REQUEST_REVIEWED 完成收尾
    // （见 material-refresh-review.listener.ts 顶部注释）。
    MaterialRefreshReviewListener,
  ],
  controllers: [AdminMaterialManagementController],
  // MaterialRefreshPolicyLoader：MaterialRequestsModule 建行时按 materialType
  // 查 Sumsub 认证等级名，需要从这里拿注册表（2026-08-17 材料请求账）。
  exports: [MaterialRefreshService, MaterialRefreshPolicyLoader],
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
