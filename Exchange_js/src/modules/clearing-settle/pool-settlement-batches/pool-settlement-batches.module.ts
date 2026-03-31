import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { PoolSettlementBatchesController } from './pool-settlement-batches.controller';
import { PoolSettlementBatchesService } from './pool-settlement-batches.service';

@Module({
  imports: [PrismaModule],
  controllers: [PoolSettlementBatchesController],
  providers: [PoolSettlementBatchesService],
  exports: [PoolSettlementBatchesService],
})
export class PoolSettlementBatchesModule {}

