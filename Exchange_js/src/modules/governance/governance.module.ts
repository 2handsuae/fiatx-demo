import { Global, Module } from '@nestjs/common';
import { ApprovalsModule } from './approvals/approvals.module';
import { BusinessConfigModule } from './business-config/business-config.module';
import { ChangeTicketsModule } from './change-tickets/change-tickets.module';
import { GovernanceRegistriesModule } from './registries/governance-registries.module';
import { RegulatoryGatesModule } from './regulatory-gates/regulatory-gates.module';

@Global()
@Module({
  imports: [
    ApprovalsModule,
    BusinessConfigModule,
    ChangeTicketsModule,
    GovernanceRegistriesModule,
    RegulatoryGatesModule,
  ],
  exports: [ApprovalsModule, ChangeTicketsModule],
})
export class GovernanceModule {}
