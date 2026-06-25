import { Injectable, Logger } from '@nestjs/common';
// import { Cron } from '@nestjs/schedule'; // disabled in Phase A — remove in Phase C
import { EodSettlementWorkflowService } from '../workflow/eod-settlement-workflow.service';

@Injectable()
export class EodSettlementSweepService {
  private readonly logger = new Logger(EodSettlementSweepService.name);

  constructor(private readonly workflow: EodSettlementWorkflowService) {}

  // disabled in Phase A (real-time settlement) — remove in Phase C
  // @Cron('0 30 0 * * *', { timeZone: 'Asia/Dubai' })
  async handle(): Promise<void> {
    return; // disabled in Phase A (real-time settlement) — remove in Phase C
  }
}
