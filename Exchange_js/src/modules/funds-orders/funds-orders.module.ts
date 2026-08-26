import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuditLogsModule } from '../audit-logging/audit-logs.module';
import { FundsOrderAdvanceWorkflowService } from './funds-order-advance-workflow.service';
import { FundsOrderService } from './funds-order.service';
import { DispositionService } from './disposition.service';
import { TigerBeetleModule } from '../accounting/tigerbeetle/tigerbeetle.module';
import { FundsOrdersAdminController } from './funds-orders.admin.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule, TigerBeetleModule],
  controllers: [FundsOrdersAdminController],
  providers: [FundsOrderService, FundsOrderAdvanceWorkflowService, DispositionService],
  exports: [FundsOrderService, DispositionService],
})
export class FundsOrdersModule {}
