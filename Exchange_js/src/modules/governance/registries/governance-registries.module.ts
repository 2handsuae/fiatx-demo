import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { SlaTimersModule } from '../sla-timers/sla-timers.module';
import { GovernanceRegistriesController } from './governance-registries.controller';
import { GovernanceRegistriesService } from './governance-registries.service';

@Module({
  imports: [AuditLogsModule, SlaTimersModule],
  controllers: [GovernanceRegistriesController],
  providers: [GovernanceRegistriesService],
  exports: [GovernanceRegistriesService],
})
export class GovernanceRegistriesModule {}
