"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const testing_1 = require("@nestjs/testing");
const wallets_controller_1 = require("./wallets.controller");
const wallets_service_1 = require("./wallets.service");
const wallet_dto_1 = require("./dto/wallet.dto");
describe('WalletsController', () => {
    let controller;
    const serviceMock = {
        create: jest.fn(),
        findAll: jest.fn(),
        findOne: jest.fn(),
        changeStatus: jest.fn(),
    };
    const customerReq = { user: { type: 'CUSTOMER', userId: 'cust-1' } };
    const adminReq = { user: { type: 'ADMIN', userId: 'admin-1' } };
    const createDto = {
        ownerType: wallet_dto_1.OwnerType.CUSTOMER,
        ownerId: 'cust-1',
        type: wallet_dto_1.WalletType.CRYPTO_ADDRESS,
        direction: wallet_dto_1.WalletDirection.INBOUND,
        assetId: 'asset-1',
    };
    beforeEach(async () => {
        const module = await testing_1.Test.createTestingModule({
            controllers: [wallets_controller_1.WalletsController],
            providers: [{ provide: wallets_service_1.WalletsService, useValue: serviceMock }],
        }).compile();
        controller = module.get(wallets_controller_1.WalletsController);
        jest.clearAllMocks();
    });
    it('should reject CUSTOMER creating PLATFORM wallet', () => {
        expect(() => controller.create(customerReq, {
            ...createDto,
            ownerType: wallet_dto_1.OwnerType.PLATFORM,
            ownerId: undefined,
        })).toThrow(common_1.ForbiddenException);
    });
    it('should reject CUSTOMER creating wallet for another ownerId', () => {
        expect(() => controller.create(customerReq, {
            ...createDto,
            ownerId: 'cust-2',
        })).toThrow(common_1.ForbiddenException);
    });
    it('should force CUSTOMER list query to self owner', async () => {
        serviceMock.findAll.mockResolvedValue({ items: [], total: 0 });
        await controller.findAll(customerReq, undefined, undefined, undefined, undefined, undefined, undefined, undefined);
        expect(serviceMock.findAll).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                ownerType: wallet_dto_1.OwnerType.CUSTOMER,
                ownerId: 'cust-1',
            }),
        }));
    });
    it('should reject CUSTOMER querying other ownerId', () => {
        expect(() => controller.findAll(customerReq, undefined, undefined, undefined, 'cust-2', undefined, undefined, undefined)).toThrow(common_1.ForbiddenException);
    });
    it('should reject CUSTOMER querying non-CUSTOMER ownerType', () => {
        expect(() => controller.findAll(customerReq, undefined, undefined, wallet_dto_1.OwnerType.PLATFORM, undefined, undefined, undefined, undefined)).toThrow(common_1.ForbiddenException);
    });
    it('should reject CUSTOMER changing wallet status', () => {
        expect(() => controller.changeStatus(customerReq, 'wallet-1', {
            status: wallet_dto_1.WalletStatus.DISABLED,
        })).toThrow(common_1.ForbiddenException);
    });
    it('should allow ADMIN creating PLATFORM and LIQUIDITY_PROVIDER wallets', () => {
        serviceMock.create.mockResolvedValue({ id: 'wallet-1' });
        controller.create(adminReq, {
            ...createDto,
            ownerType: wallet_dto_1.OwnerType.PLATFORM,
            ownerId: undefined,
        });
        controller.create(adminReq, {
            ...createDto,
            ownerType: wallet_dto_1.OwnerType.LIQUIDITY_PROVIDER,
            ownerId: 'lp-1',
        });
        expect(serviceMock.create).toHaveBeenCalledTimes(2);
    });
    it('should reject CUSTOMER reading wallet not owned by self', async () => {
        serviceMock.findOne.mockResolvedValue({
            id: 'wallet-2',
            ownerType: wallet_dto_1.OwnerType.CUSTOMER,
            ownerId: 'cust-2',
        });
        await expect(controller.findOne(customerReq, 'wallet-2')).rejects.toThrow(common_1.ForbiddenException);
    });
});
//# sourceMappingURL=wallets.controller.spec.js.map