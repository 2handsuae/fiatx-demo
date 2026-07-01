import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { FundsOrderService } from './funds-order.service';
import { FundsOrdersAdminController } from './funds-orders.admin.controller';

@Module({
  imports: [PrismaModule],
  controllers: [FundsOrdersAdminController],
  providers: [FundsOrderService],
  exports: [FundsOrderService],
})
export class FundsOrdersModule {}
