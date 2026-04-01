import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { PoolSettlementBatchesController } from './pool-settlement-batches.controller';
import { PoolSettlementBatchApprovalProjectionService } from './pool-settlement-batch-approval-projection.service';
import { PoolSettlementBatchesService } from './pool-settlement-batches.service';

@Module({
  imports: [PrismaModule, ApprovalsModule],
  controllers: [PoolSettlementBatchesController],
  providers: [
    PoolSettlementBatchesService,
    PoolSettlementBatchApprovalProjectionService,
  ],
  exports: [PoolSettlementBatchesService],
})
export class PoolSettlementBatchesModule {}
