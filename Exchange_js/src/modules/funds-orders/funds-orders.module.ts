import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuditLogsModule } from '../audit-logging/audit-logs.module';
import { FundsOrderAdvanceWorkflowService } from './funds-order-advance-workflow.service';
import { FundsOrderService } from './funds-order.service';
import { FundsOrdersAdminController } from './funds-orders.admin.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [FundsOrdersAdminController],
  providers: [FundsOrderService, FundsOrderAdvanceWorkflowService],
  exports: [FundsOrderService],
})
export class FundsOrdersModule {}
