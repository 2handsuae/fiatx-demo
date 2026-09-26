// 战役甲波二 · 报送台骨架（Task 5）模块接线。照 incidents.module.ts 先例。
// exports 只给 RegulatoryFilingService——Task 6（事件联动 + 事故侧收编）要靠它把
// IncidentService.assess 接到 openForIncident（铁律③：跨主体协作在调用方的 workflow/
// service 里发生，本模块只负责把服务暴露出去，不预先多导出用不到的 provider）。
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { RegulatoryFilingService } from './regulatory-filing.service';
import { RegulatoryFilingWorkflowService } from './regulatory-filing-workflow.service';
import { RegFilingSubmitApprovalService } from './regulatory-filing-approval.service';
import { RegulatoryFilingSweepService } from './regulatory-filing-sweep.service';
import { RegulatoryFilingsController } from './regulatory-filings.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule, ApprovalsModule],
  controllers: [RegulatoryFilingsController],
  providers: [RegulatoryFilingService, RegulatoryFilingWorkflowService, RegFilingSubmitApprovalService, RegulatoryFilingSweepService],
  exports: [RegulatoryFilingService],
})
export class RegulatoryFilingsModule {}
