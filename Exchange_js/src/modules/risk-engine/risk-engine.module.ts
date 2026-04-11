import { Module } from '@nestjs/common';
import { RiskEngineService } from './risk-engine.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { RiskDecisionRecordsService } from './risk-decision-records.service';
import { RiskDecisionRecordsAdminController } from './risk-decision-records-admin.controller';

@Module({
  imports: [PrismaModule],
  providers: [
    RiskEngineService,
    RiskDecisionRecordsService,
  ],
  controllers: [RiskDecisionRecordsAdminController],
  exports: [
    RiskEngineService,
    RiskDecisionRecordsService,
  ],
})
export class RiskEngineModule {}
