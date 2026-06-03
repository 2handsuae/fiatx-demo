import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EodSettlementWorkflowService } from '../workflow/eod-settlement-workflow.service';

@Injectable()
export class EodSettlementSweepService {
  private readonly logger = new Logger(EodSettlementSweepService.name);

  constructor(private readonly workflow: EodSettlementWorkflowService) {}

  @Cron('0 59 23 * * *', { timeZone: 'Asia/Dubai' })
  async handle(): Promise<void> {
    try {
      const res = await this.workflow.runEodSettlement('CRON');
      this.logger.log(
        `EOD settlement: batch=${res.batchNo ?? 'none'} assets=${res.assetCount} settledZero=${res.settledZero} spawned=${res.spawned}`,
      );
    } catch (err) {
      this.logger.error('EOD settlement sweep failed', err instanceof Error ? err.stack : undefined);
    }
  }
}
