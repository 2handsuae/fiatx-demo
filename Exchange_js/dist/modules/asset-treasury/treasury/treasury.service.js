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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TreasuryService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
let TreasuryService = class TreasuryService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getCustomerAssets(customerId) {
        const wallets = await this.prisma.wallet.findMany({
            where: {
                ownerType: 'CUSTOMER',
                ownerId: customerId,
            },
            include: {
                asset: true,
            },
        });
        const uniqueAssetIds = [...new Set(wallets.map((w) => w.assetId))];
        const assetsWithBalance = await Promise.all(uniqueAssetIds.map(async (assetId) => {
            const wallet = wallets.find((w) => w.assetId === assetId);
            const aggregate = await this.prisma.journalLine.aggregate({
                _sum: {
                    amount: true,
                },
                where: {
                    accountCode: 'L.CLIENT_CREDIT',
                    ownerType: 'CUSTOMER',
                    ownerId: customerId,
                    assetId: assetId,
                    drCr: 'CR',
                },
            });
            const debitAggregate = await this.prisma.journalLine.aggregate({
                _sum: {
                    amount: true,
                },
                where: {
                    accountCode: 'L.CLIENT_CREDIT',
                    ownerType: 'CUSTOMER',
                    ownerId: customerId,
                    assetId: assetId,
                    drCr: 'DR',
                },
            });
            const totalCr = aggregate._sum.amount
                ? Number(aggregate._sum.amount)
                : 0;
            const totalDr = debitAggregate._sum.amount
                ? Number(debitAggregate._sum.amount)
                : 0;
            const realBalance = totalCr - totalDr;
            const lockedCrAggregate = await this.prisma.journalLine.aggregate({
                _sum: { amount: true },
                where: {
                    accountCode: 'L.CLIENT_HELD',
                    ownerType: 'CUSTOMER',
                    ownerId: customerId,
                    assetId: assetId,
                    drCr: 'CR',
                },
            });
            const lockedDrAggregate = await this.prisma.journalLine.aggregate({
                _sum: { amount: true },
                where: {
                    accountCode: 'L.CLIENT_HELD',
                    ownerType: 'CUSTOMER',
                    ownerId: customerId,
                    assetId: assetId,
                    drCr: 'DR',
                },
            });
            const lockedTotalCr = lockedCrAggregate._sum.amount
                ? Number(lockedCrAggregate._sum.amount)
                : 0;
            const lockedTotalDr = lockedDrAggregate._sum.amount
                ? Number(lockedDrAggregate._sum.amount)
                : 0;
            const realLockedBalance = lockedTotalCr - lockedTotalDr;
            return {
                assetId: assetId,
                assetCode: wallet.asset.code,
                assetType: wallet.asset.type,
                clientCredit: realBalance,
                lockedBalance: realLockedBalance,
                walletId: wallet.id,
                walletBalance: wallet.balance,
            };
        }));
        return assetsWithBalance;
    }
};
exports.TreasuryService = TreasuryService;
exports.TreasuryService = TreasuryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TreasuryService);
//# sourceMappingURL=treasury.service.js.map