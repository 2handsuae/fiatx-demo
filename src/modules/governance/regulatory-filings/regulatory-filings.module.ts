// 战役甲波二 · 报送台骨架（Task 5）模块接线。照 incidents.module.ts 先例。
// exports 只给 RegulatoryFilingService——Task 6（事件联动 + 事故侧收编）要靠它把
// IncidentService.assess 接到 openForIncident（铁律③：跨主体协作在调用方的 workflow/
// service 里发生，本模块只负责把服务暴露出去，不预先多导出用不到的 provider）。
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { ApprovalsModule } from '../approvals/approvals.module';
// 战役甲波三 T3：assertFamily 注入 AccessControlService 判 cap.filing.*。该模块本身是
// @Global()（access-control.module.ts），此处显式 import 是按 Ruling-2 接线（照
// incidents.module.ts 同款先例），不依赖全局隐式可见性。
import { AccessControlModule } from '../../identity/access-control/access-control.module';
import { RegulatoryFilingService } from './regulatory-filing.service';
import { RegulatoryFilingWorkflowService } from './regulatory-filing-workflow.service';
import { RegFilingSubmitApprovalService } from './regulatory-filing-approval.service';
import { RegulatoryFilingSweepService } from './regulatory-filing-sweep.service';
import { RegulatoryFilingsController } from './regulatory-filings.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule, ApprovalsModule, AccessControlModule],
  controllers: [RegulatoryFilingsController],
  providers: [RegulatoryFilingService, RegulatoryFilingWorkflowService, RegFilingSubmitApprovalService, RegulatoryFilingSweepService],
  exports: [RegulatoryFilingService],
})
export class RegulatoryFilingsModule {}
