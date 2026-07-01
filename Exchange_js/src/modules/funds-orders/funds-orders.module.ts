import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { FundsOrderService } from './funds-order.service';

@Module({
  imports: [PrismaModule],
  providers: [FundsOrderService],
  exports: [FundsOrderService],
})
export class FundsOrdersModule {}
