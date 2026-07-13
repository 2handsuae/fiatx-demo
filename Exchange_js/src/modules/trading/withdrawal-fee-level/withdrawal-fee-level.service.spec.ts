import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { WithdrawalFeeLevelService } from './withdrawal-fee-level.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

describe('WithdrawalFeeLevelService', () => {
  let service: WithdrawalFeeLevelService;
  let prisma: any;

  const prismaMock = {
    asset: {
      findUnique: jest.fn(),
    },
    withdrawalFeeLevel: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  const validTiersJson = JSON.stringify({
    tiers: [
      {
        id: 't1',
        name: 'T1',
        feeItems: [{ itemCode: 'WITHDRAW_SERVICE_FEE', amount: '1' }],
      },
    ],
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WithdrawalFeeLevelService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get(WithdrawalFeeLevelService);
    prisma = module.get(PrismaService);

    prismaMock.asset.findUnique.mockResolvedValue({ id: 'asset-1', status: 'ACTIVE' });
    prismaMock.withdrawalFeeLevel.findUnique.mockResolvedValue(null);
  });

  describe('createLevel — audience fields', () => {
    it('persists requiredTagsJson and the validity window when requiredTags is a registered tag', async () => {
      prismaMock.withdrawalFeeLevel.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'lvl-1', ...args.data }),
      );

      await service.createLevel({
        levelCode: 'WFL-VIP',
        name: 'VIP level',
        assetId: 'asset-1',
        isDefault: false,
        tiersJson: validTiersJson,
        createdByUserId: 'admin-1',
        requiredTags: ['VIP'],
        validFrom: '2026-07-01T00:00:00.000Z',
        validTo: '2026-07-31T00:00:00.000Z',
      });

      expect(prismaMock.withdrawalFeeLevel.create).toHaveBeenCalledTimes(1);
      const data = prismaMock.withdrawalFeeLevel.create.mock.calls[0][0].data;
      expect(data.requiredTagsJson).toBe('["VIP"]');
      expect(data.validFrom).toEqual(new Date('2026-07-01T00:00:00.000Z'));
      expect(data.validTo).toEqual(new Date('2026-07-31T00:00:00.000Z'));
    });

    it('defaults requiredTagsJson to "[]" and validFrom/validTo to null when omitted', async () => {
      prismaMock.withdrawalFeeLevel.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'lvl-2', ...args.data }),
      );

      await service.createLevel({
        levelCode: 'WFL-DEFAULT',
        name: 'Default level',
        assetId: 'asset-1',
        isDefault: true,
        tiersJson: validTiersJson,
        createdByUserId: 'admin-1',
      });

      const data = prismaMock.withdrawalFeeLevel.create.mock.calls[0][0].data;
      expect(data.requiredTagsJson).toBe('[]');
      expect(data.validFrom).toBeNull();
      expect(data.validTo).toBeNull();
    });

    it('rejects a requiredTags entry that is not a registered tag', async () => {
      await expect(
        service.createLevel({
          levelCode: 'WFL-BAD',
          name: 'Bad level',
          assetId: 'asset-1',
          isDefault: false,
          tiersJson: validTiersJson,
          createdByUserId: 'admin-1',
          requiredTags: ['TYPO_NOT_REGISTERED'],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.withdrawalFeeLevel.create).not.toHaveBeenCalled();
    });

    it('rejects isDefault=true combined with a non-empty requiredTags', async () => {
      await expect(
        service.createLevel({
          levelCode: 'WFL-DEFAULT-TAGGED',
          name: 'Default level with tags',
          assetId: 'asset-1',
          isDefault: true,
          tiersJson: validTiersJson,
          createdByUserId: 'admin-1',
          requiredTags: ['VIP'],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.withdrawalFeeLevel.create).not.toHaveBeenCalled();
    });

    it('rejects when validFrom is after validTo', async () => {
      await expect(
        service.createLevel({
          levelCode: 'WFL-WINDOW',
          name: 'Window level',
          assetId: 'asset-1',
          isDefault: false,
          tiersJson: validTiersJson,
          createdByUserId: 'admin-1',
          validFrom: '2026-08-01T00:00:00.000Z',
          validTo: '2026-07-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.withdrawalFeeLevel.create).not.toHaveBeenCalled();
    });
  });
});
