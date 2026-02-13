import { Module } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { PayoutsController } from './payouts.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
