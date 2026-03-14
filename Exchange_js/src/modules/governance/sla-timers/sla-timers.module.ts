import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ChangeTicketsModule } from '../change-tickets/change-tickets.module';
import { ApprovalSlaProjectionService } from './approval-sla-projection.service';
import { ChangeTicketSlaProjectionService } from './change-ticket-sla-projection.service';
import { SlaTimerDemoController } from './sla-timer-demo.controller';
import { SlaTimerMockService } from './sla-timer-mock.service';
import { SlaTimerSweepService } from './sla-timer-sweep.service';
import { SlaTimersController } from './sla-timers.controller';
import { SlaTimersService } from './sla-timers.service';

@Module({
  imports: [PrismaModule, ApprovalsModule, ChangeTicketsModule],
  controllers: [SlaTimersController, SlaTimerDemoController],
  providers: [
    SlaTimersService,
    SlaTimerMockService,
    SlaTimerSweepService,
    ApprovalSlaProjectionService,
    ChangeTicketSlaProjectionService,
  ],
  exports: [SlaTimersService],
})
export class SlaTimersModule {}
