import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
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
      update: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    withdrawalFeeLevelChangeRequest: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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

    it('rejects requiredTags with more than one entry', async () => {
      await expect(
        service.createLevel({
          levelCode: 'WFL-MULTI-TAG',
          name: 'Multi tag level',
          assetId: 'asset-1',
          isDefault: false,
          tiersJson: validTiersJson,
          createdByUserId: 'admin-1',
          requiredTags: ['VIP', 'WHITELIST_PILOT'],
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

  describe('波一 · 状态集与退役', () => {
    it('declineLevel：PENDING_APPROVAL → REJECTED，行不删', async () => {
      prisma.withdrawalFeeLevel.findUnique.mockResolvedValue({ levelCode: 'L1', status: 'PENDING_APPROVAL' });
      await service.declineLevel('L1');
      expect(prisma.withdrawalFeeLevel.update).toHaveBeenCalledWith({ where: { levelCode: 'L1' }, data: { status: 'REJECTED', approvalCaseId: null, approvalCaseNo: null } });
      expect(prisma.withdrawalFeeLevel.delete).not.toHaveBeenCalled();
    });
    it('retireLevel：ACTIVE → RETIRED；PENDING 不能退 → 409', async () => {
      prisma.withdrawalFeeLevel.findUnique.mockResolvedValue({ levelCode: 'L1', status: 'ACTIVE' });
      await service.retireLevel('L1');
      expect(prisma.withdrawalFeeLevel.update).toHaveBeenCalledWith({ where: { levelCode: 'L1' }, data: { status: 'RETIRED', approvalCaseId: null, approvalCaseNo: null } });
      prisma.withdrawalFeeLevel.findUnique.mockResolvedValue({ levelCode: 'L2', status: 'PENDING_APPROVAL' });
      await expect(service.retireLevel('L2')).rejects.toBeInstanceOf(ConflictException);
    });
    it('activateLevel：已 ACTIVE 的等级不能再次 APPROVE → 409（迁移表 ACTIVE 无 APPROVE 边）', async () => {
      prisma.withdrawalFeeLevel.findUnique.mockResolvedValue({ levelCode: 'L1', status: 'ACTIVE' });
      await expect(service.activateLevel('L1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.withdrawalFeeLevel.update).not.toHaveBeenCalled();
    });
    it('assertNotLastActiveDefault：该资产最后一个 ACTIVE 默认档不可退', async () => {
      prisma.withdrawalFeeLevel.count.mockResolvedValue(0);
      await expect(service.assertNotLastActiveDefault({ id: 'x', levelCode: 'STD', isDefault: true, assetId: 'a' } as any))
        .rejects.toMatchObject({ response: { code: 'LAST_ACTIVE_DEFAULT' } });
      expect(prisma.withdrawalFeeLevel.count).toHaveBeenCalledWith({ where: { assetId: 'a', isDefault: true, status: 'ACTIVE', id: { not: 'x' } } });
    });
    it('变更单号走 WFC 前缀，不再 WFLC-### 顺序号', async () => {
      prisma.withdrawalFeeLevelChangeRequest.findFirst.mockResolvedValue(null);
      prisma.withdrawalFeeLevel.findUnique.mockResolvedValue({ id: 'l1', tiersJson: validTiersJson, configHash: 'h' });
      prisma.withdrawalFeeLevelChangeRequest.create.mockImplementation(async ({ data }: any) => data);
      const r: any = await service.createChangeRequest({ levelId: 'l1', levelCode: 'L1', proposedTiersJson: validTiersJson, changeReason: 'x', requestedByUserId: 'u' });
      expect(r.requestNo).toMatch(/^WFC\d{12}$/);
    });
    it('expireChangeRequest：PENDING_APPROVAL → EXPIRED', async () => {
      prisma.withdrawalFeeLevelChangeRequest.findUnique.mockResolvedValue({ requestNo: 'R1', status: 'PENDING_APPROVAL' });
      await service.expireChangeRequest('R1');
      expect(prisma.withdrawalFeeLevelChangeRequest.update).toHaveBeenCalledWith({ where: { requestNo: 'R1' }, data: { status: 'EXPIRED' } });
    });
  });
});
