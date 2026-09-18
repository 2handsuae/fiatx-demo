import { Test, TestingModule } from '@nestjs/testing';
import { AssetsService } from './assets.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { assertAssetTransition, AssetAction, ASSET_TRANSITIONS } from './constants/asset-transitions.constant';

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

describe('资产状态迁移表（波一 · 两边）', () => {
  it('ACTIVE --SUSPEND--> SUSPENDED；SUSPENDED --REACTIVATE--> ACTIVE', () => {
    expect(assertAssetTransition('ACTIVE', AssetAction.SUSPEND)).toBe('SUSPENDED');
    expect(assertAssetTransition('SUSPENDED', AssetAction.REACTIVATE)).toBe('ACTIVE');
  });
  it('非法跃迁：ACTIVE 不能 REACTIVATE、SUSPENDED 不能 SUSPEND', () => {
    expect(() => assertAssetTransition('ACTIVE', AssetAction.REACTIVATE)).toThrow(/Invalid transition/);
    expect(() => assertAssetTransition('SUSPENDED', AssetAction.SUSPEND)).toThrow(/Invalid transition/);
  });
  it('PROVISIONING 与 ACTIVATE 已退役：表里没有这两个键', () => {
    expect((ASSET_TRANSITIONS as any).PROVISIONING).toBeUndefined();
    expect((AssetAction as any).ACTIVATE).toBeUndefined();
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
});
