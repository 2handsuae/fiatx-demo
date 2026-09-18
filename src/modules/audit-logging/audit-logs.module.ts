import { Global, Module } from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogsController } from './audit-logs.controller';
import { AuditEvidenceExportApprovalService } from './audit-evidence-export-approval.service';
import { AuditEvidenceExportWorkflowService } from './audit-evidence-export-workflow.service';
import { AuditEvidencePackageController } from './audit-evidence-package.controller';

@Global()
@Module({
  providers: [
    AuditLogsService,
    AuditEvidenceExportApprovalService,
    AuditEvidenceExportWorkflowService,
  ],
  controllers: [AuditLogsController, AuditEvidencePackageController],
  exports: [AuditLogsService, AuditEvidenceExportWorkflowService],
})
export class AuditLogsModule {}
