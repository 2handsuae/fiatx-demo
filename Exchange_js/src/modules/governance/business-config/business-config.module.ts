import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { PricingCenterModule } from '../../trading/pricing-center/pricing-center.module';
import { BusinessConfigController } from './business-config.controller';
import { BusinessConfigService } from './business-config.service';

@Module({
  imports: [PrismaModule, PricingCenterModule],
  controllers: [BusinessConfigController],
  providers: [BusinessConfigService, AuditLogsService],
  exports: [BusinessConfigService],
})
export class BusinessConfigModule {}
