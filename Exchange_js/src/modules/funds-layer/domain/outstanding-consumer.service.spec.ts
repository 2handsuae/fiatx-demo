import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { OutstandingConsumerService } from './outstanding-consumer.service';

describe('OutstandingConsumerService', () => {
  let service: OutstandingConsumerService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      outstanding: {
        findMany: jest.fn(),
        updateMany: jest.fn((args: any) => ({ count: 1 })),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        OutstandingConsumerService,
        { provide: PrismaService, useValue: prisma },
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

    const groups = await service.findOpenCryptoByAsset();

    // query guards
    const where = prisma.outstanding.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('OPEN');
    expect(where.asset).toEqual({ type: 'CRYPTO' });
    expect(where.settlementBatchId).toBeNull();

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
});
