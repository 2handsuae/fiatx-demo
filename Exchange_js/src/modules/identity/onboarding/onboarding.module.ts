import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingService } from './onboarding.service';
import { OnboardingCustomerController } from './onboarding-customer.controller';
import { OnboardingAdminController } from './onboarding-admin.controller';
import { RiskEngineModule } from '../../risk-engine/risk-engine.module';
import { ComplianceAlertsModule } from '../../risk-engine/compliance-alerts/compliance-alerts.module';
import { ComplianceIncidentsModule } from '../../risk-engine/compliance-incidents/compliance-incidents.module';

@Module({
  imports: [PrismaModule, RiskEngineModule, ComplianceAlertsModule, ComplianceIncidentsModule],
  providers: [OnboardingService],
  controllers: [OnboardingCustomerController, OnboardingAdminController],
  exports: [OnboardingService],
})
export class OnboardingModule {}
