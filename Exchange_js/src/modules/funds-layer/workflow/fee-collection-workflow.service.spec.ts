import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { SettlementBatchService } from '../domain/settlement-batch.service';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { FeeCollectionWorkflowService } from './fee-collection-workflow.service';

describe('FeeCollectionWorkflowService', () => {
  let service: FeeCollectionWorkflowService;
  let batchService: {
    createBatch: jest.Mock;
    createItem: jest.Mock;
    linkItemTransfer: jest.Mock;
    recomputeBatch: jest.Mock;
    closeItem: jest.Mock;
  };
  let accounting: {
    resolveTbAccountId: jest.Mock;
    lookupBalance: jest.Mock;
  };
  let transferWorkflow: { initiate: jest.Mock };
  let systemWallets: { resolve: jest.Mock };
  let prisma: {
    asset: { findMany: jest.Mock };
    internalTransaction: { findFirst: jest.Mock; findUnique: jest.Mock };
    settlementBatchItem: { findFirst: jest.Mock };
  };

  const batch = { id: 'b-1', batchNo: 'OSB-001' };
  const usdtAsset = { id: 'a1', currency: 'USDT', decimals: 6 };

  beforeEach(async () => {
    batchService = {
      createBatch: jest.fn().mockResolvedValue(batch),
      createItem: jest.fn().mockResolvedValue({ id: 'item-1' }),
      linkItemTransfer: jest.fn().mockResolvedValue({}),
      recomputeBatch: jest.fn().mockResolvedValue({}),
      closeItem: jest.fn().mockResolvedValue({}),
    };
    accounting = {
      resolveTbAccountId: jest.fn().mockResolvedValue(999n),
      lookupBalance: jest.fn().mockResolvedValue({
        creditsPosted: 0n,
        debitsPosted: 0n,
        creditsPending: 0n,
        debitsPending: 0n,
      }),
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
      },
      settlementBatchItem: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeeCollectionWorkflowService,
        { provide: PrismaService, useValue: prisma },
        { provide: AccountingService, useValue: accounting },
        { provide: SettlementBatchService, useValue: batchService },
        { provide: InternalTransferWorkflowService, useValue: transferWorkflow },
        { provide: SystemWalletResolver, useValue: systemWallets },
      ],
    }).compile();

    service = module.get(FeeCollectionWorkflowService);
  });

  describe('runFeeCollection', () => {
    it('asset with FEE_RECEIVABLE > 0: creates FEE_COLLECT batch + item, initiates C_MAIN→F_OPS transfer', async () => {
      // USDT 6dp: 5000000n credits − 0n debits = 5.0
      accounting.lookupBalance.mockResolvedValue({
        creditsPosted: 5000000n,
        debitsPosted: 0n,
        creditsPending: 0n,
        debitsPending: 0n,
      });

      const result = await service.runFeeCollection();

      expect(batchService.createBatch).toHaveBeenCalledWith(
        expect.objectContaining({ settlementType: 'FEE_COLLECT' }),
      );
      expect(batchService.createItem).toHaveBeenCalledWith(
        expect.objectContaining({
          settlementBatchId: 'b-1',
          assetId: 'a1',
          assetCode: 'USDT',
          direction: 'FEE_COLLECT',
          outstandingCount: 0,
        }),
      );
      const itemArg = batchService.createItem.mock.calls[0][0];
      expect(itemArg.netAmount.toString()).toBe('5');
      expect(itemArg.outAmount.toString()).toBe('5');
      expect(itemArg.inAmount.toString()).toBe('0');

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
        amount: '5',
        fromWalletId: 'w-C_MAIN',
        toWalletId: 'w-F_OPS',
        triggerSource: 'CRON',
      });
      expect(operatorId).toBe('SYSTEM');

      expect(batchService.linkItemTransfer).toHaveBeenCalledWith('item-1', 't-new');
      expect(batchService.recomputeBatch).toHaveBeenCalledWith('b-1');
      expect(result).toEqual({ batchNo: 'OSB-001', assetCount: 1, collected: 1 });
    });

    it('FEE_RECEIVABLE balance 0: skips asset, no batch created', async () => {
      accounting.lookupBalance.mockResolvedValue({
        creditsPosted: 0n,
        debitsPosted: 0n,
        creditsPending: 0n,
        debitsPending: 0n,
      });

      const result = await service.runFeeCollection();

      expect(batchService.createBatch).not.toHaveBeenCalled();
      expect(transferWorkflow.initiate).not.toHaveBeenCalled();
      expect(result).toEqual({ batchNo: null, assetCount: 0, collected: 0 });
    });

    it('skips currency without a TB ledger (no error)', async () => {
      prisma.asset.findMany.mockResolvedValue([
        { id: 'a2', currency: 'BTC', decimals: 8 },
      ]);

      const result = await service.runFeeCollection();

      expect(accounting.lookupBalance).not.toHaveBeenCalled();
      expect(batchService.createBatch).not.toHaveBeenCalled();
      expect(result).toEqual({ batchNo: null, assetCount: 0, collected: 0 });
    });

    it('idempotent: reuses an existing FEE_COLLECTION transfer, still links it', async () => {
      accounting.lookupBalance.mockResolvedValue({
        creditsPosted: 5000000n,
        debitsPosted: 0n,
        creditsPending: 0n,
        debitsPending: 0n,
      });
      prisma.internalTransaction.findFirst.mockResolvedValue({ id: 't-existing' });

      const result = await service.runFeeCollection();

      expect(transferWorkflow.initiate).not.toHaveBeenCalled();
      expect(batchService.linkItemTransfer).toHaveBeenCalledWith(
        'item-1',
        't-existing',
      );
      expect(result.collected).toBe(1);
    });
  });

  describe('onFundsFlowStatusChanged', () => {
    it('CLEAR for a FEE_COLLECTION transfer: closes the item + recomputes', async () => {
      prisma.internalTransaction.findUnique.mockResolvedValue({
        id: 't-fee',
        sourceType: 'FEE_COLLECTION',
      });
      prisma.settlementBatchItem.findFirst.mockResolvedValue({
        id: 'item-1',
        settlementBatchId: 'b-1',
      });

      await service.onFundsFlowStatusChanged({
        fundsFlowId: 'ff-1',
        internalTransferId: 't-fee',
        oldStatus: 'PENDING',
        newStatus: 'CLEAR',
      });

      expect(batchService.closeItem).toHaveBeenCalledWith('item-1', 0);
      expect(batchService.recomputeBatch).toHaveBeenCalledWith('b-1');
    });

    it('CLEAR for a non-FEE_COLLECTION transfer (EOD_SETTLEMENT): does nothing', async () => {
      prisma.internalTransaction.findUnique.mockResolvedValue({
        id: 't-eod',
        sourceType: 'EOD_SETTLEMENT',
      });

      await service.onFundsFlowStatusChanged({
        fundsFlowId: 'ff-2',
        internalTransferId: 't-eod',
        oldStatus: 'PENDING',
        newStatus: 'CLEAR',
      });

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
      expect(batchService.closeItem).not.toHaveBeenCalled();
    });

    it('ignores non-CLEAR status transitions', async () => {
      prisma.internalTransaction.findUnique.mockResolvedValue({
        id: 't-fee',
        sourceType: 'FEE_COLLECTION',
      });

      await service.onFundsFlowStatusChanged({
        fundsFlowId: 'ff-4',
        internalTransferId: 't-fee',
        oldStatus: 'PENDING',
        newStatus: 'FAILED',
      });

      expect(batchService.closeItem).not.toHaveBeenCalled();
    });
  });
});
