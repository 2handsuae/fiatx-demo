import { Injectable, Logger } from '@nestjs/common';
// import { Cron } from '@nestjs/schedule'; // disabled in Phase A — remove in Phase C
import { DepositAggregationWorkflowService } from '../workflow/deposit-aggregation-workflow.service';

@Injectable()
export class DepositAggregationSweepService {
  private readonly logger = new Logger(DepositAggregationSweepService.name);

  constructor(private readonly workflow: DepositAggregationWorkflowService) {}

  // disabled in Phase A (real-time settlement) — remove in Phase C
  // @Cron('0 */1 * * *') // 每小时
  async handle(): Promise<void> {
    return; // disabled in Phase A (real-time settlement) — remove in Phase C
  }
}
