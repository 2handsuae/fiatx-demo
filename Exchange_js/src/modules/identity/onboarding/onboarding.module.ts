import { Module, forwardRef, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingService } from './onboarding.service';
import { OnboardingCustomerController } from './onboarding-customer.controller';
import { OnboardingAdminController } from './onboarding-admin.controller';
import { RiskEngineModule } from '../../risk-engine/risk-engine.module';
import { ComplianceIncidentsModule } from '../../risk-engine/compliance-incidents/compliance-incidents.module';
import { ComplianceAlertsModule } from '../../risk-engine/compliance-alerts/compliance-alerts.module';
import { WorkflowTransitionService } from './workflow-transition.service';
import { OnboardingWorkflowTransitionService } from './onboarding-workflow-transition.service';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { OnboardingFinalApprovalService } from './onboarding-final-approval.service';
import { PeriodicReviewService } from '../periodic-review/periodic-review.service';
import { PeriodicReviewCustomerController } from '../periodic-review/periodic-review-customer.controller';
import { PeriodicReviewAdminController } from '../periodic-review/periodic-review-admin.controller';
import { PeriodicReviewSweepService } from '../periodic-review/periodic-review-sweep.service';
import { PeriodicReviewWorkflowTransitionService } from '../periodic-review/periodic-review-workflow-transition.service';
import { SumsubClient } from './providers/sumsub/sumsub.client';
import { MaterialRefreshModule } from '../material-refresh/material-refresh.module';
import { MaterialRefreshService } from '../material-refresh/material-refresh.service';

@Module({
  imports: [
    PrismaModule,
    RiskEngineModule,
    ComplianceAlertsModule,
    ComplianceIncidentsModule,
    ApprovalsModule,
    forwardRef(() => MaterialRefreshModule),
  ],
  providers: [
    OnboardingService,
    WorkflowTransitionService,
    OnboardingWorkflowTransitionService,
    OnboardingFinalApprovalService,
    PeriodicReviewService,
    PeriodicReviewSweepService,
    PeriodicReviewWorkflowTransitionService,
    SumsubClient,
  ],
  controllers: [
    OnboardingCustomerController,
    OnboardingAdminController,
    PeriodicReviewCustomerController,
    PeriodicReviewAdminController,
  ],
  exports: [OnboardingService, OnboardingFinalApprovalService, PeriodicReviewService, SumsubClient],
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
