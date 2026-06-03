import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DepositAggregationSourceService } from './deposit-aggregation-source.service';

describe('DepositAggregationSourceService', () => {
  let service: DepositAggregationSourceService;
  let prisma: PrismaService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepositAggregationSourceService,
        {
          provide: PrismaService,
          useValue: {
            depositTransaction: {
              findMany: jest.fn(),
              updateMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<DepositAggregationSourceService>(
      DepositAggregationSourceService,
    );
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('findAggregationCandidates', () => {
    it('groups by toWalletId, sums amounts, picks earliest as anchor', async () => {
      ((prisma as any).depositTransaction.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'D1',
          toWalletId: 'W1',
          assetId: 'A1',
          ownerId: 'O1',
          ownerType: 'CUSTOMER',
          amount: new Prisma.Decimal('60'),
          createdAt: new Date('2024-01-01T00:00:00Z'),
        },
        {
          id: 'D2',
          toWalletId: 'W1',
          assetId: 'A1',
          ownerId: 'O1',
          ownerType: 'CUSTOMER',
          amount: new Prisma.Decimal('40'),
          createdAt: new Date('2024-01-02T00:00:00Z'),
        },
        {
          id: 'D3',
          toWalletId: 'W2',
          assetId: 'A2',
          ownerId: 'O2',
          ownerType: 'CUSTOMER',
          amount: new Prisma.Decimal('30'),
          createdAt: new Date('2024-01-03T00:00:00Z'),
        },
      ]);

      const result = await service.findAggregationCandidates();

      // Only completed, un-aggregated, crypto deposit-wallets
      expect((prisma as any).depositTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'SUCCESS',
            aggregatedAt: null,
            toWalletId: { not: null },
            asset: { type: 'CRYPTO' },
          }),
          orderBy: { createdAt: 'asc' },
        }),
      );

      expect(result).toHaveLength(2);

      const w1 = result.find((g) => g.toWalletId === 'W1')!;
      expect(w1.totalAmount.toString()).toBe('100');
      expect(w1.depositIds).toEqual(['D1', 'D2']);
      expect(w1.anchorDepositId).toBe('D1');
      expect(w1.assetId).toBe('A1');
      expect(w1.ownerId).toBe('O1');
      expect(w1.ownerType).toBe('CUSTOMER');

      const w2 = result.find((g) => g.toWalletId === 'W2')!;
      expect(w2.totalAmount.toString()).toBe('30');
      expect(w2.depositIds).toEqual(['D3']);
      expect(w2.anchorDepositId).toBe('D3');
    });
  });

  describe('markAggregated', () => {
    it('calls updateMany with aggregatedAt:null guard and sets transfer fields', async () => {
      ((prisma as any).depositTransaction.updateMany as jest.Mock).mockResolvedValue({
        count: 2,
      });

      const result = await service.markAggregated(['D1', 'D2'], 'TR-1');

      expect((prisma as any).depositTransaction.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['D1', 'D2'] },
          aggregatedAt: null,
        },
        data: expect.objectContaining({
          aggregatedAt: expect.any(Date),
          aggregatedTransferId: 'TR-1',
        }),
      });
      expect(result.count).toBe(2);
    });

    it('uses provided transaction client when tx passed', async () => {
      const tx = {
        depositTransaction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };

      const result = await service.markAggregated(['D1'], 'TR-2', tx as any);

      expect(tx.depositTransaction.updateMany).toHaveBeenCalled();
      expect((prisma as any).depositTransaction.updateMany).not.toHaveBeenCalled();
      expect(result.count).toBe(1);
    });
  });
});
