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
var JournalHeaderTemplatesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.JournalHeaderTemplatesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const client_1 = require("@prisma/client");
let JournalHeaderTemplatesService = JournalHeaderTemplatesService_1 = class JournalHeaderTemplatesService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(JournalHeaderTemplatesService_1.name);
    }
    async create(createDto) {
        const existing = await this.prisma.journalHeaderTemplate.findUnique({
            where: { templateCode: createDto.templateCode },
        });
        if (existing) {
            throw new common_1.BadRequestException(`Template code ${createDto.templateCode} already exists`);
        }
        const event = await this.prisma.acctEvent.findUnique({
            where: { eventCode: createDto.eventCode },
        });
        if (!event)
            throw new common_1.BadRequestException(`Event code ${createDto.eventCode} not found`);
        const asset = await this.prisma.asset.findUnique({
            where: { id: createDto.baseAssetId },
        });
        if (!asset)
            throw new common_1.BadRequestException(`Asset ID ${createDto.baseAssetId} not found`);
        return this.prisma.journalHeaderTemplate.create({
            data: createDto,
        });
    }
    async findAll(query) {
        const { skip, take, templateCode, eventCode, status } = query;
        const where = {};
        if (templateCode)
            where.templateCode = { contains: templateCode };
        if (eventCode)
            where.eventCode = eventCode;
        if (status)
            where.status = status;
        const [items, total] = await Promise.all([
            this.prisma.journalHeaderTemplate.findMany({
                skip: skip ? Number(skip) : 0,
                take: take ? Number(take) : 20,
                where,
                orderBy: { createdAt: 'desc' },
                include: {
                    acctEvent: true,
                    baseAsset: true,
                },
            }),
            this.prisma.journalHeaderTemplate.count({ where }),
        ]);
        return { items, total };
    }
    async findOne(id) {
        const item = await this.prisma.journalHeaderTemplate.findUnique({
            where: { id },
            include: {
                acctEvent: true,
                baseAsset: true,
            },
        });
        if (!item)
            throw new common_1.NotFoundException('Template not found');
        return item;
    }
    async update(id, updateDto) {
        if (updateDto.baseAssetId) {
            const asset = await this.prisma.asset.findUnique({
                where: { id: updateDto.baseAssetId },
            });
            if (!asset)
                throw new common_1.BadRequestException(`Asset ID ${updateDto.baseAssetId} not found`);
        }
        try {
            return await this.prisma.journalHeaderTemplate.update({
                where: { id },
                data: updateDto,
            });
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2025')
                    throw new common_1.NotFoundException('Template not found');
            }
            throw error;
        }
    }
    async remove(id) {
        return this.update(id, { status: 'INACTIVE' });
    }
};
exports.JournalHeaderTemplatesService = JournalHeaderTemplatesService;
exports.JournalHeaderTemplatesService = JournalHeaderTemplatesService = JournalHeaderTemplatesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], JournalHeaderTemplatesService);
//# sourceMappingURL=journal-header-templates.service.js.map