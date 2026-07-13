import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SwapFeeLevelService } from './swap-fee-level.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

describe('SwapFeeLevelService', () => {
  let service: SwapFeeLevelService;
  let prisma: any;

  const prismaMock = {
    asset: {
      findUnique: jest.fn(),
    },
    swapFeeLevel: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  const validTiersJson = JSON.stringify({
    tiers: [{ id: 't1', name: 'T1', rateMarkupBps: 10, feeItems: [] }],
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SwapFeeLevelService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get(SwapFeeLevelService);
    prisma = module.get(PrismaService);

    prismaMock.asset.findUnique.mockImplementation((args: any) =>
      Promise.resolve({ id: args.where.id, status: 'ACTIVE' }),
    );
    prismaMock.swapFeeLevel.findUnique.mockResolvedValue(null);
  });

  describe('createLevel — audience fields', () => {
    it('persists requiredTagsJson and the validity window when requiredTags is a registered tag', async () => {
      prismaMock.swapFeeLevel.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'lvl-1', ...args.data }),
      );

      await service.createLevel({
        levelCode: 'SFL-VIP',
        name: 'VIP level',
        fromAssetId: 'asset-from',
        toAssetId: 'asset-to',
        isDefault: false,
        tiersJson: validTiersJson,
        createdByUserId: 'admin-1',
        requiredTags: ['VIP'],
        validFrom: '2026-07-01T00:00:00.000Z',
        validTo: '2026-07-31T00:00:00.000Z',
      });

      expect(prismaMock.swapFeeLevel.create).toHaveBeenCalledTimes(1);
      const data = prismaMock.swapFeeLevel.create.mock.calls[0][0].data;
      expect(data.requiredTagsJson).toBe('["VIP"]');
      expect(data.validFrom).toEqual(new Date('2026-07-01T00:00:00.000Z'));
      expect(data.validTo).toEqual(new Date('2026-07-31T00:00:00.000Z'));
    });

    it('defaults requiredTagsJson to "[]" and validFrom/validTo to null when omitted', async () => {
      prismaMock.swapFeeLevel.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'lvl-2', ...args.data }),
      );

      await service.createLevel({
        levelCode: 'SFL-DEFAULT',
        name: 'Default level',
        fromAssetId: 'asset-from',
        toAssetId: 'asset-to',
        isDefault: true,
        tiersJson: validTiersJson,
        createdByUserId: 'admin-1',
      });

      const data = prismaMock.swapFeeLevel.create.mock.calls[0][0].data;
      expect(data.requiredTagsJson).toBe('[]');
      expect(data.validFrom).toBeNull();
      expect(data.validTo).toBeNull();
    });

    it('rejects a requiredTags entry that is not a registered tag', async () => {
      await expect(
        service.createLevel({
          levelCode: 'SFL-BAD',
          name: 'Bad level',
          fromAssetId: 'asset-from',
          toAssetId: 'asset-to',
          isDefault: false,
          tiersJson: validTiersJson,
          createdByUserId: 'admin-1',
          requiredTags: ['TYPO_NOT_REGISTERED'],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.swapFeeLevel.create).not.toHaveBeenCalled();
    });

    it('rejects when validFrom is after validTo', async () => {
      await expect(
        service.createLevel({
          levelCode: 'SFL-WINDOW',
          name: 'Window level',
          fromAssetId: 'asset-from',
          toAssetId: 'asset-to',
          isDefault: false,
          tiersJson: validTiersJson,
          createdByUserId: 'admin-1',
          validFrom: '2026-08-01T00:00:00.000Z',
          validTo: '2026-07-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.swapFeeLevel.create).not.toHaveBeenCalled();
    });
  });
});
