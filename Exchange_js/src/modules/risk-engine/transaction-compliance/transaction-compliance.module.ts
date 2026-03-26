import { Module } from '@nestjs/common';
import { TransactionComplianceService } from './transaction-compliance.service';
import { TransactionComplianceAdminController } from './transaction-compliance-admin.controller';
import { RiskEngineModule } from '../risk-engine.module';
import { ComplianceIncidentsModule } from '../compliance-incidents/compliance-incidents.module';
import { ComplianceAlertsModule } from '../compliance-alerts/compliance-alerts.module';
import { TransactionRiskBridgeService } from './transaction-risk-bridge.service';

@Module({
  imports: [RiskEngineModule, ComplianceAlertsModule, ComplianceIncidentsModule],
  providers: [TransactionComplianceService, TransactionRiskBridgeService],
  controllers: [TransactionComplianceAdminController],
  exports: [TransactionComplianceService],
})
export class TransactionComplianceModule {}
