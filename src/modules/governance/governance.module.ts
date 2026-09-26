import { Global, Module } from '@nestjs/common';
import { ApprovalsModule } from './approvals/approvals.module';
import { IncidentsModule } from './incidents/incidents.module';
import { RegulatoryFilingsModule } from './regulatory-filings/regulatory-filings.module';
import { ComplianceOfficeModule } from './compliance-office/compliance-office.module';

@Global()
@Module({
  imports: [ApprovalsModule, IncidentsModule, RegulatoryFilingsModule, ComplianceOfficeModule],
  exports: [ApprovalsModule, IncidentsModule, RegulatoryFilingsModule, ComplianceOfficeModule],
})
export class GovernanceModule {}
