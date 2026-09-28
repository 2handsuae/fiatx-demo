// 战役甲波五 T4：投诉治理模块骨架（照波四 ri-replacement 挂载惯例挂 GovernanceModule）。
// imports IncidentsModule——ComplaintEscalationWorkflowService 横向只调
// IncidentService.registerFromComplaint（铁律③跨主体协作只在 workflow）；imports
// ApprovalsModule——ComplaintResolutionWorkflowService 走 ApprovalsService 正门开单，
// ComplaintResolutionApprovalService（承接项A：审批 decided 事件→workflow 的 handler
// 接线）需要 EventEmitter2（@nestjs/event-emitter 全局模块，不必显式 import）。
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { ComplaintsService } from './complaints.service';
import { ComplaintResolutionWorkflowService } from './complaint-resolution-workflow.service';
import { ComplaintResolutionApprovalService } from './complaint-resolution-approval.service';
import { ComplaintEscalationWorkflowService } from './complaint-escalation-workflow.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, ApprovalsModule, IncidentsModule],
  providers: [
    ComplaintsService,
    ComplaintResolutionWorkflowService,
    ComplaintResolutionApprovalService,
    ComplaintEscalationWorkflowService,
  ],
  exports: [ComplaintsService, ComplaintResolutionWorkflowService, ComplaintEscalationWorkflowService],
})
export class ComplaintsModule {}
