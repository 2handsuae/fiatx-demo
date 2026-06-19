import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { OutstandingConsumerService } from './outstanding-consumer.service';
import { SettlementBatchService } from './settlement-batch.service';

describe('OutstandingConsumerService', () => {
  let service: OutstandingConsumerService;
  let prisma: any;
  let auditLogsService: any;
  let batchService: any;

  beforeEach(async () => {
    prisma = {
      outstanding: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn((args: any) => ({ count: 1 })),
      },
      settlementBatch: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue(undefined),
    };
    batchService = {
      recomputeBatch: jest.fn().mockResolvedValue({} as any),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        OutstandingConsumerService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettlementBatchService, useValue: batchService },
        { provide: AuditLogsService, useValue: auditLogsService },
      ],
    }).compile();

    service = moduleRef.get<OutstandingConsumerService>(
      OutstandingConsumerService,
    );
    jest.clearAllMocks();
  });

  it('findOpenCryptoByAsset groups by asset, computes net IN-OUT, collects ids', async () => {
    prisma.outstanding.findMany.mockResolvedValue([
      {
        id: 'o1',
        direction: 'IN',
        amount: '100',
        assetId: 'asset-A',
        assetCode: 'BTC',
        asset: { currency: 'BTC', decimals: 8 },
      },
      {
        id: 'o2',
        direction: 'OUT',
        amount: '40',
        assetId: 'asset-A',
        assetCode: 'BTC',
        asset: { currency: 'BTC', decimals: 8 },
      },
      {
        id: 'o3',
        direction: 'IN',
        amount: '5',
        assetId: 'asset-B',
        assetCode: 'ETH',
        asset: { currency: 'ETH', decimals: 18 },
      },
    ]);

    const cutoff = new Date('2026-06-17T20:00:00.000Z');
    const groups = await service.findOpenCryptoByAsset(cutoff);

    // query guards
    const where = prisma.outstanding.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('OPEN');
    expect(where.asset).toEqual({ type: 'CRYPTO' });
    expect(where.settlementBatchId).toBeNull();
    expect(where.createdAt).toEqual({ lt: cutoff });

    const a = groups.find((g) => g.assetId === 'asset-A')!;
    expect(a.inAmount.toString()).toBe('100');
    expect(a.outAmount.toString()).toBe('40');
    expect(a.net.toString()).toBe('60');
    expect(a.decimals).toBe(8);
    expect(a.assetCode).toBe('BTC');
    expect(a.outstandingIds.sort()).toEqual(['o1', 'o2']);

    const b = groups.find((g) => g.assetId === 'asset-B')!;
    expect(b.net.toString()).toBe('5');
    expect(b.outstandingIds).toEqual(['o3']);
  });

  it('findOpenCryptoByAsset windows selection by createdAt < cutoff', async () => {
    const cutoff = new Date('2026-06-17T20:00:00.000Z');

    await service.findOpenCryptoByAsset(cutoff);

    const where = prisma.outstanding.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('OPEN');
    expect(where.asset).toEqual({ type: 'CRYPTO' });
    expect(where.settlementBatchId).toBeNull();
    expect(where.createdAt).toEqual({ lt: cutoff });
  });

  it('lockToTransfer sets LOCKED + batch + transfer', async () => {
    await service.lockToTransfer(['o1', 'o2'], 'batch1', 'tx1');

    const args = prisma.outstanding.updateMany.mock.calls[0][0];
    expect(args.where.id).toEqual({ in: ['o1', 'o2'] });
    expect(args.where.status).toBe('OPEN');
    expect(args.data.status).toBe('LOCKED');
    expect(args.data.settlementBatchId).toBe('batch1');
    expect(args.data.settledByTransferId).toBe('tx1');
    expect(args.data.lockedAt).toBeInstanceOf(Date);
  });

  it('lockToBatch sets LOCKED + batch only', async () => {
    await service.lockToBatch(['o1'], 'batch1');

    const args = prisma.outstanding.updateMany.mock.calls[0][0];
    expect(args.where.id).toEqual({ in: ['o1'] });
    expect(args.where.status).toBe('OPEN');
    expect(args.data.status).toBe('LOCKED');
    expect(args.data.settlementBatchId).toBe('batch1');
    expect(args.data.lockedAt).toBeInstanceOf(Date);
    expect(args.data.settledByTransferId).toBeUndefined();
  });

  it('settle marks SETTLED by transferId', async () => {
    await service.settle('tx1', 'fund1');

    const args = prisma.outstanding.updateMany.mock.calls[0][0];
    expect(args.where.settledByTransferId).toBe('tx1');
    expect(args.where.status).toBe('LOCKED');
    expect(args.data.status).toBe('SETTLED');
    expect(args.data.closedByInternalFundId).toBe('fund1');
    expect(args.data.closedAt).toBeInstanceOf(Date);
  });

  it('markSettledNettedZero settles netted-zero outstandings', async () => {
    await service.markSettledNettedZero('batch1', 'asset1');

    const args = prisma.outstanding.updateMany.mock.calls[0][0];
    expect(args.where.settlementBatchId).toBe('batch1');
    expect(args.where.assetId).toBe('asset1');
    expect(args.where.settledByTransferId).toBeNull();
    expect(args.where.status).toBe('LOCKED');
    expect(args.data.status).toBe('SETTLED');
    expect(args.data.closedAt).toBeInstanceOf(Date);
  });

  describe('findOpenFiatBySwap', () => {
    it('returns OPEN, FIAT, unbatched outstandings for a swap', async () => {
      const rows = [{ id: 'o1', direction: 'IN', amount: '5', assetId: 'a-aed', ownerId: 'c1' }];
      const prisma = { outstanding: { findMany: jest.fn().mockResolvedValue(rows) } };
      const audit = { recordSystem: jest.fn() };
      const batchService = { recomputeBatch: jest.fn().mockResolvedValue({} as any) };
      const svc = new OutstandingConsumerService(prisma as any, batchService as any, audit as any);

      const result = await svc.findOpenFiatBySwap('swap-1');

      expect(prisma.outstanding.findMany).toHaveBeenCalledWith({
        where: {
          swapTransactionId: 'swap-1',
          status: 'OPEN',
          settlementBatchId: null,
          asset: { type: 'FIAT' },
        },
        select: expect.any(Object),
      });
      expect(result).toBe(rows);
    });
  });

  describe('OutstandingConsumerService audit (DT-T4)', () => {
    it('lockToTransfer: emits OUTSTANDING.LOCKED for each outstanding, traceId=batch.traceId + metadata.originTraceId', async () => {
      const mockPrisma: any = {
        outstanding: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'o1', outstandingNo: 'OTS1', originTraceId: 'SWAP-T1' },
            { id: 'o2', outstandingNo: 'OTS2', originTraceId: 'SWAP-T2' },
          ]),
          updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
        settlementBatch: {
          findUnique: jest.fn().mockResolvedValue({ id: 'b1', traceId: 'BATCH-T1' }),
        },
      };
      const auditCalls: any[] = [];
      const mockAudit: any = {
        recordSystem: jest.fn((args: any) => {
          auditCalls.push(args);
          return Promise.resolve();
        }),
      };
      const mockBatchService: any = { recomputeBatch: jest.fn().mockResolvedValue({} as any) };
      const svc = new OutstandingConsumerService(mockPrisma, mockBatchService, mockAudit);

      await svc.lockToTransfer(['o1', 'o2'], 'b1', 't1', mockPrisma);

      expect(auditCalls).toHaveLength(2);
      auditCalls.forEach((a: any) => {
        expect(a.action).toBe('LOCKED');
        expect(a.entityType).toBe('OUTSTANDING');
        expect(a.traceId).toBe('BATCH-T1');
        expect(a.workflowType).toBe('SETTLEMENT');
      });
      expect(JSON.parse(auditCalls[0].metadata).originTraceId).toBe('SWAP-T1');
      expect(JSON.parse(auditCalls[1].metadata).originTraceId).toBe('SWAP-T2');
    });

    it('settle: emits OUTSTANDING.SETTLED for each, traceId=batch.traceId + metadata.originTraceId', async () => {
      const mockPrisma: any = {
        outstanding: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'o1',
              outstandingNo: 'OTS1',
              originTraceId: 'SWAP-T1',
              settlementBatchId: 'b1',
            },
          ]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        settlementBatch: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'b1', traceId: 'BATCH-T1' }]),
          findUnique: jest.fn().mockResolvedValue({ id: 'b1', traceId: 'BATCH-T1' }),
        },
      };
      const auditCalls: any[] = [];
      const mockAudit: any = {
        recordSystem: jest.fn((args: any) => {
          auditCalls.push(args);
          return Promise.resolve();
        }),
      };
      const mockBatchService: any = { recomputeBatch: jest.fn().mockResolvedValue({} as any) };
      const svc = new OutstandingConsumerService(mockPrisma, mockBatchService, mockAudit);

      await svc.settle('t1', 'fund1', mockPrisma);

      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0].action).toBe('SETTLED');
      expect(auditCalls[0].entityType).toBe('OUTSTANDING');
      expect(auditCalls[0].workflowType).toBe('SETTLEMENT');
      expect(auditCalls[0].traceId).toBe('BATCH-T1');
      expect(JSON.parse(auditCalls[0].metadata).originTraceId).toBe('SWAP-T1');
    });

    it('settle: calls batchService.recomputeBatch once per distinct settlementBatchId on the rows being settled', async () => {
      const recomputeBatch = jest.fn().mockResolvedValue({} as any);
      const batchService: any = { recomputeBatch };
      const rows = [
        { id: 'o1', outstandingNo: 'OTS1', originTraceId: 'OT1', settlementBatchId: 'b1' },
        { id: 'o2', outstandingNo: 'OTS2', originTraceId: 'OT2', settlementBatchId: 'b1' },
        { id: 'o3', outstandingNo: 'OTS3', originTraceId: 'OT3', settlementBatchId: 'b2' },
      ];
      const prisma: any = {
        outstanding: {
          findMany: jest.fn().mockResolvedValue(rows),
          updateMany: jest.fn().mockResolvedValue({ count: 3 }),
        },
        settlementBatch: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'b1', traceId: 'BT1' },
            { id: 'b2', traceId: 'BT2' },
          ]),
        },
      };
      const svc = new OutstandingConsumerService(prisma, batchService, { recordSystem: jest.fn() } as any);
      await svc.settle('transfer-1', 'fund-1', prisma);
      expect(recomputeBatch).toHaveBeenCalledTimes(2);
      expect(recomputeBatch).toHaveBeenCalledWith('b1', prisma);
      expect(recomputeBatch).toHaveBeenCalledWith('b2', prisma);
    });

    it('settle: no settled rows → does NOT call recomputeBatch', async () => {
      const recomputeBatch = jest.fn().mockResolvedValue({} as any);
      const batchService: any = { recomputeBatch };
      const prisma: any = {
        outstanding: {
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      const svc = new OutstandingConsumerService(prisma, batchService, { recordSystem: jest.fn() } as any);
      await svc.settle('transfer-x', 'fund-x', prisma);
      expect(recomputeBatch).not.toHaveBeenCalled();
    });

    it('markSettledNettedZero: emits SETTLED audit for netted-zero outstandings', async () => {
      const mockPrisma: any = {
        outstanding: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'o-nz', outstandingNo: 'OTS-NZ', originTraceId: 'SWAP-T9' },
          ]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        settlementBatch: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'b-nz', traceId: 'BATCH-T9' }),
        },
      };
      const auditCalls: any[] = [];
      const mockAudit: any = {
        recordSystem: jest.fn((args: any) => {
          auditCalls.push(args);
          return Promise.resolve();
        }),
      };
      const mockBatchService: any = { recomputeBatch: jest.fn().mockResolvedValue({} as any) };
      const svc = new OutstandingConsumerService(mockPrisma, mockBatchService, mockAudit);

      await svc.markSettledNettedZero('b-nz', 'asset1', mockPrisma);

      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0].action).toBe('SETTLED');
      expect(auditCalls[0].entityType).toBe('OUTSTANDING');
      expect(auditCalls[0].workflowType).toBe('SETTLEMENT');
      expect(auditCalls[0].traceId).toBe('BATCH-T9');
      expect(JSON.parse(auditCalls[0].metadata).originTraceId).toBe('SWAP-T9');
    });

    it('markSettledNettedZero: calls batchService.recomputeBatch(settlementBatchId, tx) when at least 1 row settled', async () => {
      const recomputeBatch = jest.fn().mockResolvedValue({} as any);
      const batchService: any = { recomputeBatch };
      const rows = [
        { id: 'o1', outstandingNo: 'OTS1', originTraceId: 'OT1' },
      ];
      const prisma: any = {
        outstanding: {
          findMany: jest.fn().mockResolvedValue(rows),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        settlementBatch: {
          findUnique: jest.fn().mockResolvedValue({ traceId: 'BT1' }),
        },
      };
      const svc = new OutstandingConsumerService(prisma, batchService, { recordSystem: jest.fn() } as any);
      await svc.markSettledNettedZero('b1', 'usdt-asset-id', prisma);
      expect(recomputeBatch).toHaveBeenCalledTimes(1);
      expect(recomputeBatch).toHaveBeenCalledWith('b1', prisma);
    });

    it('markSettledNettedZero: no rows → does NOT call recomputeBatch', async () => {
      const recomputeBatch = jest.fn().mockResolvedValue({} as any);
      const batchService: any = { recomputeBatch };
      const prisma: any = {
        outstanding: {
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      const svc = new OutstandingConsumerService(prisma, batchService, { recordSystem: jest.fn() } as any);
      await svc.markSettledNettedZero('b1', 'usdt-asset-id', prisma);
      expect(recomputeBatch).not.toHaveBeenCalled();
    });
  });
});
