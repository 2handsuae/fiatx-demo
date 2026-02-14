"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const liquidity_config_service_1 = require("./liquidity-config.service");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const liquidity_config_dto_1 = require("./dto/liquidity-config.dto");
const common_1 = require("@nestjs/common");
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
};
describe('LiquidityConfigService', () => {
    let service;
    let prisma;
    beforeEach(async () => {
        const module = await testing_1.Test.createTestingModule({
            providers: [
                liquidity_config_service_1.LiquidityConfigService,
                { provide: prisma_service_1.PrismaService, useValue: mockPrismaService },
            ],
        }).compile();
        service = module.get(liquidity_config_service_1.LiquidityConfigService);
        prisma = module.get(prisma_service_1.PrismaService);
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
                rateSourceType: liquidity_config_dto_1.RateSourceType.API,
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
            expect(mockPrismaService.liquidityConfiguration.create).toHaveBeenCalled();
        });
        it('should throw error if LP not found', async () => {
            mockPrismaService.liquidityProvider.findUnique.mockResolvedValue(null);
            await expect(service.create({
                lpId: 'invalid',
                fromAssetId: 'a1',
                toAssetId: 'a2',
                rateSourceType: liquidity_config_dto_1.RateSourceType.API,
                feePercent: 0,
                feeFixedAmount: 0,
            })).rejects.toThrow(common_1.BadRequestException);
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
            mockPrismaService.liquidityConfiguration.findUnique.mockResolvedValue(null);
            await expect(service.findOne('999')).rejects.toThrow(common_1.NotFoundException);
        });
    });
    describe('update', () => {
        it('should update config', async () => {
            mockPrismaService.liquidityConfiguration.findUnique.mockResolvedValue({
                id: '1',
                status: liquidity_config_dto_1.LiquidityConfigStatus.INACTIVE,
            });
            mockPrismaService.liquidityConfiguration.update.mockResolvedValue({
                id: '1',
                feePercent: 0.5,
            });
            const result = await service.update('1', { feePercent: 0.5 });
            expect(result.feePercent).toBe(0.5);
        });
    });
});
//# sourceMappingURL=liquidity-config.service.spec.js.map