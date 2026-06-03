import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FeeCollectionWorkflowService } from '../workflow/fee-collection-workflow.service';

@Injectable()
export class FeeCollectionSweepService {
  private readonly logger = new Logger(FeeCollectionSweepService.name);

  constructor(private readonly workflow: FeeCollectionWorkflowService) {}

  // Daily midnight — offset from EOD settlement (23:59) so the two don't overlap.
  @Cron('0 0 0 * * *', { timeZone: 'Asia/Dubai' })
  async handle(): Promise<void> {
    try {
      const res = await this.workflow.runFeeCollection('CRON');
      this.logger.log(
        `Fee collection: batch=${res.batchNo ?? 'none'} assets=${res.assetCount} collected=${res.collected}`,
      );
    } catch (err) {
      this.logger.error('Fee collection sweep failed', err instanceof Error ? err.stack : undefined);
    }
  }
}
