import { Module } from '@nestjs/common';
import { TransactionComplianceService } from './transaction-compliance.service';
import { TransactionComplianceAdminController } from './transaction-compliance-admin.controller';
import { RiskEngineModule } from '../risk-engine.module';
import { TransactionRiskBridgeService } from './transaction-risk-bridge.service';

@Module({
  imports: [RiskEngineModule],
  providers: [TransactionComplianceService, TransactionRiskBridgeService],
  controllers: [TransactionComplianceAdminController],
  exports: [TransactionComplianceService],
})
export class TransactionComplianceModule {}
