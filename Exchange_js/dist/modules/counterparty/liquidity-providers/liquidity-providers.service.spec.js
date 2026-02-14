"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const liquidity_providers_service_1 = require("./liquidity-providers.service");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const liquidity_provider_dto_1 = require("./dto/liquidity-provider.dto");
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
    let service;
    let prisma;
    beforeEach(async () => {
        const module = await testing_1.Test.createTestingModule({
            providers: [
                liquidity_providers_service_1.LiquidityProvidersService,
                { provide: prisma_service_1.PrismaService, useValue: mockPrismaService },
            ],
        }).compile();
        service = module.get(liquidity_providers_service_1.LiquidityProvidersService);
        prisma = module.get(prisma_service_1.PrismaService);
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
            mockPrismaService.liquidityProvider.create.mockImplementation((args) => Promise.resolve({
                id: 'LP_uuid',
                ...args.data,
                status: liquidity_provider_dto_1.LiquidityProviderStatus.INACTIVE,
            }));
            const result = await service.create(dto);
            expect(result.id).toMatch(/^LP_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
            expect(result.name).toBe(dto.name);
            expect(result.status).toBe(liquidity_provider_dto_1.LiquidityProviderStatus.INACTIVE);
            expect(mockPrismaService.liquidityProvider.create).toHaveBeenCalled();
        });
        it('should throw error if email already exists', async () => {
            mockPrismaService.liquidityProvider.findUnique.mockResolvedValue({
                id: 'existing',
            });
            await expect(service.create({
                name: 'Test',
                email: 'existing@test.com',
            })).rejects.toThrow('Email already exists');
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
//# sourceMappingURL=liquidity-providers.service.spec.js.map