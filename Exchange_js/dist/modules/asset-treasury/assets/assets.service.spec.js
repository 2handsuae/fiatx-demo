"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const assets_service_1 = require("./assets.service");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const asset_dto_1 = require("./dto/asset.dto");
const common_1 = require("@nestjs/common");
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
    let service;
    let prisma;
    beforeEach(async () => {
        const module = await testing_1.Test.createTestingModule({
            providers: [
                assets_service_1.AssetsService,
                { provide: prisma_service_1.PrismaService, useValue: mockPrismaService },
            ],
        }).compile();
        service = module.get(assets_service_1.AssetsService);
        prisma = module.get(prisma_service_1.PrismaService);
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
                type: asset_dto_1.AssetType.CRYPTO,
                code: 'USDT',
                network: 'TRC20',
                decimals: 6,
                description: 'Tether on Tron',
            };
            mockPrismaService.asset.findFirst.mockResolvedValue(null);
            mockPrismaService.asset.create.mockImplementation((args) => Promise.resolve({ id: 'uuid', ...args.data }));
            const result = await service.create(dto);
            expect(result.code).toBe(dto.code);
            expect(result.status).toBe(asset_dto_1.AssetStatus.ACTIVE);
            expect(mockPrismaService.asset.create).toHaveBeenCalled();
        });
        it('should throw error if asset combination exists', async () => {
            mockPrismaService.asset.findFirst.mockResolvedValue({ id: 'existing' });
            await expect(service.create({
                type: asset_dto_1.AssetType.CRYPTO,
                code: 'USDT',
                network: 'TRC20',
                decimals: 6,
            })).rejects.toThrow(common_1.BadRequestException);
        });
        it('should throw error if CRYPTO has no network', async () => {
            mockPrismaService.asset.findFirst.mockResolvedValue(null);
            await expect(service.create({
                type: asset_dto_1.AssetType.CRYPTO,
                code: 'BTC',
                decimals: 8,
            })).rejects.toThrow(common_1.BadRequestException);
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
            await expect(service.findOne('999')).rejects.toThrow(common_1.NotFoundException);
        });
    });
    describe('changeStatus', () => {
        it('should update status', async () => {
            mockPrismaService.asset.update.mockResolvedValue({
                id: '1',
                status: asset_dto_1.AssetStatus.DISABLED,
            });
            const result = await service.changeStatus('1', asset_dto_1.AssetStatus.DISABLED);
            expect(result.status).toBe(asset_dto_1.AssetStatus.DISABLED);
            expect(mockPrismaService.asset.update).toHaveBeenCalledWith({
                where: { id: '1' },
                data: { status: asset_dto_1.AssetStatus.DISABLED },
            });
        });
    });
});
//# sourceMappingURL=assets.service.spec.js.map