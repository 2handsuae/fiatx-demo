import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { GovernanceRegistriesController } from './governance-registries.controller';
import { GovernanceRegistriesService } from './governance-registries.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [GovernanceRegistriesController],
  providers: [GovernanceRegistriesService],
  exports: [GovernanceRegistriesService],
})
export class GovernanceRegistriesModule {}
