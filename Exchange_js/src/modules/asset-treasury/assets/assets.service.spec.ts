import { Test, TestingModule } from '@nestjs/testing';
import { AssetsService } from './assets.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { assertAssetTransition, AssetAction } from './constants/asset-transitions.constant';

const mockPrismaService = {
  asset: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

describe('资产状态迁移表（Task 11 · 法二）', () => {
  it('非法跃迁：ACTIVE 资产不能再次 activate', () => {
    expect(() => assertAssetTransition('ACTIVE', AssetAction.ACTIVATE)).toThrow(/Invalid transition/);
  });
  it('合法边：PROVISIONING--ACTIVATE-->ACTIVE；SUSPENDED 只能 REACTIVATE', () => {
    expect(assertAssetTransition('PROVISIONING', AssetAction.ACTIVATE)).toBe('ACTIVE');
    expect(assertAssetTransition('SUSPENDED', AssetAction.REACTIVATE)).toBe('ACTIVE');
    expect(() => assertAssetTransition('SUSPENDED', AssetAction.ACTIVATE)).toThrow(/Invalid transition/);
  });
});

describe('AssetsService', () => {
  let service: AssetsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AssetsService>(AssetsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOne', () => {
    it('should return an asset if found', async () => {
      mockPrismaService.asset.findUnique.mockResolvedValue({
        id: '1',
        code: 'BTC',
      });
      const result = await service.findOne('1');
      expect(result).toEqual({ id: '1', code: 'BTC' });
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrismaService.asset.findUnique.mockResolvedValue(null);
      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('activateAsset', () => {
    it('绑定证明：DB 读到 status=ACTIVE 时抛 Invalid transition（from 来自读值，非字面量）', async () => {
      mockPrismaService.asset.findFirst.mockResolvedValue({
        id: 'a1',
        assetNo: 'AS1',
        status: 'ACTIVE',
      });

      await expect(service.activateAsset('AS1')).rejects.toThrow(/Invalid transition/);
      expect(mockPrismaService.asset.update).not.toHaveBeenCalled();
    });
  });
});
