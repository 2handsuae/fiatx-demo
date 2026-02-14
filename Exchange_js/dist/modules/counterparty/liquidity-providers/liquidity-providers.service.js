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
var LiquidityProvidersService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiquidityProvidersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const liquidity_provider_dto_1 = require("./dto/liquidity-provider.dto");
const crypto_1 = require("crypto");
let LiquidityProvidersService = LiquidityProvidersService_1 = class LiquidityProvidersService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(LiquidityProvidersService_1.name);
    }
    async create(data) {
        this.logger.log(`Creating liquidity provider: ${data.email}`);
        const existingEmail = await this.prisma.liquidityProvider.findUnique({
            where: { email: data.email },
        });
        if (existingEmail) {
            this.logger.warn(`Failed to create LP: Email ${data.email} already exists`);
            throw new common_1.BadRequestException('Email already exists');
        }
        const id = `LP_${(0, crypto_1.randomUUID)()}`;
        const result = await this.prisma.liquidityProvider.create({
            data: {
                id,
                name: data.name,
                email: data.email,
                phone: data.phone,
                status: liquidity_provider_dto_1.LiquidityProviderStatus.INACTIVE,
            },
        });
        this.logger.log(`Liquidity provider created: ${id}`);
        return result;
    }
    async findAll(params) {
        const { skip, take, where, orderBy } = params;
        const [items, total] = await Promise.all([
            this.prisma.liquidityProvider.findMany({
                skip,
                take,
                where,
                orderBy,
            }),
            this.prisma.liquidityProvider.count({ where }),
        ]);
        return {
            items,
            total,
        };
    }
    async findOne(id) {
        const item = await this.prisma.liquidityProvider.findUnique({
            where: { id },
        });
        if (!item)
            return null;
        return item;
    }
    async changeStatus(id, status) {
        this.logger.log(`Changing status of LP ${id} to ${status}`);
        const result = await this.prisma.liquidityProvider.update({
            where: { id },
            data: { status },
        });
        this.logger.log(`Status changed for LP: ${id}`);
        return result;
    }
};
exports.LiquidityProvidersService = LiquidityProvidersService;
exports.LiquidityProvidersService = LiquidityProvidersService = LiquidityProvidersService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], LiquidityProvidersService);
//# sourceMappingURL=liquidity-providers.service.js.map