import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SettlementBatchService } from '../domain/settlement-batch.service';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { FeeCollectionWorkflowService } from './fee-collection-workflow.service';

describe('FeeCollectionWorkflowService', () => {
  let service: FeeCollectionWorkflowService;
  let batchService: {
    createBatch: jest.Mock;
    recomputeBatch: jest.Mock;
  };
  let transferWorkflow: { initiate: jest.Mock };
  let systemWallets: { resolve: jest.Mock };
  let prisma: {
    asset: { findMany: jest.Mock };
    internalTransaction: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      aggregate: jest.Mock;
    };
    withdrawTransaction: {
      aggregate: jest.Mock;
    };
  };

  const batch = { id: 'b-1', batchNo: 'OSB-001' };
  const usdtAsset = { id: 'a1', currency: 'USDT', decimals: 6 };

  beforeEach(async () => {
    batchService = {
      createBatch: jest.fn().mockResolvedValue(batch),
      recomputeBatch: jest.fn().mockResolvedValue({}),
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
      asset: { findMany: jest.fn().mockResolvedValue([usdtAsset]) },
      internalTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
      },
      withdrawTransaction: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { feeAmount: null } }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeeCollectionWorkflowService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettlementBatchService, useValue: batchService },
        { provide: InternalTransferWorkflowService, useValue: transferWorkflow },
        { provide: SystemWalletResolver, useValue: systemWallets },
      ],
    }).compile();

    service = module.get(FeeCollectionWorkflowService);
  });

  describe('runFeeCollection', () => {
    it('accrued=0.5, collected=0.2 → spawns transfer with amount "0.3"', async () => {
      prisma.withdrawTransaction.aggregate.mockResolvedValue({
        _sum: { feeAmount: '0.5' },
      });
      prisma.internalTransaction.aggregate.mockResolvedValue({
        _sum: { amount: '0.2' },
      });

      const result = await service.runFeeCollection();

      expect(batchService.createBatch).toHaveBeenCalledWith(
        expect.objectContaining({ settlementType: 'FEE_COLLECT' }),
      );

      expect(systemWallets.resolve).toHaveBeenCalledWith('a1', 'C_MAIN');
      expect(systemWallets.resolve).toHaveBeenCalledWith('a1', 'F_OPS');

      expect(transferWorkflow.initiate).toHaveBeenCalledTimes(1);
      const [input, operatorId] = transferWorkflow.initiate.mock.calls[0];
      expect(input).toMatchObject({
        fromRole: 'C_MAIN',
        toRole: 'F_OPS',
        sourceType: 'FEE_COLLECTION',
        sourceId: 'b-1:a1',
        assetId: 'a1',
        amount: '0.3',
        fromWalletId: 'w-C_MAIN',
        toWalletId: 'w-F_OPS',
        triggerSource: 'CRON',
        settlementBatchId: 'b-1',
        grossInAmount: '0',
        grossOutAmount: '0.3',
      });
      expect(operatorId).toBe('SYSTEM');

      expect(batchService.recomputeBatch).toHaveBeenCalledWith('b-1');
      expect(result).toEqual({ batchNo: 'OSB-001', assetCount: 1, collected: 1 });
    });

    it('accrued=0.5, collected=0.5 (equal) → asset skipped, no batch created', async () => {
      prisma.withdrawTransaction.aggregate.mockResolvedValue({
        _sum: { feeAmount: '0.5' },
      });
      prisma.internalTransaction.aggregate.mockResolvedValue({
        _sum: { amount: '0.5' },
      });

      const result = await service.runFeeCollection();

      expect(batchService.createBatch).not.toHaveBeenCalled();
      expect(transferWorkflow.initiate).not.toHaveBeenCalled();
      expect(result).toEqual({ batchNo: null, assetCount: 0, collected: 0 });
    });

    it('both accrued and collected are null/0 → no batch created', async () => {
      // defaults: both aggregate return null
      const result = await service.runFeeCollection();

      expect(batchService.createBatch).not.toHaveBeenCalled();
      expect(transferWorkflow.initiate).not.toHaveBeenCalled();
      expect(result).toEqual({ batchNo: null, assetCount: 0, collected: 0 });
    });

    it('does NOT call resolveTbAccountId or lookupBalance (no TB reads)', async () => {
      prisma.withdrawTransaction.aggregate.mockResolvedValue({
        _sum: { feeAmount: '0.5' },
      });
      prisma.internalTransaction.aggregate.mockResolvedValue({
        _sum: { amount: '0' },
      });

      await service.runFeeCollection();

      // The service should have no accounting property at all (AccountingService removed)
      expect((service as any).accounting).toBeUndefined();
    });

    it('idempotent: existing FEE_COLLECTION transfer skips initiate', async () => {
      prisma.withdrawTransaction.aggregate.mockResolvedValue({
        _sum: { feeAmount: '0.5' },
      });
      prisma.internalTransaction.aggregate.mockResolvedValue({
        _sum: { amount: '0' },
      });
      prisma.internalTransaction.findFirst.mockResolvedValue({ id: 't-existing' });

      const result = await service.runFeeCollection();

      expect(transferWorkflow.initiate).not.toHaveBeenCalled();
      expect(result.collected).toBe(1);
    });

    it('withdrawTransaction.aggregate called with assetId + SUCCESS status; internalTransaction.aggregate called with assetId + FEE_COLLECTION sourceType', async () => {
      prisma.withdrawTransaction.aggregate.mockResolvedValue({
        _sum: { feeAmount: '1.0' },
      });
      prisma.internalTransaction.aggregate.mockResolvedValue({
        _sum: { amount: '0' },
      });

      await service.runFeeCollection();

      expect(prisma.withdrawTransaction.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ assetId: 'a1', status: 'SUCCESS' }),
          _sum: { feeAmount: true },
        }),
      );
      expect(prisma.internalTransaction.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            assetId: 'a1',
            sourceType: 'FEE_COLLECTION',
          }),
          _sum: { amount: true },
        }),
      );
    });

    it('NO item layer', async () => {
      expect((batchService as any).createItem).toBeUndefined();
      expect((batchService as any).linkItemTransfer).toBeUndefined();
    });
  });

  describe('onFundsFlowStatusChanged', () => {
    it('CLEAR for a FEE_COLLECTION transfer: recomputes batch (no item lookup, no closeItem)', async () => {
      prisma.internalTransaction.findUnique.mockResolvedValue({
        id: 't-fee',
        sourceType: 'FEE_COLLECTION',
        settlementBatchId: 'b-1',
      });

      await service.onFundsFlowStatusChanged({
        fundsFlowId: 'ff-1',
        internalTransferId: 't-fee',
        oldStatus: 'PENDING',
        newStatus: 'CLEAR',
      });

      // NO settlementBatchItem lookup
      expect((prisma as any).settlementBatchItem).toBeUndefined();
      // NO closeItem
      expect((batchService as any).closeItem).toBeUndefined();
      expect(batchService.recomputeBatch).toHaveBeenCalledWith('b-1');
    });

    it('CLEAR for a non-FEE_COLLECTION transfer (EOD_SETTLEMENT): does nothing', async () => {
      prisma.internalTransaction.findUnique.mockResolvedValue({
        id: 't-eod',
        sourceType: 'EOD_SETTLEMENT',
        settlementBatchId: 'b-2',
      });

      await service.onFundsFlowStatusChanged({
        fundsFlowId: 'ff-2',
        internalTransferId: 't-eod',
        oldStatus: 'PENDING',
        newStatus: 'CLEAR',
      });

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
      expect(batchService.recomputeBatch).not.toHaveBeenCalled();
    });

    it('ignores non-CLEAR status transitions', async () => {
      prisma.internalTransaction.findUnique.mockResolvedValue({
        id: 't-fee',
        sourceType: 'FEE_COLLECTION',
        settlementBatchId: 'b-1',
      });

      await service.onFundsFlowStatusChanged({
        fundsFlowId: 'ff-4',
        internalTransferId: 't-fee',
        oldStatus: 'PENDING',
        newStatus: 'FAILED',
      });

      expect(batchService.recomputeBatch).not.toHaveBeenCalled();
    });
  });
});
