"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var WalletsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const wallet_dto_1 = require("./dto/wallet.dto");
const crypto = require("crypto");
const no_generator_util_1 = require("../../../common/utils/no-generator.util");
let WalletsService = WalletsService_1 = class WalletsService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(WalletsService_1.name);
    }
    async create(data) {
        this.logger.log(`Creating wallet for ${data.ownerType}`);
        const asset = await this.prisma.asset.findUnique({
            where: { id: data.assetId },
        });
        if (!asset)
            throw new common_1.BadRequestException('Invalid Asset ID');
        if (data.ownerType !== wallet_dto_1.OwnerType.PLATFORM && !data.ownerId) {
            throw new common_1.BadRequestException('Owner ID is required for non-PLATFORM wallets');
        }
        if (data.ownerType === wallet_dto_1.OwnerType.CUSTOMER && data.ownerId) {
            const customer = await this.prisma.customerMain.findUnique({
                where: { id: data.ownerId },
            });
            if (!customer)
                throw new common_1.BadRequestException('Invalid Customer ID');
            if (data.direction === wallet_dto_1.WalletDirection.INBOUND) {
                const existing = await this.prisma.wallet.findFirst({
                    where: {
                        ownerType: wallet_dto_1.OwnerType.CUSTOMER,
                        ownerId: data.ownerId,
                        assetId: data.assetId,
                        direction: wallet_dto_1.WalletDirection.INBOUND,
                        type: data.type,
                    },
                    include: {
                        asset: { select: { code: true, type: true } },
                    },
                });
                if (existing) {
                    this.logger.log(`Returning existing INBOUND wallet: ${existing.id}`);
                    return existing;
                }
            }
        }
        if (data.direction === wallet_dto_1.WalletDirection.INBOUND &&
            data.ownerType === wallet_dto_1.OwnerType.CUSTOMER) {
            if (data.type === wallet_dto_1.WalletType.CRYPTO_ADDRESS && !data.address) {
                data.address = '0x' + crypto.randomBytes(20).toString('hex');
                this.logger.log(`Generated mock address: ${data.address}`);
            }
            if (data.type === wallet_dto_1.WalletType.FIAT_BANK && !data.iban) {
                data.iban =
                    'US' +
                        crypto.randomInt(10, 99) +
                        'FIATX' +
                        crypto.randomBytes(8).toString('hex').toUpperCase();
                if (!data.bankName)
                    data.bankName = 'FiatX Virtual Bank';
                if (!data.accountName)
                    data.accountName = 'Customer Account';
                this.logger.log(`Generated mock IBAN: ${data.iban}`);
            }
        }
        if (data.ownerType === wallet_dto_1.OwnerType.LIQUIDITY_PROVIDER && data.ownerId) {
            const lp = await this.prisma.liquidityProvider.findUnique({
                where: { id: data.ownerId },
            });
            if (!lp)
                throw new common_1.BadRequestException('Invalid Liquidity Provider ID');
        }
        const result = await this.prisma.wallet.create({
            data: {
                walletNo: (0, no_generator_util_1.generateReferenceNo)('WA'),
                ownerType: data.ownerType,
                ownerId: data.ownerId,
                type: data.type,
                direction: data.direction,
                assetId: data.assetId,
                address: data.address,
                memo: data.memo,
                beneficiaryName: data.beneficiaryName,
                counterpartyVasp: data.counterpartyVasp,
                bankName: data.bankName,
                bankAccount: data.bankAccount,
                bankCode: data.bankCode,
                accountName: data.accountName,
                iban: data.iban,
                status: wallet_dto_1.WalletStatus.ACTIVE,
            },
            include: {
                asset: { select: { code: true, type: true } },
            },
        });
        this.logger.log(`Wallet created: ${result.id}`);
        return result;
    }
    async findAll(params) {
        const { skip, take, where, orderBy } = params;
        const [items, total] = await Promise.all([
            this.prisma.wallet.findMany({
                skip,
                take,
                where,
                orderBy,
                include: {
                    asset: { select: { code: true, type: true } },
                },
            }),
            this.prisma.wallet.count({ where }),
        ]);
        return { items, total };
    }
    async findOne(id) {
        const item = await this.prisma.wallet.findUnique({
            where: { id },
            include: {
                asset: true,
                customer: { select: { customerNo: true } },
            },
        });
        if (!item)
            throw new common_1.NotFoundException('Wallet not found');
        const walletWithCustomer = item;
        let ownerNo = walletWithCustomer.ownerNo;
        if (!ownerNo && walletWithCustomer.ownerType === wallet_dto_1.OwnerType.CUSTOMER && walletWithCustomer.customer) {
            ownerNo = walletWithCustomer.customer.customerNo;
        }
        return { ...item, ownerNo };
    }
    async changeStatus(id, status) {
        this.logger.log(`Changing status of wallet ${id} to ${status}`);
        const result = await this.prisma.wallet.update({
            where: { id },
            data: { status },
        });
        return result;
    }
};
exports.WalletsService = WalletsService;
exports.WalletsService = WalletsService = WalletsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], WalletsService);
//# sourceMappingURL=wallets.service.js.map