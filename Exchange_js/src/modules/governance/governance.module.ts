import { Global, Module } from '@nestjs/common';
import { ApprovalsModule } from './approvals/approvals.module';
import { BusinessConfigModule } from './business-config/business-config.module';
import { GovernanceRegistriesModule } from './registries/governance-registries.module';
import { RegulatoryGatesModule } from './regulatory-gates/regulatory-gates.module';

@Global()
@Module({
  imports: [
    ApprovalsModule,
    BusinessConfigModule,
    GovernanceRegistriesModule,
    RegulatoryGatesModule,
  ],
  exports: [ApprovalsModule],
})
export class GovernanceModule {}
