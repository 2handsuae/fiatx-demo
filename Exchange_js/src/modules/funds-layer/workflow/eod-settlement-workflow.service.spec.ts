import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SettlementBatchService } from '../domain/settlement-batch.service';
import { OutstandingConsumerService } from '../domain/outstanding-consumer.service';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { EodSettlementWorkflowService } from './eod-settlement-workflow.service';

describe('EodSettlementWorkflowService', () => {
  let service: EodSettlementWorkflowService;
  let batchService: {
    createBatch: jest.Mock;
    createItem: jest.Mock;
    linkItemTransfer: jest.Mock;
    recomputeBatch: jest.Mock;
    resolveCryptoDirection: jest.Mock;
    closeItem: jest.Mock;
  };
  let consumer: {
    findOpenCryptoByAsset: jest.Mock;
    lock: jest.Mock;
    linkItem: jest.Mock;
    settle: jest.Mock;
    markNettedZero: jest.Mock;
  };
  let transferWorkflow: { initiate: jest.Mock };
  let systemWallets: { resolve: jest.Mock };
  let prisma: {
    internalTransaction: { findFirst: jest.Mock; findUnique: jest.Mock };
    settlementBatchItem: { findFirst: jest.Mock };
  };

  const batch = { id: 'b-1', batchNo: 'OSB-001' };

  const groupNetPositive = {
    assetId: 'a-btc',
    assetCode: 'BTC',
    decimals: 8,
    inAmount: new Prisma.Decimal(100),
    outAmount: new Prisma.Decimal(40),
    net: new Prisma.Decimal(60),
    outstandingIds: ['o1', 'o2'],
  };

  const groupNetZero = {
    assetId: 'a-eth',
    assetCode: 'ETH',
    decimals: 18,
    inAmount: new Prisma.Decimal(50),
    outAmount: new Prisma.Decimal(50),
    net: new Prisma.Decimal(0),
    outstandingIds: ['o3', 'o4'],
  };

  beforeEach(async () => {
    batchService = {
      createBatch: jest.fn().mockResolvedValue(batch),
      createItem: jest.fn().mockResolvedValue({ id: 'item-1' }),
      linkItemTransfer: jest.fn().mockResolvedValue({}),
      recomputeBatch: jest.fn().mockResolvedValue({}),
      resolveCryptoDirection: jest.fn(),
      closeItem: jest.fn().mockResolvedValue({}),
    };
    consumer = {
      findOpenCryptoByAsset: jest.fn().mockResolvedValue([]),
      lock: jest.fn().mockResolvedValue({ count: 2 }),
      linkItem: jest.fn().mockResolvedValue({ count: 2 }),
      settle: jest.fn().mockResolvedValue({ count: 2 }),
      markNettedZero: jest.fn().mockResolvedValue({ count: 2 }),
    };
    transferWorkflow = {
      initiate: jest.fn().mockResolvedValue({ id: 't-new' }),
    };
    systemWallets = {
      resolve: jest.fn((assetId: string, role: string) =>
        Promise.resolve({ id: `w-${role}` }),
      ),
    };
    prisma = {
      internalTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
      },
      settlementBatchItem: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EodSettlementWorkflowService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettlementBatchService, useValue: batchService },
        { provide: OutstandingConsumerService, useValue: consumer },
        { provide: InternalTransferWorkflowService, useValue: transferWorkflow },
        { provide: SystemWalletResolver, useValue: systemWallets },
      ],
    }).compile();

    service = module.get(EodSettlementWorkflowService);
  });

  describe('runEodSettlement', () => {
    it('returns an early no-op when there are no open crypto outstandings', async () => {
      consumer.findOpenCryptoByAsset.mockResolvedValue([]);

      const result = await service.runEodSettlement();

      expect(batchService.createBatch).not.toHaveBeenCalled();
      expect(result).toEqual({
        batchNo: null,
        assetCount: 0,
        settledZero: 0,
        spawned: 0,
      });
    });

    it('single asset net>0: nets, locks, links, spawns INTERNAL_IN', async () => {
      consumer.findOpenCryptoByAsset.mockResolvedValue([groupNetPositive]);
      batchService.resolveCryptoDirection.mockReturnValue({
        path: 'INTERNAL_IN',
        fromRole: 'F_LIQ',
        toRole: 'C_MAIN',
        amount: new Prisma.Decimal(60),
      });

      const result = await service.runEodSettlement();

      expect(batchService.createBatch).toHaveBeenCalledTimes(1);
      expect(batchService.createItem).toHaveBeenCalledWith(
        expect.objectContaining({
          settlementBatchId: 'b-1',
          assetId: 'a-btc',
          assetCode: 'BTC',
          netAmount: groupNetPositive.net,
          direction: 'INTERNAL_IN',
          outstandingCount: 2,
        }),
      );
      expect(consumer.lock).toHaveBeenCalledWith(['o1', 'o2'], 'b-1');
      expect(consumer.linkItem).toHaveBeenCalledWith(['o1', 'o2'], 'item-1');
      expect(systemWallets.resolve).toHaveBeenCalledWith('a-btc', 'F_LIQ');
      expect(systemWallets.resolve).toHaveBeenCalledWith('a-btc', 'C_MAIN');

      expect(transferWorkflow.initiate).toHaveBeenCalledTimes(1);
      const [input, operatorId] = transferWorkflow.initiate.mock.calls[0];
      expect(input).toMatchObject({
        fromRole: 'F_LIQ',
        toRole: 'C_MAIN',
        sourceType: 'EOD_SETTLEMENT',
        sourceId: 'b-1:a-btc',
        assetId: 'a-btc',
        amount: '60',
        fromWalletId: 'w-F_LIQ',
        toWalletId: 'w-C_MAIN',
        triggerSource: 'EOD',
      });
      expect(operatorId).toBe('SYSTEM');

      expect(batchService.linkItemTransfer).toHaveBeenCalledWith('item-1', 't-new');
      expect(consumer.markNettedZero).not.toHaveBeenCalled();
      expect(batchService.recomputeBatch).toHaveBeenCalledWith('b-1');
      expect(result).toEqual({
        batchNo: 'OSB-001',
        assetCount: 1,
        settledZero: 0,
        spawned: 1,
      });
    });

    it('single asset net==0: marks netted-zero, does NOT spawn a transfer', async () => {
      consumer.findOpenCryptoByAsset.mockResolvedValue([groupNetZero]);
      batchService.resolveCryptoDirection.mockReturnValue(null);

      const result = await service.runEodSettlement();

      expect(batchService.createItem).toHaveBeenCalledWith(
        expect.objectContaining({ direction: null, netAmount: groupNetZero.net }),
      );
      expect(consumer.markNettedZero).toHaveBeenCalledWith('item-1');
      expect(transferWorkflow.initiate).not.toHaveBeenCalled();
      expect(systemWallets.resolve).not.toHaveBeenCalled();
      expect(result).toEqual({
        batchNo: 'OSB-001',
        assetCount: 1,
        settledZero: 1,
        spawned: 0,
      });
    });

    it('idempotent: reuses an existing EOD transfer and still links it', async () => {
      consumer.findOpenCryptoByAsset.mockResolvedValue([groupNetPositive]);
      batchService.resolveCryptoDirection.mockReturnValue({
        path: 'INTERNAL_IN',
        fromRole: 'F_LIQ',
        toRole: 'C_MAIN',
        amount: new Prisma.Decimal(60),
      });
      prisma.internalTransaction.findFirst.mockResolvedValue({ id: 't-existing' });

      const result = await service.runEodSettlement();

      expect(transferWorkflow.initiate).not.toHaveBeenCalled();
      expect(batchService.linkItemTransfer).toHaveBeenCalledWith(
        'item-1',
        't-existing',
      );
      expect(result.spawned).toBe(1);
    });
  });

  describe('onFundsFlowStatusChanged', () => {
    it('CLEAR for an EOD transfer: settles outstandings + closes the item', async () => {
      prisma.internalTransaction.findUnique.mockResolvedValue({
        id: 't-eod',
        sourceType: 'EOD_SETTLEMENT',
      });
      prisma.settlementBatchItem.findFirst.mockResolvedValue({
        id: 'item-1',
        settlementBatchId: 'b-1',
        outstandingCount: 2,
      });

      await service.onFundsFlowStatusChanged({
        fundsFlowId: 'ff-1',
        internalTransferId: 't-eod',
        oldStatus: 'PENDING',
        newStatus: 'CLEAR',
      });

      expect(consumer.settle).toHaveBeenCalledWith('item-1', 'ff-1');
      expect(batchService.closeItem).toHaveBeenCalledWith('item-1', 2);
      expect(batchService.recomputeBatch).toHaveBeenCalledWith('b-1');
    });

    it('CLEAR for a non-EOD transfer: does nothing', async () => {
      prisma.internalTransaction.findUnique.mockResolvedValue({
        id: 't-other',
        sourceType: 'DEPOSIT_AGGREGATION',
      });

      await service.onFundsFlowStatusChanged({
        fundsFlowId: 'ff-2',
        internalTransferId: 't-other',
        oldStatus: 'PENDING',
        newStatus: 'CLEAR',
      });

      expect(consumer.settle).not.toHaveBeenCalled();
      expect(batchService.closeItem).not.toHaveBeenCalled();
      expect(batchService.recomputeBatch).not.toHaveBeenCalled();
    });

    it('ignores events without an internalTransferId', async () => {
      await service.onFundsFlowStatusChanged({
        fundsFlowId: 'ff-3',
        internalTransferId: undefined as any,
        oldStatus: 'PENDING',
        newStatus: 'CLEAR',
      });

      expect(prisma.internalTransaction.findUnique).not.toHaveBeenCalled();
      expect(consumer.settle).not.toHaveBeenCalled();
    });

    it('ignores non-CLEAR status transitions', async () => {
      prisma.internalTransaction.findUnique.mockResolvedValue({
        id: 't-eod',
        sourceType: 'EOD_SETTLEMENT',
      });

      await service.onFundsFlowStatusChanged({
        fundsFlowId: 'ff-4',
        internalTransferId: 't-eod',
        oldStatus: 'PENDING',
        newStatus: 'FAILED',
      });

      expect(consumer.settle).not.toHaveBeenCalled();
      expect(batchService.closeItem).not.toHaveBeenCalled();
    });
  });
});
