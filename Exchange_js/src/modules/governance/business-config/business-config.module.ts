import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { PricingCenterModule } from '../../trading/pricing-center/pricing-center.module';
import { BusinessConfigController } from './business-config.controller';
import { BusinessConfigService } from './business-config.service';
import { LegacyChangeTicketsServiceStub } from './legacy-ct-stubs';

@Module({
  imports: [PrismaModule, PricingCenterModule],
  controllers: [BusinessConfigController],
  providers: [BusinessConfigService, AuditLogsService, LegacyChangeTicketsServiceStub],
  exports: [BusinessConfigService],
})
export class BusinessConfigModule {}
