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
      settlementBatchItem: {
        create: jest.fn((args: any) => ({ id: 'item-new', ...args.data })),
        findMany: jest.fn(),
        update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
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

  it('createItem with netAmount=0 → status NETTED', async () => {
    const item = await service.createItem({
      settlementBatchId: 'osb-1',
      assetId: 'asset-1',
      assetCode: 'BTC',
      inAmount: new Prisma.Decimal(100),
      outAmount: new Prisma.Decimal(100),
      netAmount: new Prisma.Decimal(0),
      direction: null,
      outstandingCount: 4,
    });

    expect(item.status).toBe('NETTED');
    expect(prisma.settlementBatchItem.create).toHaveBeenCalledTimes(1);
  });

  it('createItem with non-zero netAmount → status PROCESSING', async () => {
    const item = await service.createItem({
      settlementBatchId: 'osb-1',
      assetId: 'asset-1',
      assetCode: 'BTC',
      inAmount: new Prisma.Decimal(100),
      outAmount: new Prisma.Decimal(40),
      netAmount: new Prisma.Decimal(60),
      direction: 'INTERNAL_IN',
      outstandingCount: 3,
    });

    expect(item.status).toBe('PROCESSING');
  });

  it('linkItemTransfer sets internalTransactionId on the item', async () => {
    await service.linkItemTransfer('item-1', 'itx-1');
    expect(prisma.settlementBatchItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { internalTransactionId: 'itx-1' },
    });
  });

  it('closeItem sets status=CLOSED, settledOutstandingCount, closedAt', async () => {
    const updated = await service.closeItem('item-1', 3);

    const call = prisma.settlementBatchItem.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'item-1' });
    expect(call.data.status).toBe('CLOSED');
    expect(call.data.settledOutstandingCount).toBe(3);
    expect(call.data.closedAt).toBeInstanceOf(Date);
    expect(updated.status).toBe('CLOSED');
  });

  it('recomputeBatch → SUCCESS when all items are terminal (CLOSED/NETTED)', async () => {
    prisma.settlementBatchItem.findMany.mockResolvedValue([
      {
        status: 'NETTED',
        outstandingCount: 2,
        settledOutstandingCount: 2,
      },
      {
        status: 'CLOSED',
        outstandingCount: 3,
        settledOutstandingCount: 3,
      },
    ]);

    const updated = await service.recomputeBatch('osb-1');

    const data = prisma.settlementBatch.update.mock.calls[0][0].data;
    expect(data.status).toBe('SUCCESS');
    expect(data.totalAssetCount).toBe(2);
    expect(data.settledAssetCount).toBe(2);
    expect(data.totalOutstandingCount).toBe(5);
    expect(data.settledOutstandingCount).toBe(5);
    expect(data.completedAt).toBeInstanceOf(Date);
    expect(updated.status).toBe('SUCCESS');
  });

  it('recomputeBatch → PROCESSING (no completedAt) when an item is still open', async () => {
    prisma.settlementBatchItem.findMany.mockResolvedValue([
      { status: 'NETTED', outstandingCount: 2, settledOutstandingCount: 2 },
      { status: 'PROCESSING', outstandingCount: 3, settledOutstandingCount: 0 },
    ]);

    await service.recomputeBatch('osb-1');

    const data = prisma.settlementBatch.update.mock.calls[0][0].data;
    expect(data.status).toBe('PROCESSING');
    expect(data.settledAssetCount).toBe(1);
    expect(data.completedAt).toBeNull();
  });

  it('findOneByNoForAdmin looks up by batchNo (business key) including items', async () => {
    prisma.settlementBatch.findUnique.mockResolvedValue({
      id: 'osb-1',
      batchNo: 'OSB2606030001',
      items: [],
    });

    const found = await service.findOneByNoForAdmin('OSB2606030001');

    expect(prisma.settlementBatch.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { batchNo: 'OSB2606030001' } }),
    );
    expect(found.batchNo).toBe('OSB2606030001');
  });
});
