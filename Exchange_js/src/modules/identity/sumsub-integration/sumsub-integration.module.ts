// sumsub-integration.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { SumsubWebhookDispatcher } from './sumsub-webhook-dispatcher.service';
import { AdminSumsubSimulationController } from './admin-sumsub-simulation.controller';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { ClientRiskAssessmentModule } from '../client-risk-assessment/client-risk-assessment.module';
import { MaterialRefreshModule } from '../material-refresh/material-refresh.module';

@Module({
  imports: [
    forwardRef(() => OnboardingModule),
    forwardRef(() => ClientRiskAssessmentModule),
    forwardRef(() => MaterialRefreshModule),
  ],
  providers: [SumsubWebhookDispatcher],
  controllers: [AdminSumsubSimulationController],
  exports: [SumsubWebhookDispatcher],
})
export class SumsubIntegrationModule {}
