// material-refresh.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { MaterialRefreshService } from './material-refresh.service';
import { MaterialFreshnessCronService } from './material-freshness-cron.service';
import { MaterialRefreshReviewListener } from './material-refresh-review.listener';
import { AdminMaterialManagementController } from './admin-material-management.controller';
import { MaterialRefreshPolicyLoader } from './policy/material-refresh-policy';
import { SumsubApplicantClientModule } from '../../sumsub-applicant-client/sumsub-applicant-client.module';
import { CustomersModule } from '../customers/customers.module';
import { MaterialRequestsModule } from '../material-requests/material-requests.module';

@Module({
  imports: [
    // Task 7：本模块的自动写入点改走限制账（CustomerRestrictionsService /
    // CustomerRestrictionWorkflowService），两者由 CustomersModule exports。
    forwardRef(() => CustomersModule),
    SumsubApplicantClientModule,
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
// 站6：CRA 随一期拆除（业主方案2），可选钩子（onModuleInit 属性注入）一并断开。
export class MaterialRefreshModule {}
