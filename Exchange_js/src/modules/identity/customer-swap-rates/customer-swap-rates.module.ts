import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { CustomerSwapRatesController } from './customer-swap-rates.controller';
import { CustomerSwapRatesService } from './customer-swap-rates.service';

@Module({
  imports: [PrismaModule],
  controllers: [CustomerSwapRatesController],
  providers: [CustomerSwapRatesService],
  exports: [CustomerSwapRatesService],
})
export class CustomerSwapRatesModule {}
