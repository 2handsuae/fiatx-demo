import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SettlementBatchService } from '../domain/settlement-batch.service';
import { OutstandingConsumerService } from '../domain/outstanding-consumer.service';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { FxEodService } from '../accounting/fx-eod.service';
import { FeeAccrualService } from '../domain/fee-accrual.service';
import { EodSettlementWorkflowService } from './eod-settlement-workflow.service';

describe('EodSettlementWorkflowService', () => {
  let service: EodSettlementWorkflowService;
  let batchService: {
    createBatch: jest.Mock;
    recomputeBatch: jest.Mock;
    resolveCryptoDirection: jest.Mock;
  };
  let consumer: {
    findOpenCryptoByAsset: jest.Mock;
    lockToTransfer: jest.Mock;
    lockToBatch: jest.Mock;
    settle: jest.Mock;
    markSettledNettedZero: jest.Mock;
  };
  let transferWorkflow: { initiate: jest.Mock };
  let systemWallets: { resolve: jest.Mock };
  let fxEod: {
    runEodAccounting: jest.Mock;
    runSweepOnly: jest.Mock;
    runReval: jest.Mock;
    revalueFxPositions: jest.Mock;
  };
  let feeAccrual: { settleByTransfer: jest.Mock; settle: jest.Mock };
  let prisma: {
    internalTransaction: { findFirst: jest.Mock; findUnique: jest.Mock };
    settlementBatch: { findUnique: jest.Mock };
    outstanding: { count: jest.Mock };
    feeAccrual: { findMany: jest.Mock };
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
      recomputeBatch: jest.fn().mockResolvedValue({}),
      resolveCryptoDirection: jest.fn(),
    };
    consumer = {
      findOpenCryptoByAsset: jest.fn().mockResolvedValue([]),
      lockToTransfer: jest.fn().mockResolvedValue({ count: 2 }),
      lockToBatch: jest.fn().mockResolvedValue({ count: 2 }),
      settle: jest.fn().mockResolvedValue({ count: 2 }),
      markSettledNettedZero: jest.fn().mockResolvedValue({ count: 2 }),
    };
    transferWorkflow = {
      initiate: jest.fn().mockResolvedValue({ id: 't-new' }),
    };
    systemWallets = {
      resolve: jest.fn((assetId: string, role: string) =>
        Promise.resolve({ id: `w-${role}` }),
      ),
    };
    fxEod = {
      runEodAccounting: jest
        .fn()
        .mockResolvedValue({ sweeps: [], revals: [], violations: [] }),
      runSweepOnly: jest
        .fn()
        .mockResolvedValue({ sweeps: [], revals: [], violations: [] }),
      runReval: jest
        .fn()
        .mockResolvedValue({ sweeps: [], revals: [], violations: [] }),
      revalueFxPositions: jest.fn().mockResolvedValue(undefined),
    };
    feeAccrual = {
      settleByTransfer: jest.fn().mockResolvedValue({ count: 0 }),
      settle: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      internalTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
      },
      settlementBatch: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ batchNo: 'OSB-001', settlementType: 'EOD' }),
      },
      outstanding: {
        count: jest.fn().mockResolvedValue(0),
      },
      feeAccrual: {
        // Default: no open fee accruals → fee pass is a no-op.
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EodSettlementWorkflowService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettlementBatchService, useValue: batchService },
        { provide: OutstandingConsumerService, useValue: consumer },
        { provide: InternalTransferWorkflowService, useValue: transferWorkflow },
        { provide: SystemWalletResolver, useValue: systemWallets },
        { provide: FxEodService, useValue: fxEod },
        { provide: FeeAccrualService, useValue: feeAccrual },
      ],
    }).compile();

    service = module.get(EodSettlementWorkflowService);
  });

  describe('runEodSettlement', () => {
    it('returns an early no-op when there are no open crypto outstandings', async () => {
      consumer.findOpenCryptoByAsset.mockResolvedValue([]);

      const result = await service.runEodSettlement();

      expect(batchService.createBatch).not.toHaveBeenCalled();
      // No batch → no EOD accounting run either.
      expect(fxEod.runReval).not.toHaveBeenCalled();
      expect(fxEod.runSweepOnly).not.toHaveBeenCalled();
      expect(result).toEqual({
        batchNo: null,
        assetCount: 0,
        settledZero: 0,
        spawned: 0,
      });
    });

    it('single asset net>0: spawns transfer under batch, locks outstandings to transfer', async () => {
      consumer.findOpenCryptoByAsset.mockResolvedValue([groupNetPositive]);
      batchService.resolveCryptoDirection.mockReturnValue({
        path: 'CRYPTO_SETTLE_IN',
        fromRole: 'F_OPS',
        toRole: 'C_MAIN',
        amount: new Prisma.Decimal(60),
      });

      const result = await service.runEodSettlement();

      expect(batchService.createBatch).toHaveBeenCalledTimes(1);

      // No createItem / lock / linkItem / linkItemTransfer — those methods no longer exist.
      expect((batchService as any).createItem).toBeUndefined();
      expect((consumer as any).lock).toBeUndefined();
      expect((consumer as any).linkItem).toBeUndefined();
      expect((batchService as any).linkItemTransfer).toBeUndefined();

      expect(systemWallets.resolve).toHaveBeenCalledWith('a-btc', 'F_OPS');
      expect(systemWallets.resolve).toHaveBeenCalledWith('a-btc', 'C_MAIN');

      expect(transferWorkflow.initiate).toHaveBeenCalledTimes(1);
      const [input, operatorId] = transferWorkflow.initiate.mock.calls[0];
      expect(input).toMatchObject({
        fromRole: 'F_OPS',
        toRole: 'C_MAIN',
        sourceType: 'EOD_SETTLEMENT',
        sourceId: 'b-1:a-btc',
        assetId: 'a-btc',
        amount: '60',
        fromWalletId: 'w-F_OPS',
        toWalletId: 'w-C_MAIN',
        triggerSource: 'EOD',
        settlementBatchId: 'b-1',
        grossInAmount: '100',
        grossOutAmount: '40',
      });
      expect(operatorId).toBe('SYSTEM');

      expect(consumer.lockToTransfer).toHaveBeenCalledWith(
        ['o1', 'o2'],
        'b-1',
        't-new',
      );

      expect(consumer.markSettledNettedZero).not.toHaveBeenCalled();
      expect(consumer.lockToBatch).not.toHaveBeenCalled();
      expect(batchService.recomputeBatch).toHaveBeenCalledWith('b-1');
      // Two-book: EOD path revalues (mark-to-market) under the batchNo.
      expect(fxEod.runReval).toHaveBeenCalledWith('OSB-001');
      expect(result).toEqual({
        batchNo: 'OSB-001',
        assetCount: 1,
        settledZero: 0,
        spawned: 1,
      });
    });

    it('single asset net==0: locks to batch + marks netted-zero, does NOT spawn a transfer', async () => {
      consumer.findOpenCryptoByAsset.mockResolvedValue([groupNetZero]);
      batchService.resolveCryptoDirection.mockReturnValue(null);

      const result = await service.runEodSettlement();

      expect(consumer.lockToBatch).toHaveBeenCalledWith(['o3', 'o4'], 'b-1');
      expect(consumer.markSettledNettedZero).toHaveBeenCalledWith('b-1', 'a-eth');
      expect(transferWorkflow.initiate).not.toHaveBeenCalled();
      expect(systemWallets.resolve).not.toHaveBeenCalled();
      expect(consumer.lockToTransfer).not.toHaveBeenCalled();
      expect(batchService.recomputeBatch).toHaveBeenCalledWith('b-1');
      expect(result).toEqual({
        batchNo: 'OSB-001',
        assetCount: 1,
        settledZero: 1,
        spawned: 0,
      });
    });

    describe('fee pass (after principal settlement)', () => {
      it('settles open crypto SWAP_FEE + WITHDRAW_FEE accruals once per category as EOD', async () => {
        // No principal outstandings this EOD — the fee pass must still settle all
        // open crypto fee accruals (it gathers its asset set independently).
        consumer.findOpenCryptoByAsset.mockResolvedValue([]);

        const swapFees = [{ id: 'fac-s1', assetId: 'a-btc', amount: '0.001' }];
        const wdFees = [{ id: 'fac-w1', assetId: 'a-btc', amount: '0.0005' }];

        prisma.feeAccrual.findMany
          // 1) distinct crypto assetIds with open accruals
          .mockResolvedValueOnce([{ assetId: 'a-btc' }])
          // 2) a-btc SWAP_FEE ACCRUED
          .mockResolvedValueOnce(swapFees)
          // 3) a-btc WITHDRAW_FEE ACCRUED
          .mockResolvedValueOnce(wdFees);

        await service.runEodSettlement();

        // SWAP_FEE net settled as EOD
        expect(feeAccrual.settle).toHaveBeenCalledWith(
          swapFees,
          'SWAP_FEE',
          'EOD',
          prisma,
        );
        // WITHDRAW_FEE net settled as EOD
        expect(feeAccrual.settle).toHaveBeenCalledWith(
          wdFees,
          'WITHDRAW_FEE',
          'EOD',
          prisma,
        );
        expect(feeAccrual.settle).toHaveBeenCalledTimes(2);
      });

      it('skips a category with no open accruals (no empty settle)', async () => {
        consumer.findOpenCryptoByAsset.mockResolvedValue([]);

        const swapFees = [{ id: 'fac-s1', assetId: 'a-btc', amount: '0.001' }];
        prisma.feeAccrual.findMany
          .mockResolvedValueOnce([{ assetId: 'a-btc' }]) // distinct
          .mockResolvedValueOnce(swapFees) // SWAP_FEE present
          .mockResolvedValueOnce([]); // WITHDRAW_FEE empty

        await service.runEodSettlement();

        expect(feeAccrual.settle).toHaveBeenCalledWith(
          swapFees,
          'SWAP_FEE',
          'EOD',
          prisma,
        );
        expect(feeAccrual.settle).toHaveBeenCalledTimes(1);
      });

      it('no open accruals → fee pass is a no-op', async () => {
        consumer.findOpenCryptoByAsset.mockResolvedValue([]);
        prisma.feeAccrual.findMany.mockResolvedValue([]); // no distinct assets

        await service.runEodSettlement();

        expect(feeAccrual.settle).not.toHaveBeenCalled();
      });
    });

    it('idempotent: reuses an existing EOD transfer and still locks outstandings to it', async () => {
      consumer.findOpenCryptoByAsset.mockResolvedValue([groupNetPositive]);
      batchService.resolveCryptoDirection.mockReturnValue({
        path: 'CRYPTO_SETTLE_IN',
        fromRole: 'F_OPS',
        toRole: 'C_MAIN',
        amount: new Prisma.Decimal(60),
      });
      prisma.internalTransaction.findFirst.mockResolvedValue({
        id: 't-existing',
        settlementBatchId: 'b-1',
      });

      const result = await service.runEodSettlement();

      expect(transferWorkflow.initiate).not.toHaveBeenCalled();
      expect(consumer.lockToTransfer).toHaveBeenCalledWith(
        ['o1', 'o2'],
        'b-1',
        't-existing',
      );
      expect(result.spawned).toBe(1);
    });
  });

  describe('cutoff windowing', () => {
    const cutoff = new Date('2026-06-17T20:00:00.000Z');

    it('passes the injected cutoff to the principal query and stamps it on the batch', async () => {
      consumer.findOpenCryptoByAsset.mockResolvedValue([groupNetZero]);
      batchService.resolveCryptoDirection.mockReturnValue(null);

      await service.runEodSettlement('TEST', cutoff);

      expect(consumer.findOpenCryptoByAsset).toHaveBeenCalledWith(cutoff);
      expect(batchService.createBatch).toHaveBeenCalledWith({ cutoffAt: cutoff });
    });

    it('windows all three fee-pass queries by createdAt < cutoff', async () => {
      consumer.findOpenCryptoByAsset.mockResolvedValue([]); // fee-only path
      prisma.feeAccrual.findMany
        .mockResolvedValueOnce([{ assetId: 'a-btc' }]) // distinct assets
        .mockResolvedValueOnce([{ id: 'fac-s1', assetId: 'a-btc', amount: '0.001' }]) // SWAP_FEE
        .mockResolvedValueOnce([]); // WITHDRAW_FEE

      await service.runEodSettlement('TEST', cutoff);

      const distinctWhere = prisma.feeAccrual.findMany.mock.calls[0][0].where;
      expect(distinctWhere).toMatchObject({
        status: 'ACCRUED',
        asset: { type: 'CRYPTO' },
        createdAt: { lt: cutoff },
      });
      const swapWhere = prisma.feeAccrual.findMany.mock.calls[1][0].where;
      expect(swapWhere).toMatchObject({
        assetId: 'a-btc',
        category: 'SWAP_FEE',
        status: 'ACCRUED',
        createdAt: { lt: cutoff },
      });
      const wdWhere = prisma.feeAccrual.findMany.mock.calls[2][0].where;
      expect(wdWhere).toMatchObject({
        assetId: 'a-btc',
        category: 'WITHDRAW_FEE',
        status: 'ACCRUED',
        createdAt: { lt: cutoff },
      });
    });

    it('defaults the cutoff when none is provided (principal query still receives a Date)', async () => {
      consumer.findOpenCryptoByAsset.mockResolvedValue([]);

      await service.runEodSettlement();

      expect(consumer.findOpenCryptoByAsset).toHaveBeenCalledTimes(1);
      const arg = consumer.findOpenCryptoByAsset.mock.calls[0][0];
      expect(arg).toBeInstanceOf(Date);
    });
  });

  describe('onFundsFlowStatusChanged', () => {
    it('CLEAR for an EOD transfer: settles outstandings + recomputes batch', async () => {
      prisma.internalTransaction.findUnique.mockResolvedValue({
        id: 't-eod',
        sourceType: 'EOD_SETTLEMENT',
        settlementBatchId: 'b-1',
      });

      await service.onFundsFlowStatusChanged({
        fundsFlowId: 'ff-1',
        internalTransferId: 't-eod',
        oldStatus: 'PENDING',
        newStatus: 'CLEAR',
      });

      expect(consumer.settle).toHaveBeenCalledWith('t-eod', 'ff-1');
      // EOD principal transfers carry no fee accruals — fee settlement is a fee-transfer concern.
      expect(feeAccrual.settleByTransfer).not.toHaveBeenCalled();
      expect(batchService.recomputeBatch).toHaveBeenCalledWith('b-1');
      // Two-book: look up the batch (kind + no) to decide sweep vs reval.
      expect(prisma.settlementBatch.findUnique).toHaveBeenCalledWith({
        where: { id: 'b-1' },
        select: { batchNo: true, settlementType: true },
      });
      // EOD batch, fully settled (outstanding.count → 0) → revalue.
      expect(fxEod.runReval).toHaveBeenCalledWith('OSB-001');
      // No settlementBatchItem lookup.
      expect((prisma as any).settlementBatchItem).toBeUndefined();
    });

    it('CLEAR closeout survives an EOD accounting failure (logged, not thrown)', async () => {
      prisma.internalTransaction.findUnique.mockResolvedValue({
        id: 't-eod',
        sourceType: 'EOD_SETTLEMENT',
        settlementBatchId: 'b-1',
      });
      fxEod.runReval.mockRejectedValue(new Error('TB unavailable'));

      await expect(
        service.onFundsFlowStatusChanged({
          fundsFlowId: 'ff-1',
          internalTransferId: 't-eod',
          oldStatus: 'PENDING',
          newStatus: 'CLEAR',
        }),
      ).resolves.toBeUndefined();

      expect(consumer.settle).toHaveBeenCalledWith('t-eod', 'ff-1');
      expect(batchService.recomputeBatch).toHaveBeenCalledWith('b-1');
    });

    it('CLEAR of EOD principal leg: sweep-only, and reval when batch fully settled', async () => {
      (prisma as any).internalTransaction.findUnique.mockResolvedValue({ id: 't1', sourceType: 'EOD_SETTLEMENT', settlementBatchId: 'b1' });
      (prisma as any).settlementBatch.findUnique.mockResolvedValue({ batchNo: 'SB-1', settlementType: 'EOD' });
      (prisma as any).outstanding.count.mockResolvedValue(0); // fully settled
      await service.onFundsFlowStatusChanged({ internalTransferId: 't1', fundsFlowId: 'f1', newStatus: 'CLEAR' } as any);
      expect(fxEod.runReval).toHaveBeenCalledWith('SB-1');
      expect(fxEod.runSweepOnly).not.toHaveBeenCalled();
    });

    it('CLEAR of EOD leg when batch NOT yet fully settled: sweep-only, not reval', async () => {
      (prisma as any).internalTransaction.findUnique.mockResolvedValue({ id: 't3', sourceType: 'EOD_SETTLEMENT', settlementBatchId: 'b3' });
      (prisma as any).settlementBatch.findUnique.mockResolvedValue({ batchNo: 'SB-3', settlementType: 'EOD' });
      (prisma as any).outstanding.count.mockResolvedValue(1); // one leg still LOCKED → not fully settled
      await service.onFundsFlowStatusChanged({ internalTransferId: 't3', fundsFlowId: 'f3', newStatus: 'CLEAR' } as any);
      expect(fxEod.runSweepOnly).toHaveBeenCalledWith('SB-3');
      expect(fxEod.runReval).not.toHaveBeenCalled();
    });

    it('CLEAR of MANUAL_SETTLE principal leg: sweep-only, never reval', async () => {
      (prisma as any).internalTransaction.findUnique.mockResolvedValue({ id: 't2', sourceType: 'EOD_SETTLEMENT', settlementBatchId: 'b2' });
      (prisma as any).settlementBatch.findUnique.mockResolvedValue({ batchNo: 'SB-2', settlementType: 'MANUAL_SETTLE' });
      (prisma as any).outstanding.count.mockResolvedValue(0);
      await service.onFundsFlowStatusChanged({ internalTransferId: 't2', fundsFlowId: 'f2', newStatus: 'CLEAR' } as any);
      expect(fxEod.runSweepOnly).toHaveBeenCalledWith('SB-2');
      expect(fxEod.runReval).not.toHaveBeenCalled();
    });

    it('CLEAR for a SWAP_FEE_SETTLEMENT transfer: settles fee accruals, NOT outstandings', async () => {
      prisma.internalTransaction.findUnique.mockResolvedValue({
        id: 't-fee',
        sourceType: 'SWAP_FEE_SETTLEMENT',
      });

      await service.onFundsFlowStatusChanged({
        fundsFlowId: 'ff-fee',
        internalTransferId: 't-fee',
        oldStatus: 'PENDING',
        newStatus: 'CLEAR',
      });

      // Fee transfer → flip LOCKED→SETTLED fee accruals for this transfer.
      expect(feeAccrual.settleByTransfer).toHaveBeenCalledWith(
        't-fee',
        'ff-fee',
        prisma,
      );
      // Fee transfers carry no crypto outstandings — the consumer path must not run.
      expect(consumer.settle).not.toHaveBeenCalled();
    });

    it('CLEAR for a WITHDRAW_FEE_SETTLEMENT transfer: settles fee accruals, NOT outstandings', async () => {
      prisma.internalTransaction.findUnique.mockResolvedValue({
        id: 't-wfee',
        sourceType: 'WITHDRAW_FEE_SETTLEMENT',
      });

      await service.onFundsFlowStatusChanged({
        fundsFlowId: 'ff-wfee',
        internalTransferId: 't-wfee',
        oldStatus: 'PENDING',
        newStatus: 'CLEAR',
      });

      expect(feeAccrual.settleByTransfer).toHaveBeenCalledWith(
        't-wfee',
        'ff-wfee',
        prisma,
      );
      expect(consumer.settle).not.toHaveBeenCalled();
    });

    it('CLEAR for a non-settlement transfer: does nothing', async () => {
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
      expect(feeAccrual.settleByTransfer).not.toHaveBeenCalled();
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
        settlementBatchId: 'b-1',
      });

      await service.onFundsFlowStatusChanged({
        fundsFlowId: 'ff-4',
        internalTransferId: 't-eod',
        oldStatus: 'PENDING',
        newStatus: 'FAILED',
      });

      expect(consumer.settle).not.toHaveBeenCalled();
      expect(batchService.recomputeBatch).not.toHaveBeenCalled();
    });
  });

  describe('runManualCryptoSettlement', () => {
    it('runManualCryptoSettlement: creates MANUAL_SETTLE batch and never revalues', async () => {
      consumer.findOpenCryptoByAsset.mockResolvedValue([
        { assetId: 'usdt', net: 100n, inAmount: '100', outAmount: '0', outstandingIds: ['o1'] } as any,
      ]);
      batchService.createBatch.mockResolvedValue({ id: 'b1', batchNo: 'SB-1' } as any);
      batchService.resolveCryptoDirection.mockReturnValue({ fromRole: 'C_MAIN', toRole: 'F_OPS', amount: { toString: () => '100' } } as any);
      transferWorkflow.initiate.mockResolvedValue({ id: 't1' } as any);
      const result = await service.runManualCryptoSettlement('ADMIN');
      expect(batchService.createBatch).toHaveBeenCalledWith(expect.objectContaining({ settlementType: 'MANUAL_SETTLE' }));
      expect(fxEod.revalueFxPositions).not.toHaveBeenCalled();
      expect(fxEod.runEodAccounting).not.toHaveBeenCalled();
      expect(result).toEqual({ batchNo: 'SB-1', assetCount: 1, settledZero: 0, spawned: 1 });
    });
  });
});
