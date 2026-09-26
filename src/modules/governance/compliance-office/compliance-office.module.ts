// 战役甲波四 · 合规办公室骨架（Task 3/4/5）模块接线：T2 义务主体服务 + T3 到期开单 sweep +
// T4 两本登记册（vendor/RI）主体服务 + T5 RI 换人审批链/闹钟墙聚合/控制器。导入
// RegulatoryFilingsModule 拿 RegulatoryFilingService（sweep 命中序最后一步
// openForObligation 开单；clock-wall 聚合横向只读 regulatory_filings 表）——照
// incidents.module.ts 同款先例（governance 子域横向拿 RegulatoryFilingService 都走这条线，
// 不重复声明该服务）。导入 ApprovalsModule 拿 ApprovalsService——照
// customers.module.ts（SanctionDispositionWorkflowService）同款先例。
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { RegulatoryFilingsModule } from '../regulatory-filings/regulatory-filings.module';
import { ComplianceObligationsService } from './compliance-obligations.service';
import { ComplianceObligationSweepService } from './compliance-obligation-sweep.service';
import { OutsourcingVendorsService } from './outsourcing-vendors.service';
import { ResponsibleIndividualsService } from './responsible-individuals.service';
import { ComplianceClockWallService } from './compliance-clock-wall.service';
import { RiReplacementApprovalService } from './ri-replacement-approval.service';
import { RiReplacementWorkflowService } from './ri-replacement-workflow.service';
import { ComplianceOfficeController } from './compliance-office.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule, ApprovalsModule, RegulatoryFilingsModule],
  controllers: [ComplianceOfficeController],
  providers: [
    ComplianceObligationsService,
    ComplianceObligationSweepService,
    OutsourcingVendorsService,
    ResponsibleIndividualsService,
    ComplianceClockWallService,
    RiReplacementApprovalService,
    RiReplacementWorkflowService,
  ],
  exports: [ComplianceObligationsService, OutsourcingVendorsService, ResponsibleIndividualsService],
})
export class ComplianceOfficeModule {}
