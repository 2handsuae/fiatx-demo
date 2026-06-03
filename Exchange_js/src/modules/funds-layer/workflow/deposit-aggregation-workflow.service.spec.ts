import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DepositAggregationSourceService } from '../domain/deposit-aggregation-source.service';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { DepositAggregationWorkflowService } from './deposit-aggregation-workflow.service';

describe('DepositAggregationWorkflowService', () => {
  let service: DepositAggregationWorkflowService;
  let deposits: { findAggregationCandidates: jest.Mock; markAggregated: jest.Mock };
  let transferWorkflow: { initiate: jest.Mock };
  let systemWallets: { resolve: jest.Mock };
  let prisma: { internalTransaction: { findFirst: jest.Mock } };

  const baseCandidate = {
    toWalletId: 'w-dep-1',
    assetId: 'a-usdt',
    ownerId: 'PLATFORM',
    ownerType: 'PLATFORM',
    depositIds: ['d1', 'd2'],
    anchorDepositId: 'd1',
  };

  beforeEach(async () => {
    deposits = {
      findAggregationCandidates: jest.fn(),
      markAggregated: jest.fn().mockResolvedValue({ count: 2 }),
    };
    transferWorkflow = {
      initiate: jest.fn().mockResolvedValue({ id: 't-new' }),
    };
    systemWallets = {
      resolve: jest.fn().mockResolvedValue({ id: 'w-main-1' }),
    };
    prisma = {
      internalTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepositAggregationWorkflowService,
        { provide: PrismaService, useValue: prisma },
        { provide: DepositAggregationSourceService, useValue: deposits },
        { provide: InternalTransferWorkflowService, useValue: transferWorkflow },
        { provide: SystemWalletResolver, useValue: systemWallets },
      ],
    }).compile();

    service = module.get(DepositAggregationWorkflowService);
  });

  it('aggregates an over-threshold candidate', async () => {
    deposits.findAggregationCandidates.mockResolvedValue([
      { ...baseCandidate, totalAmount: new Prisma.Decimal(150) },
    ]);

    const result = await service.runSweep();

    expect(systemWallets.resolve).toHaveBeenCalledWith('a-usdt', 'C_MAIN');
    expect(transferWorkflow.initiate).toHaveBeenCalledTimes(1);
    const [input] = transferWorkflow.initiate.mock.calls[0];
    expect(input).toMatchObject({
      fromRole: 'C_DEP',
      toRole: 'C_MAIN',
      sourceType: 'DEPOSIT_AGGREGATION',
      sourceId: 'w-dep-1:d1',
      assetId: 'a-usdt',
      amount: '150',
      fromWalletId: 'w-dep-1',
      toWalletId: 'w-main-1',
      triggerSource: 'CRON',
    });
    expect(deposits.markAggregated).toHaveBeenCalledWith(['d1', 'd2'], 't-new');
    expect(result).toEqual({ aggregated: 1, skipped: 0 });
  });

  it('skips dust candidates', async () => {
    deposits.findAggregationCandidates.mockResolvedValue([
      { ...baseCandidate, totalAmount: new Prisma.Decimal(0.5) },
    ]);

    const result = await service.runSweep();

    expect(transferWorkflow.initiate).not.toHaveBeenCalled();
    expect(deposits.markAggregated).not.toHaveBeenCalled();
    expect(result).toEqual({ aggregated: 0, skipped: 1 });
  });

  it('skips candidates between dust and threshold', async () => {
    deposits.findAggregationCandidates.mockResolvedValue([
      { ...baseCandidate, totalAmount: new Prisma.Decimal(50) },
    ]);

    const result = await service.runSweep();

    expect(transferWorkflow.initiate).not.toHaveBeenCalled();
    expect(deposits.markAggregated).not.toHaveBeenCalled();
    expect(result).toEqual({ aggregated: 0, skipped: 1 });
  });

  it('is idempotent — reuses existing transfer and recovers a missed mark', async () => {
    deposits.findAggregationCandidates.mockResolvedValue([
      { ...baseCandidate, totalAmount: new Prisma.Decimal(150) },
    ]);
    prisma.internalTransaction.findFirst.mockResolvedValue({ id: 't-existing' });

    const result = await service.runSweep();

    expect(transferWorkflow.initiate).not.toHaveBeenCalled();
    expect(systemWallets.resolve).not.toHaveBeenCalled();
    expect(deposits.markAggregated).toHaveBeenCalledWith(['d1', 'd2'], 't-existing');
    expect(result).toEqual({ aggregated: 1, skipped: 0 });
  });
});
