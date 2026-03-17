import { Module } from '@nestjs/common';
import { RiskEngineService } from './risk-engine.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { RiskDecisionRecordsService } from './risk-decision-records.service';
import { RiskDecisionRecordsAdminController } from './risk-decision-records-admin.controller';
import { ComplianceAlertsModule } from './compliance-alerts/compliance-alerts.module';
import { RiskDecisionOrchestratorService } from './risk-decision-orchestrator.service';

@Module({
  imports: [PrismaModule, ComplianceAlertsModule],
  providers: [
    RiskEngineService,
    RiskDecisionRecordsService,
    RiskDecisionOrchestratorService,
  ],
  controllers: [RiskDecisionRecordsAdminController],
  exports: [
    RiskEngineService,
    RiskDecisionRecordsService,
    RiskDecisionOrchestratorService,
  ],
})
export class RiskEngineModule {}
