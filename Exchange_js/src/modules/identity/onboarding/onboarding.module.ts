import { Module, forwardRef, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingService } from './onboarding.service';
import { OnboardingCustomerController } from './onboarding-customer.controller';
import { OnboardingAdminController } from './onboarding-admin.controller';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { OnboardingFinalApprovalService } from './onboarding-final-approval.service';
import { SumsubClient } from './providers/sumsub/sumsub.client';
import { MaterialRefreshModule } from '../material-refresh/material-refresh.module';
import { MaterialRefreshService } from '../material-refresh/material-refresh.service';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [
    PrismaModule,
    ApprovalsModule,
    forwardRef(() => MaterialRefreshModule),
    // Task 5：OnboardingService 注入 CustomerAccessService（交易门收敛）。
    // CustomersModule 本来就 forwardRef 回本模块（客户级补料会话取 SumsubClient），
    // 双向都必须 forwardRef，否则 require 环里有一侧在 @Module() 装饰时读到 undefined。
    forwardRef(() => CustomersModule),
  ],
  providers: [
    OnboardingService,
    OnboardingFinalApprovalService,
    SumsubClient,
  ],
  controllers: [
    OnboardingCustomerController,
    OnboardingAdminController,
  ],
  exports: [OnboardingService, OnboardingFinalApprovalService, SumsubClient],
})
export class OnboardingModule implements OnModuleInit {
  constructor(
    private readonly finalApprovalService: OnboardingFinalApprovalService,
    private readonly materialRefreshService: MaterialRefreshService,
  ) {}

  onModuleInit() {
    this.finalApprovalService.materialRefreshService = this.materialRefreshService;
  }
}
