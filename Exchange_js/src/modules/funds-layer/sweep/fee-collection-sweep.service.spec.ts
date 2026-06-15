import 'reflect-metadata';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { FeeCollectionWorkflowService } from '../workflow/fee-collection-workflow.service';
import { FeeCollectionSweepService } from './fee-collection-sweep.service';

/**
 * The legacy crypto FEE_COLLECT cron is RETIRED — superseded by the EOD fee pass
 * (EodSettlementWorkflowService.runFeePass). These tests pin the retirement:
 * `handle` must still EXIST (kept callable for manual/ops backfill) but must NOT
 * be scheduled, so it can never auto-run and double-collect crypto fees.
 */
describe('FeeCollectionSweepService (retired cron)', () => {
  it('handle() carries NO @Cron schedule metadata (deliberately unscheduled)', () => {
    const meta = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      FeeCollectionSweepService.prototype.handle,
    );
    expect(meta).toBeUndefined();
  });

  it('handle() still exists and delegates to the workflow when invoked manually', async () => {
    const workflow = {
      runFeeCollection: jest
        .fn()
        .mockResolvedValue({ batchNo: 'OSB-x', assetCount: 0, collected: 0 }),
    } as unknown as FeeCollectionWorkflowService;
    const sweep = new FeeCollectionSweepService(workflow);

    await sweep.handle();

    expect(workflow.runFeeCollection).toHaveBeenCalledWith('CRON');
  });
});
