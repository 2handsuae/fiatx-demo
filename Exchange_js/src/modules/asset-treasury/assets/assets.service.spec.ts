import { Test, TestingModule } from '@nestjs/testing';
import { AssetsService } from './assets.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

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
