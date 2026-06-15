import { Injectable, Logger } from '@nestjs/common';
import { FeeCollectionWorkflowService } from '../workflow/fee-collection-workflow.service';

/**
 * RETIRED (superseded by the EOD fee pass). Crypto fee collection now rides the
 * EOD run: EodSettlementWorkflowService.runFeePass() nets every open crypto
 * SWAP_FEE/WITHDRAW_FEE accrual into a single F_*→F_FEE transfer per asset.
 *
 * The old @Cron('0 0 0 * * *') trigger has been removed so this Prisma-derived
 * sweep can NEVER auto-run — running both would double-collect crypto fees
 * (the EOD pass moves the accrued fee to F_FEE; this legacy path would then try
 * to re-collect the same C_MAIN→F_OPS delta). The class stays registered for DI
 * and the method is kept callable for manual/ops backfill, but it is no longer
 * scheduled.
 */
@Injectable()
export class FeeCollectionSweepService {
  private readonly logger = new Logger(FeeCollectionSweepService.name);

  constructor(private readonly workflow: FeeCollectionWorkflowService) {}

  // No @Cron: deliberately unscheduled — see class doc (superseded by EOD fee pass).
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
