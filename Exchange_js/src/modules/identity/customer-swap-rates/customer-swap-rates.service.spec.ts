import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CustomerSwapRateStatus,
  CreateCustomerSwapRateDto,
} from './dto/customer-swap-rate.dto';
import { CustomerSwapRatesService } from './customer-swap-rates.service';

const mockPrismaService = {
  customerSwapRateConfiguration: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  asset: {
    findUnique: jest.fn(),
  },
};

describe('CustomerSwapRatesService', () => {
  let service: CustomerSwapRatesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerSwapRatesService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<CustomerSwapRatesService>(CustomerSwapRatesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create config successfully', async () => {
      const dto: CreateCustomerSwapRateDto = {
        fromAssetId: 'asset-1',
        toAssetId: 'asset-2',
        spreadPercent: 1.5,
      };

      mockPrismaService.asset.findUnique
        .mockResolvedValueOnce({ id: 'asset-1' })
        .mockResolvedValueOnce({ id: 'asset-2' });
      mockPrismaService.customerSwapRateConfiguration.findUnique.mockResolvedValue(
        null,
      );
      mockPrismaService.customerSwapRateConfiguration.create.mockResolvedValue({
        id: 'cfg-1',
        ...dto,
      });

      const result = await service.create(dto);
      expect(result.id).toBe('cfg-1');
    });

    it('should reject same pair assets', async () => {
      await expect(
        service.create({
          fromAssetId: 'asset-1',
          toAssetId: 'asset-1',
          spreadPercent: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('should return one config', async () => {
      mockPrismaService.customerSwapRateConfiguration.findUnique.mockResolvedValue(
        {
          id: 'cfg-1',
        },
      );

      const result = await service.findOne('cfg-1');
      expect(result.id).toBe('cfg-1');
    });

    it('should throw when config not found', async () => {
      mockPrismaService.customerSwapRateConfiguration.findUnique.mockResolvedValue(
        null,
      );

      await expect(service.findOne('not-found')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update spreadPercent for ACTIVE config', async () => {
      mockPrismaService.customerSwapRateConfiguration.findUnique.mockResolvedValue(
        {
          id: 'cfg-active',
          status: CustomerSwapRateStatus.ACTIVE,
        },
      );
      mockPrismaService.customerSwapRateConfiguration.update.mockResolvedValue({
        id: 'cfg-active',
        spreadPercent: 2.5,
      });

      const result = await service.update('cfg-active', { spreadPercent: 2.5 });

      expect(result).toEqual({ id: 'cfg-active', spreadPercent: 2.5 });
      expect(
        mockPrismaService.customerSwapRateConfiguration.update,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cfg-active' },
          data: { spreadPercent: 2.5 },
        }),
      );
    });

    it('should update spreadPercent for INACTIVE config', async () => {
      mockPrismaService.customerSwapRateConfiguration.findUnique.mockResolvedValue(
        {
          id: 'cfg-inactive',
          status: CustomerSwapRateStatus.INACTIVE,
        },
      );
      mockPrismaService.customerSwapRateConfiguration.update.mockResolvedValue({
        id: 'cfg-inactive',
        spreadPercent: 1.25,
      });

      const result = await service.update('cfg-inactive', {
        spreadPercent: 1.25,
      });

      expect(result).toEqual({ id: 'cfg-inactive', spreadPercent: 1.25 });
      expect(
        mockPrismaService.customerSwapRateConfiguration.update,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cfg-inactive' },
          data: { spreadPercent: 1.25 },
        }),
      );
    });

    it('should throw when config not found', async () => {
      mockPrismaService.customerSwapRateConfiguration.findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.update('not-found', { spreadPercent: 1.5 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolveActiveRateForPair', () => {
    it('should return active config', async () => {
      mockPrismaService.customerSwapRateConfiguration.findMany.mockResolvedValue([
        {
          id: 'cfg-1',
          status: CustomerSwapRateStatus.ACTIVE,
        },
      ]);

      const result = await service.resolveActiveRateForPair('asset-1', 'asset-2');
      expect(result.id).toBe('cfg-1');
    });

    it('should throw if no active config', async () => {
      mockPrismaService.customerSwapRateConfiguration.findMany.mockResolvedValue([]);

      await expect(
        service.resolveActiveRateForPair('asset-1', 'asset-2'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if multiple active configs found', async () => {
      mockPrismaService.customerSwapRateConfiguration.findMany.mockResolvedValue([
        { id: 'cfg-1' },
        { id: 'cfg-2' },
      ]);

      await expect(
        service.resolveActiveRateForPair('asset-1', 'asset-2'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
