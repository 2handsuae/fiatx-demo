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
var LiquidityConfigService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiquidityConfigService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const liquidity_config_dto_1 = require("./dto/liquidity-config.dto");
let LiquidityConfigService = LiquidityConfigService_1 = class LiquidityConfigService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(LiquidityConfigService_1.name);
    }
    async create(data) {
        this.logger.log(`Creating liquidity config for LP ${data.lpId}: ${data.fromAssetId} -> ${data.toAssetId}`);
        const lp = await this.prisma.liquidityProvider.findUnique({
            where: { id: data.lpId },
        });
        if (!lp)
            throw new common_1.BadRequestException('Invalid Liquidity Provider ID');
        const fromAsset = await this.prisma.asset.findUnique({
            where: { id: data.fromAssetId },
        });
        if (!fromAsset)
            throw new common_1.BadRequestException('Invalid From Asset ID');
        const toAsset = await this.prisma.asset.findUnique({
            where: { id: data.toAssetId },
        });
        if (!toAsset)
            throw new common_1.BadRequestException('Invalid To Asset ID');
        if (data.feeAssetId) {
            const feeAsset = await this.prisma.asset.findUnique({
                where: { id: data.feeAssetId },
            });
            if (!feeAsset)
                throw new common_1.BadRequestException('Invalid Fee Asset ID');
        }
        const result = await this.prisma.liquidityConfiguration.create({
            data: {
                lpId: data.lpId,
                fromAssetId: data.fromAssetId,
                toAssetId: data.toAssetId,
                rateSourceType: data.rateSourceType,
                feePercent: data.feePercent,
                feeFixedAmount: data.feeFixedAmount,
                feeAssetId: data.feeAssetId,
                minFromAmount: data.minFromAmount,
                maxFromAmount: data.maxFromAmount,
                status: liquidity_config_dto_1.LiquidityConfigStatus.ACTIVE,
            },
        });
        this.logger.log(`Liquidity config created: ${result.id}`);
        return result;
    }
    async findAll(params) {
        const { skip, take, where, orderBy } = params;
        const [items, total] = await Promise.all([
            this.prisma.liquidityConfiguration.findMany({
                skip,
                take,
                where,
                orderBy,
                include: {
                    lp: { select: { name: true } },
                    fromAsset: { select: { code: true, type: true } },
                    toAsset: { select: { code: true, type: true } },
                },
            }),
            this.prisma.liquidityConfiguration.count({ where }),
        ]);
        return { items, total };
    }
    async findOne(id) {
        const item = await this.prisma.liquidityConfiguration.findUnique({
            where: { id },
            include: {
                lp: true,
                fromAsset: true,
                toAsset: true,
                feeAsset: true,
            },
        });
        if (!item)
            throw new common_1.NotFoundException('Configuration not found');
        return item;
    }
    async update(id, data) {
        this.logger.log(`Updating liquidity config ${id}`);
        const config = await this.findOne(id);
        if (config.status !== liquidity_config_dto_1.LiquidityConfigStatus.INACTIVE) {
            throw new common_1.BadRequestException('Only INACTIVE configurations can be updated');
        }
        if (data.feeAssetId) {
            const feeAsset = await this.prisma.asset.findUnique({
                where: { id: data.feeAssetId },
            });
            if (!feeAsset)
                throw new common_1.BadRequestException('Invalid Fee Asset ID');
        }
        const result = await this.prisma.liquidityConfiguration.update({
            where: { id },
            data: {
                rateSourceType: data.rateSourceType,
                feePercent: data.feePercent,
                feeFixedAmount: data.feeFixedAmount,
                feeAssetId: data.feeAssetId,
                minFromAmount: data.minFromAmount,
                maxFromAmount: data.maxFromAmount,
            },
        });
        this.logger.log(`Liquidity config updated: ${id}`);
        return result;
    }
    async remove(id) {
        this.logger.log(`Deleting liquidity config ${id}`);
        await this.findOne(id);
        return this.prisma.liquidityConfiguration.delete({ where: { id } });
    }
    async changeStatus(id, status) {
        this.logger.log(`Changing status of config ${id} to ${status}`);
        const result = await this.prisma.liquidityConfiguration.update({
            where: { id },
            data: { status },
        });
        return result;
    }
    async getAvailableConfigs(fromAssetId, toAssetId) {
        return this.prisma.liquidityConfiguration.findMany({
            where: {
                fromAssetId,
                toAssetId,
                status: liquidity_config_dto_1.LiquidityConfigStatus.ACTIVE,
                lp: { status: 'ACTIVE' },
            },
            include: {
                lp: true,
            },
        });
    }
    async getByLpId(lpId) {
        return this.prisma.liquidityConfiguration.findMany({
            where: { lpId },
            include: {
                fromAsset: true,
                toAsset: true,
            },
        });
    }
};
exports.LiquidityConfigService = LiquidityConfigService;
exports.LiquidityConfigService = LiquidityConfigService = LiquidityConfigService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], LiquidityConfigService);
//# sourceMappingURL=liquidity-config.service.js.map