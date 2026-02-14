"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const testing_1 = require("@nestjs/testing");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const wallets_service_1 = require("./wallets.service");
const wallet_dto_1 = require("./dto/wallet.dto");
describe('WalletsService', () => {
    let service;
    let prisma;
    const prismaMock = {
        asset: { findUnique: jest.fn() },
        customerMain: { findUnique: jest.fn(), findMany: jest.fn() },
        liquidityProvider: { findUnique: jest.fn(), findMany: jest.fn() },
        wallet: {
            findFirst: jest.fn(),
            create: jest.fn(),
            findMany: jest.fn(),
            count: jest.fn(),
        },
    };
    const customerInboundDto = {
        ownerType: wallet_dto_1.OwnerType.CUSTOMER,
        ownerId: 'cust-1',
        type: wallet_dto_1.WalletType.CRYPTO_ADDRESS,
        direction: wallet_dto_1.WalletDirection.INBOUND,
        assetId: 'asset-1',
    };
    beforeEach(async () => {
        const module = await testing_1.Test.createTestingModule({
            providers: [
                wallets_service_1.WalletsService,
                { provide: prisma_service_1.PrismaService, useValue: prismaMock },
            ],
        }).compile();
        service = module.get(wallets_service_1.WalletsService);
        prisma = module.get(prisma_service_1.PrismaService);
        jest.clearAllMocks();
        prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1' });
        prisma.customerMain.findUnique.mockResolvedValue({ id: 'cust-1' });
        prisma.customerMain.findMany.mockResolvedValue([]);
        prisma.liquidityProvider.findUnique.mockResolvedValue({
            id: 'lp-1',
        });
        prisma.liquidityProvider.findMany.mockResolvedValue([]);
        prisma.wallet.findFirst.mockResolvedValue(null);
        prisma.wallet.create.mockResolvedValue({ id: 'wallet-1' });
        prisma.wallet.findMany.mockResolvedValue([]);
        prisma.wallet.count.mockResolvedValue(0);
    });
    it('should reject PLATFORM wallet with ownerId', async () => {
        await expect(service.create({
            ...customerInboundDto,
            ownerType: wallet_dto_1.OwnerType.PLATFORM,
            ownerId: 'not-allowed',
        })).rejects.toThrow(common_1.BadRequestException);
    });
    it('should reject CUSTOMER wallet without ownerId', async () => {
        await expect(service.create({
            ...customerInboundDto,
            ownerId: undefined,
        })).rejects.toThrow(common_1.BadRequestException);
    });
    it('should reject LIQUIDITY_PROVIDER wallet with invalid ownerId', async () => {
        prisma.liquidityProvider.findUnique.mockResolvedValue(null);
        await expect(service.create({
            ...customerInboundDto,
            ownerType: wallet_dto_1.OwnerType.LIQUIDITY_PROVIDER,
            ownerId: 'lp-x',
            direction: wallet_dto_1.WalletDirection.OUTBOUND,
        })).rejects.toThrow(common_1.BadRequestException);
    });
    it('should return existing CUSTOMER INBOUND wallet when duplicate creation requested', async () => {
        const existing = {
            id: 'wallet-existing',
            ownerType: wallet_dto_1.OwnerType.CUSTOMER,
            ownerId: 'cust-1',
            direction: wallet_dto_1.WalletDirection.INBOUND,
        };
        prisma.wallet.findFirst.mockResolvedValue(existing);
        const result = await service.create(customerInboundDto);
        expect(result).toEqual(existing);
        expect(prisma.wallet.create).not.toHaveBeenCalled();
    });
    it('should map unique constraint violation to friendly error', async () => {
        prisma.wallet.create.mockRejectedValue({ code: 'P2002' });
        await expect(service.create(customerInboundDto)).rejects.toThrow('Inbound customer wallet already exists for this asset and type');
    });
    it('should enrich CUSTOMER ownerNo and ownerName from customer profile', async () => {
        prisma.wallet.findMany.mockResolvedValue([
            {
                id: 'wallet-1',
                ownerType: wallet_dto_1.OwnerType.CUSTOMER,
                ownerId: 'cust-1',
                ownerNo: null,
                type: wallet_dto_1.WalletType.CRYPTO_ADDRESS,
                direction: wallet_dto_1.WalletDirection.INBOUND,
                asset: { code: 'USDT', type: 'CRYPTO' },
            },
        ]);
        prisma.wallet.count.mockResolvedValue(1);
        prisma.customerMain.findMany.mockResolvedValue([
            {
                id: 'cust-1',
                customerNo: 'CUST-0001',
                customerType: 'CORPORATE',
                companyName: 'ACME Trading',
                firstName: 'Alice',
                lastName: 'Lee',
                email: 'alice@example.com',
            },
        ]);
        const result = await service.findAll({});
        expect(result.total).toBe(1);
        expect(result.items[0]).toEqual(expect.objectContaining({
            ownerNo: 'CUST-0001',
            ownerName: 'ACME Trading',
        }));
    });
    it('should fallback CUSTOMER ownerName to full name then email', async () => {
        prisma.wallet.findMany.mockResolvedValue([
            {
                id: 'wallet-1',
                ownerType: wallet_dto_1.OwnerType.CUSTOMER,
                ownerId: 'cust-1',
                ownerNo: null,
                type: wallet_dto_1.WalletType.CRYPTO_ADDRESS,
                direction: wallet_dto_1.WalletDirection.INBOUND,
                asset: { code: 'USDT', type: 'CRYPTO' },
            },
            {
                id: 'wallet-2',
                ownerType: wallet_dto_1.OwnerType.CUSTOMER,
                ownerId: 'cust-2',
                ownerNo: null,
                type: wallet_dto_1.WalletType.CRYPTO_ADDRESS,
                direction: wallet_dto_1.WalletDirection.INBOUND,
                asset: { code: 'USDT', type: 'CRYPTO' },
            },
        ]);
        prisma.wallet.count.mockResolvedValue(2);
        prisma.customerMain.findMany.mockResolvedValue([
            {
                id: 'cust-1',
                customerNo: 'CUST-0001',
                customerType: 'INDIVIDUAL',
                companyName: null,
                firstName: 'Alice',
                lastName: 'Lee',
                email: 'alice@example.com',
            },
            {
                id: 'cust-2',
                customerNo: 'CUST-0002',
                customerType: 'INDIVIDUAL',
                companyName: null,
                firstName: null,
                lastName: null,
                email: 'fallback@example.com',
            },
        ]);
        const result = await service.findAll({});
        expect(result.items[0]).toEqual(expect.objectContaining({
            ownerName: 'Alice Lee',
        }));
        expect(result.items[1]).toEqual(expect.objectContaining({
            ownerName: 'fallback@example.com',
        }));
    });
    it('should enrich LIQUIDITY_PROVIDER ownerName from lp name', async () => {
        prisma.wallet.findMany.mockResolvedValue([
            {
                id: 'wallet-lp',
                ownerType: wallet_dto_1.OwnerType.LIQUIDITY_PROVIDER,
                ownerId: 'lp-1',
                ownerNo: null,
                type: wallet_dto_1.WalletType.CRYPTO_ADDRESS,
                direction: wallet_dto_1.WalletDirection.OUTBOUND,
                asset: { code: 'USDT', type: 'CRYPTO' },
            },
        ]);
        prisma.wallet.count.mockResolvedValue(1);
        prisma.liquidityProvider.findMany.mockResolvedValue([
            {
                id: 'lp-1',
                name: 'LP One',
            },
        ]);
        const result = await service.findAll({});
        expect(result.items[0]).toEqual(expect.objectContaining({
            ownerName: 'LP One',
        }));
    });
    it('should set PLATFORM ownerName as Platform', async () => {
        prisma.wallet.findMany.mockResolvedValue([
            {
                id: 'wallet-platform',
                ownerType: wallet_dto_1.OwnerType.PLATFORM,
                ownerId: null,
                ownerNo: null,
                type: wallet_dto_1.WalletType.CRYPTO_ADDRESS,
                direction: wallet_dto_1.WalletDirection.OUTBOUND,
                asset: { code: 'USDT', type: 'CRYPTO' },
            },
        ]);
        prisma.wallet.count.mockResolvedValue(1);
        const result = await service.findAll({});
        expect(result.items[0]).toEqual(expect.objectContaining({
            ownerNo: null,
            ownerName: 'Platform',
        }));
    });
    it('should keep ownerNo and ownerName null when owner profile is missing', async () => {
        prisma.wallet.findMany.mockResolvedValue([
            {
                id: 'wallet-missing',
                ownerType: wallet_dto_1.OwnerType.CUSTOMER,
                ownerId: 'cust-missing',
                ownerNo: null,
                type: wallet_dto_1.WalletType.CRYPTO_ADDRESS,
                direction: wallet_dto_1.WalletDirection.INBOUND,
                asset: { code: 'USDT', type: 'CRYPTO' },
            },
        ]);
        prisma.wallet.count.mockResolvedValue(1);
        prisma.customerMain.findMany.mockResolvedValue([]);
        const result = await service.findAll({});
        expect(result.items[0]).toEqual(expect.objectContaining({
            ownerNo: null,
            ownerName: null,
        }));
    });
});
//# sourceMappingURL=wallets.service.spec.js.map