import { Global, Module } from '@nestjs/common';
import { ApprovalsModule } from './approvals/approvals.module';
import { IncidentsModule } from './incidents/incidents.module';
import { RegulatoryFilingsModule } from './regulatory-filings/regulatory-filings.module';

@Global()
@Module({
  imports: [ApprovalsModule, IncidentsModule, RegulatoryFilingsModule],
  exports: [ApprovalsModule, IncidentsModule, RegulatoryFilingsModule],
})
export class GovernanceModule {}
