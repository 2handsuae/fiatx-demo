// 平账三期 · 事故登记（治理件）模块骨架。
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { ApprovalsModule } from '../approvals/approvals.module';
// Task 9：定性行写回（attachIncident）落在对账主体自己的服务里（铁律③），
// 本模块只借道 ReconciliationModule 拿它注入 DISPOSITION_INCIDENT_LINK——
// ReconciliationModule 不依赖 governance/incidents 的任何东西（只直接
// import governance/approvals 子模块，不经过 GovernanceModule 大门），
// 两模块间无环，不需要 forwardRef（CustomersModule 三处 forwardRef 是
// 双向真环时的解法，这里不成立）。
import { ReconciliationModule } from '../../clearing-settle/reconciliation/reconciliation.module';
import { DispositionService } from '../../clearing-settle/reconciliation/disposition/disposition.service';
import { IncidentService } from './incident.service';
import { DISPOSITION_INCIDENT_LINK, IncidentRegistrationWorkflowService } from './incident-registration-workflow.service';
import { IncidentCloseWorkflowService } from './incident-close-workflow.service';
import { IncidentCloseFinancialApprovalService, IncidentCloseSecurityApprovalService } from './incident-approval.service';
import { IncidentsController } from './incidents.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule, ApprovalsModule, ReconciliationModule],
  controllers: [IncidentsController],
  providers: [
    IncidentService,
    IncidentRegistrationWorkflowService,
    IncidentCloseWorkflowService,
    IncidentCloseSecurityApprovalService,
    IncidentCloseFinancialApprovalService,
    // Task 9 落地：DISPOSITION_INCIDENT_LINK 接对账侧真实现（原占位类
    // InterimDispositionIncidentLink 已删，行为迁到 DispositionService.attachIncident）。
    { provide: DISPOSITION_INCIDENT_LINK, useExisting: DispositionService },
  ],
  exports: [IncidentService, IncidentRegistrationWorkflowService, IncidentCloseWorkflowService],
})
export class IncidentsModule {}
