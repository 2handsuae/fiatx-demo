import { Global, Module } from '@nestjs/common';
import { ApprovalsModule } from './approvals/approvals.module';
import { GovernanceRegistriesModule } from './registries/governance-registries.module';
import { RegulatoryGatesModule } from './regulatory-gates/regulatory-gates.module';
import { TransactionLimitsModule } from './transaction-limits/transaction-limits.module';

@Global()
@Module({
  imports: [
    ApprovalsModule,
    GovernanceRegistriesModule,
    RegulatoryGatesModule,
    TransactionLimitsModule,
  ],
  exports: [ApprovalsModule],
})
export class GovernanceModule {}
