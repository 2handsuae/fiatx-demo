import { Global, Module } from '@nestjs/common';
import { ApprovalsModule } from './approvals/approvals.module';
import { BusinessConfigModule } from './business-config/business-config.module';
import { ChangeTicketsModule } from './change-tickets/change-tickets.module';
import { DeleteRequestsModule } from './delete-requests/delete-requests.module';
import { SlaTimersModule } from './sla-timers/sla-timers.module';

@Global()
@Module({
  imports: [
    ApprovalsModule,
    BusinessConfigModule,
    ChangeTicketsModule,
    DeleteRequestsModule,
    SlaTimersModule,
  ],
  exports: [
    ApprovalsModule,
    BusinessConfigModule,
    ChangeTicketsModule,
    DeleteRequestsModule,
    SlaTimersModule,
  ],
})
export class GovernanceModule {}
