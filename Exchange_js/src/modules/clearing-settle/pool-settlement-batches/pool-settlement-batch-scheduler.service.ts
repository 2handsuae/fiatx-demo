import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PoolSettlementBatchesService } from './pool-settlement-batches.service';

const SCHEDULER_SKIPPABLE_CREATE_BATCH_ERRORS = new Set([
  'No eligible routable source found for pool settlement batch',
  'No sources were locked for pool settlement batch',
]);

@Injectable()
export class PoolSettlementBatchSchedulerService {
  constructor(
    private readonly poolSettlementBatchesService: PoolSettlementBatchesService,
  ) {}

  @Cron('0 59 23 * * *', { timeZone: 'Asia/Dubai' })
  async runDaily() {
    try {
      const batch = await this.poolSettlementBatchesService.createBatch(
        { autoCreated: true, metadataJson: { trigger: 'daily-23-59' } },
        'SYSTEM',
      );

      await this.poolSettlementBatchesService.submitBatch(batch.id, 'SYSTEM');
    } catch (error: any) {
      const errorMessage = String(error?.message || '').trim();
      if (SCHEDULER_SKIPPABLE_CREATE_BATCH_ERRORS.has(errorMessage)) {
        return;
      }

      throw error;
    }
  }
}
