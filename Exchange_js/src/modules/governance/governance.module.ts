import { Global, Module } from '@nestjs/common';
import { ApprovalsModule } from './approvals/approvals.module';
import { GovernanceRegistriesModule } from './registries/governance-registries.module';
import { RegulatoryGatesModule } from './regulatory-gates/regulatory-gates.module';

@Global()
@Module({
  imports: [
    ApprovalsModule,
    GovernanceRegistriesModule,
    RegulatoryGatesModule,
  ],
  exports: [ApprovalsModule],
})
export class GovernanceModule {}
