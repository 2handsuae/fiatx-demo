import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingService } from './onboarding.service';
import { OnboardingCustomerController } from './onboarding-customer.controller';
import { OnboardingAdminController } from './onboarding-admin.controller';
import { RiskEngineModule } from '../../risk-engine/risk-engine.module';
import { ComplianceIncidentsModule } from '../../risk-engine/compliance-incidents/compliance-incidents.module';
import { WorkflowTransitionService } from './workflow-transition.service';
import { OnboardingWorkflowTransitionService } from './onboarding-workflow-transition.service';

@Module({
  imports: [PrismaModule, RiskEngineModule, ComplianceIncidentsModule],
  providers: [
    OnboardingService,
    WorkflowTransitionService,
    OnboardingWorkflowTransitionService,
  ],
  controllers: [OnboardingCustomerController, OnboardingAdminController],
  exports: [OnboardingService],
})
export class OnboardingModule {}
