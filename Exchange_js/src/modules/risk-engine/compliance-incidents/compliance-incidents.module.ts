import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { ComplianceAlertsModule } from '../compliance-alerts/compliance-alerts.module';
import { ComplianceCaseEvidencePackagesController } from './compliance-case-evidence-packages.controller';
import { ComplianceCaseEvidencePackagesService } from './compliance-case-evidence-packages.service';
import { ComplianceCasesAdminController } from './compliance-cases-admin.controller';
import { ComplianceCaseSlaSweepService } from './compliance-case-sla-sweep.service';
import { ComplianceIncidentsService } from './compliance-incidents.service';
import { WorkflowTransitionService } from '../../identity/onboarding/workflow-transition.service';
import { OnboardingWorkflowTransitionService } from '../../identity/onboarding/onboarding-workflow-transition.service';
import { PeriodicReviewWorkflowTransitionService } from '../../identity/periodic-review/periodic-review-workflow-transition.service';
import { OnboardingFinalApprovalService } from '../../identity/onboarding/onboarding-final-approval.service';

@Module({
  imports: [PrismaModule, ComplianceAlertsModule, ApprovalsModule],
  providers: [
    ComplianceIncidentsService,
    WorkflowTransitionService,
    OnboardingWorkflowTransitionService,
    PeriodicReviewWorkflowTransitionService,
    OnboardingFinalApprovalService,
    ComplianceCaseEvidencePackagesService,
    ComplianceCaseSlaSweepService,
  ],
  controllers: [
    ComplianceCaseEvidencePackagesController,
    ComplianceCasesAdminController,
  ],
  exports: [ComplianceIncidentsService, ComplianceCaseEvidencePackagesService],
})
export class ComplianceIncidentsModule {}
