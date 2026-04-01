import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PoolSettlementBatchesService } from './pool-settlement-batches.service';

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
      if (
        String(error?.message || '').includes(
          'No eligible routable source found',
        )
      ) {
        return;
      }

      throw error;
    }
  }
}
