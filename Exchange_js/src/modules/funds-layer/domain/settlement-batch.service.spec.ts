import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SettlementBatchService } from './settlement-batch.service';

describe('SettlementBatchService', () => {
  let service: SettlementBatchService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      settlementBatch: {
        create: jest.fn((args: any) => ({ id: 'osb-new', ...args.data })),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
      },
      internalTransaction: {
        findMany: jest.fn(),
      },
      outstanding: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementBatchService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get<SettlementBatchService>(SettlementBatchService);
    jest.clearAllMocks();
  });

  it('createBatch sets batchNo (OSB prefix), settlementType=EOD, status=CREATED', async () => {
    const cutoffAt = new Date('2026-06-03T00:00:00.000Z');
    const created = await service.createBatch({ cutoffAt, requestId: 'req-1' });

    expect(created.batchNo).toMatch(/^OSB/);
    expect(created.settlementType).toBe('EOD');
    expect(created.status).toBe('CREATED');
    expect(created.cutoffAt).toBe(cutoffAt);
    expect(created.requestId).toBe('req-1');
    expect(prisma.settlementBatch.create).toHaveBeenCalledTimes(1);
  });

  it('createBatch honors an explicit settlementType (FEE_COLLECT)', async () => {
    const cutoffAt = new Date('2026-06-03T00:00:00.000Z');
    const created = await service.createBatch({
      cutoffAt,
      settlementType: 'FEE_COLLECT',
    });

    expect(created.settlementType).toBe('FEE_COLLECT');
  });

  describe('resolveCryptoDirection', () => {
    it('net > 0 → INTERNAL_IN / F_LIQ → C_MAIN / amount = net', () => {
      const net = new Prisma.Decimal(60);
      const result = service.resolveCryptoDirection(net);
      expect(result).toEqual({
        path: 'INTERNAL_IN',
        fromRole: 'F_LIQ',
        toRole: 'C_MAIN',
        amount: net,
      });
    });

    it('net < 0 → INTERNAL_OUT / C_MAIN → F_LIQ / amount = |net|', () => {
      const net = new Prisma.Decimal(-40);
      const result = service.resolveCryptoDirection(net);
      expect(result!.path).toBe('INTERNAL_OUT');
      expect(result!.fromRole).toBe('C_MAIN');
      expect(result!.toRole).toBe('F_LIQ');
      expect(result!.amount.toString()).toBe('40');
    });

    it('net = 0 → null', () => {
      expect(service.resolveCryptoDirection(new Prisma.Decimal(0))).toBeNull();
    });
  });

  it('recomputeBatch SUCCESS when all transfers SUCCESS and all outstandings SETTLED', async () => {
    prisma.internalTransaction.findMany.mockResolvedValue([
      { status: 'SUCCESS', assetId: 'a1' },
    ]);
    prisma.outstanding.findMany.mockResolvedValue([
      { status: 'SETTLED', assetId: 'a1', settledByTransferId: 't1' },
    ]);

    await service.recomputeBatch('batch1');

    const data = prisma.settlementBatch.update.mock.calls[0][0].data;
    expect(data.totalAssetCount).toBe(1);
    expect(data.settledAssetCount).toBe(1);
    expect(data.totalOutstandingCount).toBe(1);
    expect(data.settledOutstandingCount).toBe(1);
    expect(data.status).toBe('SUCCESS');
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('recomputeBatch PROCESSING when a transfer not yet SUCCESS', async () => {
    prisma.internalTransaction.findMany.mockResolvedValue([
      { status: 'INTERNAL_FUNDS_PENDING', assetId: 'a1' },
    ]);
    prisma.outstanding.findMany.mockResolvedValue([
      { status: 'LOCKED', assetId: 'a1', settledByTransferId: 't1' },
    ]);

    await service.recomputeBatch('batch1');

    const data = prisma.settlementBatch.update.mock.calls[0][0].data;
    expect(data.totalAssetCount).toBe(1);
    expect(data.settledAssetCount).toBe(0);
    expect(data.totalOutstandingCount).toBe(1);
    expect(data.settledOutstandingCount).toBe(0);
    expect(data.status).toBe('PROCESSING');
    expect(data.completedAt).toBeNull();
  });

  it('recomputeBatch SUCCESS for net=0 only batch (no transfers, one SETTLED outstanding with no transfer)', async () => {
    prisma.internalTransaction.findMany.mockResolvedValue([]);
    prisma.outstanding.findMany.mockResolvedValue([
      { status: 'SETTLED', assetId: 'a1', settledByTransferId: null },
    ]);

    await service.recomputeBatch('batch1');

    const data = prisma.settlementBatch.update.mock.calls[0][0].data;
    expect(data.totalAssetCount).toBe(1);
    expect(data.settledAssetCount).toBe(1);
    expect(data.totalOutstandingCount).toBe(1);
    expect(data.settledOutstandingCount).toBe(1);
    expect(data.status).toBe('SUCCESS');
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('findOneByNoForAdmin looks up by batchNo (business key) including transfers', async () => {
    prisma.settlementBatch.findUnique.mockResolvedValue({
      id: 'osb-1',
      batchNo: 'OSB2606030001',
      transfers: [],
    });

    const found = await service.findOneByNoForAdmin('OSB2606030001');

    expect(prisma.settlementBatch.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { batchNo: 'OSB2606030001' } }),
    );
    expect(found.batchNo).toBe('OSB2606030001');
  });
});
