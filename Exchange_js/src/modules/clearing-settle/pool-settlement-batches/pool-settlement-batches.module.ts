import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { OutstandingsModule } from '../outstandings/outstandings.module';
import { ReimbursementObligationsModule } from '../../asset-treasury/reimbursement-obligations/reimbursement-obligations.module';
import { PoolSettlementBatchesController } from './pool-settlement-batches.controller';
import { PoolSettlementBatchApprovalProjectionService } from './pool-settlement-batch-approval-projection.service';
import { PoolSettlementBatchCloseoutService } from './pool-settlement-batch-closeout.service';
import { PoolSettlementBatchSchedulerService } from './pool-settlement-batch-scheduler.service';
import { PoolSettlementBatchesService } from './pool-settlement-batches.service';

@Module({
  imports: [PrismaModule, ApprovalsModule, OutstandingsModule, ReimbursementObligationsModule],
  controllers: [PoolSettlementBatchesController],
  providers: [
    PoolSettlementBatchesService,
    PoolSettlementBatchApprovalProjectionService,
    PoolSettlementBatchCloseoutService,
    PoolSettlementBatchSchedulerService,
  ],
  exports: [PoolSettlementBatchesService],
})
export class PoolSettlementBatchesModule {}
