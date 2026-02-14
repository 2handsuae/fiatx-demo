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
var AssetsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const asset_dto_1 = require("./dto/asset.dto");
const no_generator_util_1 = require("../../../common/utils/no-generator.util");
let AssetsService = AssetsService_1 = class AssetsService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(AssetsService_1.name);
    }
    async create(data) {
        this.logger.log(`Creating asset: ${data.type} ${data.code} ${data.network || ''}`);
        const existing = await this.prisma.asset.findFirst({
            where: {
                type: data.type,
                code: data.code,
                network: data.network || null,
            },
        });
        if (existing) {
            this.logger.warn(`Failed to create asset: Asset combination already exists`);
            throw new common_1.BadRequestException('Asset with this type, code and network combination already exists');
        }
        if (data.type === asset_dto_1.AssetType.CRYPTO && !data.network) {
            throw new common_1.BadRequestException('Network is required for CRYPTO assets');
        }
        const result = await this.prisma.asset.create({
            data: {
                assetNo: (0, no_generator_util_1.generateReferenceNo)('AS'),
                type: data.type,
                code: data.code,
                network: data.network,
                decimals: data.decimals,
                description: data.description,
                status: asset_dto_1.AssetStatus.ACTIVE,
            },
        });
        this.logger.log(`Asset created: ${result.id}`);
        return result;
    }
    async findAll(params) {
        const { skip, take, where, orderBy } = params;
        const [items, total] = await Promise.all([
            this.prisma.asset.findMany({
                skip,
                take,
                where,
                orderBy,
            }),
            this.prisma.asset.count({ where }),
        ]);
        return { items, total };
    }
    async findOne(id) {
        const item = await this.prisma.asset.findUnique({
            where: { id },
        });
        if (!item)
            throw new common_1.NotFoundException('Asset not found');
        return item;
    }
    async changeStatus(id, status) {
        this.logger.log(`Changing status of Asset ${id} to ${status}`);
        const result = await this.prisma.asset.update({
            where: { id },
            data: { status },
        });
        this.logger.log(`Status changed for Asset: ${id}`);
        return result;
    }
};
exports.AssetsService = AssetsService;
exports.AssetsService = AssetsService = AssetsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AssetsService);
//# sourceMappingURL=assets.service.js.map