import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { SafeguardingReconciliationController } from './safeguarding-reconciliation.controller';
import { SafeguardingReconciliationService } from './safeguarding-reconciliation.service';

@Module({
  imports: [PrismaModule],
  controllers: [SafeguardingReconciliationController],
  providers: [SafeguardingReconciliationService],
  exports: [SafeguardingReconciliationService],
})
export class SafeguardingReconciliationModule {}
