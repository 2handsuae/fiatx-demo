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
// 战役甲波一 T5（经办桶断言）：IncidentService 注入 AccessControlService。该模块本身
// 是 @Global()（access-control.module.ts），此处显式 import 是按 Ruling-2 接线，不依赖
// 全局隐式可见性。
import { AccessControlModule } from '../../identity/access-control/access-control.module';
// 战役甲波二 T6：assess 联动自动开单要横向调 RegulatoryFilingService（getView 的通报摘要
// 投影同理）——RegulatoryFilingsModule 不 import IncidentsModule（filing 侧零事故依赖，
// 入参靠调用方传行），单向依赖不成环，不需要 forwardRef。
import { RegulatoryFilingsModule } from '../regulatory-filings/regulatory-filings.module';
import { IncidentService } from './incident.service';
import { DISPOSITION_INCIDENT_LINK, DispositionIncidentLink, IncidentRegistrationWorkflowService } from './incident-registration-workflow.service';
import { IncidentCloseWorkflowService } from './incident-close-workflow.service';
import { IncidentAssessmentWorkflowService } from './incident-assessment-workflow.service';
import {
  IncidentCloseFinancialApprovalService,
  IncidentCloseSecurityApprovalService,
  IncidentCloseTechsecApprovalService,
  IncidentClosePrudentialApprovalService,
  IncidentCloseCustomerApprovalService,
} from './incident-approval.service';
import { IncidentsController } from './incidents.controller';

// `useExisting: DispositionService` 换实现后没有编译期接口检查（Nest 的 DI token
// 是运行时字符串，DispositionService 是否仍满足 DispositionIncidentLink 全靠人肉
// 记得同步）。这里补一个 type-only 见证：DispositionService 一旦不再结构兼容
// DispositionIncidentLink（例如 attachIncident 改名/改签名），下面这行编译期报红，
// 零运行时开销（纯类型层）。
type _AssertDispositionIncidentLink = DispositionService extends DispositionIncidentLink ? true : never;
const _dispositionIncidentLinkWitness: _AssertDispositionIncidentLink = true;
void _dispositionIncidentLinkWitness;

@Module({
  imports: [PrismaModule, AuditLogsModule, ApprovalsModule, ReconciliationModule, AccessControlModule, RegulatoryFilingsModule],
  controllers: [IncidentsController],
  providers: [
    IncidentService,
    IncidentRegistrationWorkflowService,
    IncidentCloseWorkflowService,
    IncidentAssessmentWorkflowService,
    IncidentCloseSecurityApprovalService,
    IncidentCloseFinancialApprovalService,
    IncidentCloseTechsecApprovalService,
    IncidentClosePrudentialApprovalService,
    IncidentCloseCustomerApprovalService,
    // Task 9 落地：DISPOSITION_INCIDENT_LINK 接对账侧真实现（原占位类
    // InterimDispositionIncidentLink 已删，行为迁到 DispositionService.attachIncident）。
    { provide: DISPOSITION_INCIDENT_LINK, useExisting: DispositionService },
  ],
  exports: [IncidentService, IncidentRegistrationWorkflowService, IncidentCloseWorkflowService],
})
export class IncidentsModule {}
