import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { ComplianceAlertsModule } from '../compliance-alerts/compliance-alerts.module';
import { ComplianceCaseEvidencePackagesController } from './compliance-case-evidence-packages.controller';
import { ComplianceCaseEvidencePackagesService } from './compliance-case-evidence-packages.service';
import { ComplianceCasesAdminController } from './compliance-cases-admin.controller';
import { ComplianceCaseSlaSweepService } from './compliance-case-sla-sweep.service';
import { ComplianceIncidentsAdminController } from './compliance-incidents-admin.controller';
import { ComplianceIncidentsService } from './compliance-incidents.service';

@Module({
  imports: [PrismaModule, ComplianceAlertsModule, ApprovalsModule],
  providers: [
    ComplianceIncidentsService,
    ComplianceCaseEvidencePackagesService,
    ComplianceCaseSlaSweepService,
  ],
  controllers: [
    ComplianceCaseEvidencePackagesController,
    ComplianceCasesAdminController,
    ComplianceIncidentsAdminController,
  ],
  exports: [ComplianceIncidentsService, ComplianceCaseEvidencePackagesService],
})
export class ComplianceIncidentsModule {}
