import { Global, Module } from '@nestjs/common';
import { ApprovalsModule } from './approvals/approvals.module';
import { IncidentsModule } from './incidents/incidents.module';
import { RegulatoryFilingsModule } from './regulatory-filings/regulatory-filings.module';
import { ComplianceOfficeModule } from './compliance-office/compliance-office.module';
// 战役甲波五 T4：投诉治理子模块挂载（照波四判例，治理域子模块统一挂 GovernanceModule）。
import { ComplaintsModule } from './complaints/complaints.module';

@Global()
@Module({
  imports: [ApprovalsModule, IncidentsModule, RegulatoryFilingsModule, ComplianceOfficeModule, ComplaintsModule],
  exports: [ApprovalsModule, IncidentsModule, RegulatoryFilingsModule, ComplianceOfficeModule, ComplaintsModule],
})
export class GovernanceModule {}
