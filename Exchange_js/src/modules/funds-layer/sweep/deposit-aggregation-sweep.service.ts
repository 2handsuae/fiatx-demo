import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DepositAggregationWorkflowService } from '../workflow/deposit-aggregation-workflow.service';

@Injectable()
export class DepositAggregationSweepService {
  private readonly logger = new Logger(DepositAggregationSweepService.name);

  constructor(private readonly workflow: DepositAggregationWorkflowService) {}

  @Cron('0 */1 * * *') // 每小时
  async handle(): Promise<void> {
    try {
      const res = await this.workflow.runSweep('CRON');
      this.logger.log(`Deposit aggregation sweep: aggregated=${res.aggregated} skipped=${res.skipped}`);
    } catch (err) {
      this.logger.error('Deposit aggregation sweep failed', err instanceof Error ? err.stack : undefined);
    }
  }
}
