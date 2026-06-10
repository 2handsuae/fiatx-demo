import { Test, TestingModule } from '@nestjs/testing';
import { LiquidityConfigService } from './liquidity-config.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  LiquidityConfigStatus,
  RateSourceType,
} from './dto/liquidity-config.dto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';

const mockPrismaService = {
  liquidityConfiguration: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  liquidityProvider: {
    findUnique: jest.fn(),
  },
  asset: {
    findUnique: jest.fn(),
  },
  auditLogEvent: {
    create: jest.fn().mockResolvedValue({ id: 'audit-id' }),
    findUnique: jest.fn().mockResolvedValue(null),
  },
};

describe('LiquidityConfigService', () => {
  let service: LiquidityConfigService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiquidityConfigService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditLogsService, useValue: { recordSystem: jest.fn().mockResolvedValue({}), recordByActor: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    service = module.get<LiquidityConfigService>(LiquidityConfigService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new config successfully', async () => {
      const dto = {
        lpId: 'lp1',
        fromAssetId: 'a1',
        toAssetId: 'a2',
        rateSourceType: RateSourceType.API,
        spreadPercent: 1.5,
        feePercent: 0.1,
        feeFixedAmount: 0,
      };

      mockPrismaService.liquidityProvider.findUnique.mockResolvedValue({
        id: 'lp1',
      });
      mockPrismaService.asset.findUnique.mockResolvedValue({ id: 'a1' });
      mockPrismaService.liquidityConfiguration.create.mockResolvedValue({
        id: 'config1',
        ...dto,
      });

      const result = await service.create(dto);
      expect(result.id).toBe('config1');
      expect(
        mockPrismaService.liquidityConfiguration.create,
      ).toHaveBeenCalled();
    });

    it('should throw error if LP not found', async () => {
      mockPrismaService.liquidityProvider.findUnique.mockResolvedValue(null);
      await expect(
        service.create({
          lpId: 'invalid',
          fromAssetId: 'a1',
          toAssetId: 'a2',
          rateSourceType: RateSourceType.API,
          spreadPercent: 1,
          feePercent: 0,
          feeFixedAmount: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('should return a config if found', async () => {
      mockPrismaService.liquidityConfiguration.findUnique.mockResolvedValue({
        id: '1',
      });
      const result = await service.findOne('1');
      expect(result.id).toBe('1');
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrismaService.liquidityConfiguration.findUnique.mockResolvedValue(
        null,
      );
      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update config', async () => {
      mockPrismaService.liquidityConfiguration.findUnique.mockResolvedValue({
        id: '1',
        status: LiquidityConfigStatus.INACTIVE,
      });
      mockPrismaService.liquidityConfiguration.update.mockResolvedValue({
        id: '1',
        spreadPercent: 1.2,
        feePercent: 0.5,
      });

      const result = await service.update('1', {
        spreadPercent: 1.2,
        feePercent: 0.5,
      });
      expect(result.feePercent).toBe(0.5);
      expect(result.spreadPercent).toBe(1.2);
    });
  });

  describe('resolveActiveConfigForPair', () => {
    it('should return single active config for pair', async () => {
      mockPrismaService.liquidityConfiguration.findMany.mockResolvedValue([
        {
          id: 'cfg-1',
          rateSourceType: RateSourceType.API,
          spreadPercent: 1.5,
          lp: { id: 'lp1', name: 'LP1', status: 'ACTIVE' },
        },
      ]);

      const result = await service.resolveActiveConfigForPair('a1', 'a2');
      expect(result.id).toBe('cfg-1');
    });

    it('should throw when no active config exists', async () => {
      mockPrismaService.liquidityConfiguration.findMany.mockResolvedValue([]);
      await expect(
        service.resolveActiveConfigForPair('a1', 'a2'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when multiple active configs exist', async () => {
      mockPrismaService.liquidityConfiguration.findMany.mockResolvedValue([
        { id: 'cfg-1', rateSourceType: RateSourceType.API, lp: { status: 'ACTIVE' } },
        { id: 'cfg-2', rateSourceType: RateSourceType.API, lp: { status: 'ACTIVE' } },
      ]);
      await expect(
        service.resolveActiveConfigForPair('a1', 'a2'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
