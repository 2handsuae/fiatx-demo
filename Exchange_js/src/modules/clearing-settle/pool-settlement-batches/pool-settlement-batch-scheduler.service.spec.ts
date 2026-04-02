import { PoolSettlementBatchSchedulerService } from './pool-settlement-batch-scheduler.service';
import { PoolSettlementBatchesService } from './pool-settlement-batches.service';

describe('PoolSettlementBatchSchedulerService', () => {
  const createService = () => {
    const poolSettlementBatchesService = {
      createBatch: jest.fn(),
      submitBatch: jest.fn(),
    } as unknown as jest.Mocked<PoolSettlementBatchesService>;

    const service = new PoolSettlementBatchSchedulerService(
      poolSettlementBatchesService,
    );

    return { service, poolSettlementBatchesService };
  };

  it('creates and submits a system batch on the daily run', async () => {
    const { service, poolSettlementBatchesService } = createService();

    poolSettlementBatchesService.createBatch.mockResolvedValue({
      id: 'batch-1',
    } as any);

    await service.runDaily();

    expect(poolSettlementBatchesService.createBatch).toHaveBeenCalledWith(
      { autoCreated: true, metadataJson: { trigger: 'daily-23-59' } },
      'SYSTEM',
    );
    expect(poolSettlementBatchesService.submitBatch).toHaveBeenCalledWith(
      'batch-1',
      'SYSTEM',
    );
  });

  it('swallows no eligible source errors', async () => {
    const { service, poolSettlementBatchesService } = createService();

    poolSettlementBatchesService.createBatch.mockRejectedValue(
      new Error('No eligible routable source found for pool settlement batch'),
    );

    await expect(service.runDaily()).resolves.toBeUndefined();
    expect(poolSettlementBatchesService.submitBatch).not.toHaveBeenCalled();
  });

  it('swallows lock contention when another scheduler instance wins the batch', async () => {
    const { service, poolSettlementBatchesService } = createService();

    poolSettlementBatchesService.createBatch.mockRejectedValue(
      new Error('No sources were locked for pool settlement batch'),
    );

    await expect(service.runDaily()).resolves.toBeUndefined();
    expect(poolSettlementBatchesService.submitBatch).not.toHaveBeenCalled();
  });

  it('rethrows unexpected scheduler errors', async () => {
    const { service, poolSettlementBatchesService } = createService();
    const error = new Error('database unavailable');

    poolSettlementBatchesService.createBatch.mockRejectedValue(error);

    await expect(service.runDaily()).rejects.toThrow(error);
    expect(poolSettlementBatchesService.submitBatch).not.toHaveBeenCalled();
  });
});
