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
var AcctEventsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcctEventsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const client_1 = require("@prisma/client");
let AcctEventsService = AcctEventsService_1 = class AcctEventsService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(AcctEventsService_1.name);
    }
    async create(createDto) {
        const existing = await this.prisma.acctEvent.findUnique({
            where: { eventCode: createDto.eventCode },
        });
        if (existing) {
            throw new common_1.BadRequestException(`Event code ${createDto.eventCode} already exists`);
        }
        if (createDto.postingReversalOfEventCode) {
            const reversalTarget = await this.prisma.acctEvent.findUnique({
                where: { eventCode: createDto.postingReversalOfEventCode },
            });
            if (!reversalTarget) {
                throw new common_1.BadRequestException(`Posting reversal target event ${createDto.postingReversalOfEventCode} not found`);
            }
        }
        return this.prisma.acctEvent.create({
            data: createDto,
        });
    }
    async findAll(query) {
        const { skip, take, eventCode, entityType, ownerScope, assetType, triggerType, isActive, } = query;
        const where = {};
        if (eventCode)
            where.eventCode = { contains: eventCode };
        if (entityType)
            where.entityType = entityType;
        if (ownerScope)
            where.ownerScope = ownerScope;
        if (assetType)
            where.assetType = assetType;
        if (triggerType)
            where.triggerType = triggerType;
        if (isActive)
            where.isActive = isActive === 'true';
        const [items, total] = await Promise.all([
            this.prisma.acctEvent.findMany({
                skip: skip ? Number(skip) : 0,
                take: take ? Number(take) : 20,
                where,
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.acctEvent.count({ where }),
        ]);
        return { items, total };
    }
    async findOne(eventCode) {
        const item = await this.prisma.acctEvent.findUnique({
            where: { eventCode },
            include: {
                postingReversalEvent: true,
                clearingReversalEvent: true,
            },
        });
        if (!item)
            throw new common_1.NotFoundException('AcctEvent not found');
        return item;
    }
    async update(eventCode, updateDto) {
        try {
            return await this.prisma.acctEvent.update({
                where: { eventCode },
                data: updateDto,
            });
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2025')
                    throw new common_1.NotFoundException('AcctEvent not found');
            }
            throw error;
        }
    }
    async remove(eventCode) {
        return this.update(eventCode, { isActive: false });
    }
};
exports.AcctEventsService = AcctEventsService;
exports.AcctEventsService = AcctEventsService = AcctEventsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AcctEventsService);
//# sourceMappingURL=acct-events.service.js.map