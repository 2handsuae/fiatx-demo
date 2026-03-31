import { Test, TestingModule } from '@nestjs/testing';
import { PoolSettlementBatchesController } from './pool-settlement-batches.controller';
import { PoolSettlementBatchesService } from './pool-settlement-batches.service';

describe('PoolSettlementBatchesController', () => {
  let controller: PoolSettlementBatchesController;

  const poolSettlementBatchesService = {
    findAllForAdmin: jest.fn(),
    findDetailForAdmin: jest.fn(),
    createBatch: jest.fn(),
    submitBatch: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PoolSettlementBatchesController],
      providers: [
        {
          provide: PoolSettlementBatchesService,
          useValue: poolSettlementBatchesService,
        },
      ],
    }).compile();

    controller = module.get<PoolSettlementBatchesController>(
      PoolSettlementBatchesController,
    );
    jest.clearAllMocks();
  });

  it('delegates list and detail calls to the service', async () => {
    poolSettlementBatchesService.findAllForAdmin.mockResolvedValue({
      items: [],
      total: 0,
    });
    poolSettlementBatchesService.findDetailForAdmin.mockResolvedValue({
      id: 'batch-1',
    });

    await controller.findAll({ skip: 0, take: 10 } as any);
    await controller.findOne('batch-1');

    expect(poolSettlementBatchesService.findAllForAdmin).toHaveBeenCalledWith({
      skip: 0,
      take: 10,
    });
    expect(
      poolSettlementBatchesService.findDetailForAdmin,
    ).toHaveBeenCalledWith('batch-1');
  });

  it('delegates create with the request user id', async () => {
    poolSettlementBatchesService.createBatch.mockResolvedValue({
      id: 'batch-1',
    });

    await controller.create(
      { user: { id: 'admin-1' } } as any,
      {
        autoCreated: true,
        metadataJson: { source: 'test' },
      } as any,
    );

    expect(poolSettlementBatchesService.createBatch).toHaveBeenCalledWith(
      {
        autoCreated: true,
        metadataJson: { source: 'test' },
      },
      'admin-1',
    );
  });

  it('delegates submit with SYSTEM fallback when request has no user', async () => {
    poolSettlementBatchesService.submitBatch.mockResolvedValue({
      id: 'batch-1',
    });

    await controller.submit({} as any, 'batch-1');

    expect(poolSettlementBatchesService.submitBatch).toHaveBeenCalledWith(
      'batch-1',
      'SYSTEM',
    );
  });
});
