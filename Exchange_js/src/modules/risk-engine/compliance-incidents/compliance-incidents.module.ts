import { Module } from '@nestjs/common';
import { ComplianceIncidentsAdminController } from './compliance-incidents-admin.controller';
import { ComplianceIncidentsService } from './compliance-incidents.service';

@Module({
  providers: [ComplianceIncidentsService],
  controllers: [ComplianceIncidentsAdminController],
  exports: [ComplianceIncidentsService],
})
export class ComplianceIncidentsModule {}
