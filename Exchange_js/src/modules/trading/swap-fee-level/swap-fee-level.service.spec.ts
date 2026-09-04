import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
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
      update: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    swapFeeLevelChangeRequest: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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

    it('rejects isDefault=true combined with a non-empty requiredTags', async () => {
      await expect(
        service.createLevel({
          levelCode: 'SFL-DEFAULT-TAGGED',
          name: 'Default level with tags',
          fromAssetId: 'asset-from',
          toAssetId: 'asset-to',
          isDefault: true,
          tiersJson: validTiersJson,
          createdByUserId: 'admin-1',
          requiredTags: ['VIP'],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.swapFeeLevel.create).not.toHaveBeenCalled();
    });

    it('rejects requiredTags with more than one entry', async () => {
      await expect(
        service.createLevel({
          levelCode: 'SFL-MULTI-TAG',
          name: 'Multi tag level',
          fromAssetId: 'asset-from',
          toAssetId: 'asset-to',
          isDefault: false,
          tiersJson: validTiersJson,
          createdByUserId: 'admin-1',
          requiredTags: ['VIP', 'WHITELIST_PILOT'],
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

  describe('波一 · 状态集与退役', () => {
    it('declineLevel：PENDING_APPROVAL → REJECTED，行不删', async () => {
      prisma.swapFeeLevel.findUnique.mockResolvedValue({ levelCode: 'L1', status: 'PENDING_APPROVAL' });
      await service.declineLevel('L1');
      expect(prisma.swapFeeLevel.update).toHaveBeenCalledWith({ where: { levelCode: 'L1' }, data: { status: 'REJECTED', approvalCaseId: null, approvalCaseNo: null } });
      expect(prisma.swapFeeLevel.delete).not.toHaveBeenCalled();
    });
    it('retireLevel：ACTIVE → RETIRED；PENDING 不能退 → 409', async () => {
      prisma.swapFeeLevel.findUnique.mockResolvedValue({ levelCode: 'L1', status: 'ACTIVE' });
      await service.retireLevel('L1');
      expect(prisma.swapFeeLevel.update).toHaveBeenCalledWith({ where: { levelCode: 'L1' }, data: { status: 'RETIRED', approvalCaseId: null, approvalCaseNo: null } });
      prisma.swapFeeLevel.findUnique.mockResolvedValue({ levelCode: 'L2', status: 'PENDING_APPROVAL' });
      await expect(service.retireLevel('L2')).rejects.toBeInstanceOf(ConflictException);
    });
    it('assertNotLastActiveDefault：该币对最后一个 ACTIVE 默认档不可退', async () => {
      prisma.swapFeeLevel.count.mockResolvedValue(0);
      await expect(service.assertNotLastActiveDefault({ id: 'x', levelCode: 'STD', isDefault: true, fromAssetId: 'a', toAssetId: 'b' } as any))
        .rejects.toMatchObject({ response: { code: 'LAST_ACTIVE_DEFAULT' } });
      expect(prisma.swapFeeLevel.count).toHaveBeenCalledWith({ where: { fromAssetId: 'a', toAssetId: 'b', isDefault: true, status: 'ACTIVE', id: { not: 'x' } } });
    });
    it('变更单号走 SFC 前缀，不再 SFLC-### 顺序号', async () => {
      prisma.swapFeeLevelChangeRequest.findFirst.mockResolvedValue(null);
      prisma.swapFeeLevel.findUnique.mockResolvedValue({ id: 'l1', tiersJson: '{"tiers":[{"id":"T","name":"T","rateMarkupBps":1}]}', configHash: 'h' });
      prisma.swapFeeLevelChangeRequest.create.mockImplementation(async ({ data }: any) => data);
      const r: any = await service.createChangeRequest({ levelId: 'l1', levelCode: 'L1', proposedTiersJson: '{"tiers":[{"id":"T","name":"T","rateMarkupBps":2}]}', changeReason: 'x', requestedByUserId: 'u' });
      expect(r.requestNo).toMatch(/^SFC\d{12}$/);
    });
    it('expireChangeRequest：PENDING_APPROVAL → EXPIRED', async () => {
      prisma.swapFeeLevelChangeRequest.findUnique.mockResolvedValue({ requestNo: 'R1', status: 'PENDING_APPROVAL' });
      await service.expireChangeRequest('R1');
      expect(prisma.swapFeeLevelChangeRequest.update).toHaveBeenCalledWith({ where: { requestNo: 'R1' }, data: { status: 'EXPIRED' } });
    });
  });
});
