import { Test, TestingModule } from '@nestjs/testing';
import { AssetsService } from './assets.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AssetStatus, AssetType } from './dto/asset.dto';
import { BadRequestException, NotFoundException } from '@nestjs/common';

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

describe('AssetsService', () => {
  let service: AssetsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AssetsService>(AssetsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new asset successfully', async () => {
      const dto = {
        type: AssetType.CRYPTO,
        code: 'USDT',
        network: 'TRC20',
        decimals: 6,
        description: 'Tether on Tron',
      };

      mockPrismaService.asset.findFirst.mockResolvedValue(null);
      mockPrismaService.asset.create.mockImplementation((args) =>
        Promise.resolve({ id: 'uuid', ...args.data }),
      );

      const result = await service.create(dto);

      expect(result.code).toBe(dto.code);
      expect(result.status).toBe(AssetStatus.ACTIVE);
      expect(mockPrismaService.asset.create).toHaveBeenCalled();
    });

    it('should throw error if asset combination exists', async () => {
      mockPrismaService.asset.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create({
          type: AssetType.CRYPTO,
          code: 'USDT',
          network: 'TRC20',
          decimals: 6,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw error if CRYPTO has no network', async () => {
      mockPrismaService.asset.findFirst.mockResolvedValue(null);
      await expect(
        service.create({
          type: AssetType.CRYPTO,
          code: 'BTC',
          decimals: 8,
          // network is missing
        }),
      ).rejects.toThrow(BadRequestException);
    });
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

  describe('changeStatus', () => {
    it('should update status', async () => {
      mockPrismaService.asset.update.mockResolvedValue({
        id: '1',
        status: AssetStatus.DISABLED,
      });
      const result = await service.changeStatus('1', AssetStatus.DISABLED);
      expect(result.status).toBe(AssetStatus.DISABLED);
      expect(mockPrismaService.asset.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: AssetStatus.DISABLED },
      });
    });
  });
});
