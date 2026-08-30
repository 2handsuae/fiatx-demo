import { Global, Module } from '@nestjs/common';
import { ApprovalsModule } from './approvals/approvals.module';

@Global()
@Module({
  imports: [ApprovalsModule],
  exports: [ApprovalsModule],
})
export class GovernanceModule {}
