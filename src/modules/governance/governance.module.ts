import { Global, Module } from '@nestjs/common';
import { ApprovalsModule } from './approvals/approvals.module';
import { IncidentsModule } from './incidents/incidents.module';

@Global()
@Module({
  imports: [ApprovalsModule, IncidentsModule],
  exports: [ApprovalsModule, IncidentsModule],
})
export class GovernanceModule {}
