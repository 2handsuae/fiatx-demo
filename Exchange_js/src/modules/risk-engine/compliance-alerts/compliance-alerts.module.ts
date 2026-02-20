import { Module } from '@nestjs/common';
import { ComplianceAlertsAdminController } from './compliance-alerts-admin.controller';
import { ComplianceAlertsService } from './compliance-alerts.service';

@Module({
  providers: [ComplianceAlertsService],
  controllers: [ComplianceAlertsAdminController],
  exports: [ComplianceAlertsService],
})
export class ComplianceAlertsModule {}
