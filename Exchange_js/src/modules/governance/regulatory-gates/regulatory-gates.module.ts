import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { GovernanceRegistriesModule } from '../registries/governance-registries.module';
import { RegulatoryGatesController } from './regulatory-gates.controller';
import { RegulatoryGatesService } from './regulatory-gates.service';

@Module({
  imports: [AuditLogsModule, GovernanceRegistriesModule],
  controllers: [RegulatoryGatesController],
  providers: [RegulatoryGatesService],
  exports: [RegulatoryGatesService],
})
export class RegulatoryGatesModule {}
