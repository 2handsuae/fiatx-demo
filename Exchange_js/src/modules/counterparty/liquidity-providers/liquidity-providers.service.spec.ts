import { Test, TestingModule } from '@nestjs/testing';
import { LiquidityProvidersService } from './liquidity-providers.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { LiquidityProviderStatus } from './dto/liquidity-provider.dto';

const mockPrismaService = {
  liquidityProvider: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

describe('LiquidityProvidersService', () => {
  let service: LiquidityProvidersService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiquidityProvidersService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<LiquidityProvidersService>(LiquidityProvidersService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new liquidity provider with correct ID format', async () => {
      const dto = {
        name: 'Test Provider',
        email: 'test@provider.com',
        phone: '+1234567890',
      };

      mockPrismaService.liquidityProvider.findUnique.mockResolvedValue(null);
      mockPrismaService.liquidityProvider.create.mockImplementation((args) =>
        Promise.resolve({
          id: 'LP_uuid',
          ...args.data,
          status: LiquidityProviderStatus.INACTIVE,
        }),
      );

      const result = await service.create(dto);

      expect(result.id).toMatch(
        /^LP_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(result.name).toBe(dto.name);
      expect(result.status).toBe(LiquidityProviderStatus.INACTIVE);
      expect(mockPrismaService.liquidityProvider.create).toHaveBeenCalled();
    });

    it('should throw error if email already exists', async () => {
      mockPrismaService.liquidityProvider.findUnique.mockResolvedValue({
        id: 'existing',
      });
      await expect(
        service.create({
          name: 'Test',
          email: 'existing@test.com',
        }),
      ).rejects.toThrow('Email already exists');
    });
  });

  describe('findAll', () => {
    it('should return providers list', async () => {
      const dbItems = [
        {
          id: 'LP_1',
          name: 'Provider 1',
        },
      ];
      mockPrismaService.liquidityProvider.findMany.mockResolvedValue(dbItems);
      mockPrismaService.liquidityProvider.count.mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result.items[0].name).toEqual('Provider 1');
      expect(result.total).toEqual(1);
    });
  });
});
