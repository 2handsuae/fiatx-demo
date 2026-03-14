import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ChangeTicketsModule } from '../change-tickets/change-tickets.module';
import { DeleteRequestsModule } from '../delete-requests/delete-requests.module';
import { ApprovalPolicyService } from './approval-policy.service';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { AuditEvidenceExportApprovalService } from './audit-evidence-export-approval.service';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => ChangeTicketsModule),
    forwardRef(() => DeleteRequestsModule),
  ],
  controllers: [ApprovalsController],
  providers: [
    ApprovalsService,
    ApprovalPolicyService,
    AuditEvidenceExportApprovalService,
  ],
  exports: [ApprovalsService, AuditEvidenceExportApprovalService],
})
export class ApprovalsModule {}
