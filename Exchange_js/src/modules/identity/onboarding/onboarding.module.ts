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

@Module({
  imports: [
    PrismaModule,
    ApprovalsModule,
    forwardRef(() => MaterialRefreshModule),
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
