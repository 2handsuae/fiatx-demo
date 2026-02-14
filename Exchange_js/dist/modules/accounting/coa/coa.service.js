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
var CoaService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoaService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const client_1 = require("@prisma/client");
let CoaService = CoaService_1 = class CoaService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(CoaService_1.name);
    }
    async create(createCoaDto) {
        const { requiredTags, ...rest } = createCoaDto;
        const existing = await this.prisma.coa.findUnique({
            where: { code: createCoaDto.code },
        });
        if (existing) {
            throw new common_1.BadRequestException(`Coa with code ${createCoaDto.code} already exists`);
        }
        const item = await this.prisma.coa.create({
            data: {
                ...rest,
                requiredTags: JSON.stringify(requiredTags || []),
            },
        });
        return {
            ...item,
            requiredTags: JSON.parse(item.requiredTags),
        };
    }
    async findAll(query) {
        const { skip, take, code, name, sortBy, sortOrder } = query;
        const where = {};
        if (code)
            where.code = { contains: code };
        if (name)
            where.name = { contains: name };
        const orderBy = {};
        if (sortBy) {
            orderBy[sortBy] =
                sortOrder || 'asc';
        }
        else {
            orderBy.code = 'asc';
        }
        const [items, total] = await Promise.all([
            this.prisma.coa.findMany({
                skip: skip ? Number(skip) : 0,
                take: take ? Number(take) : 20,
                where,
                orderBy,
            }),
            this.prisma.coa.count({ where }),
        ]);
        const parsedItems = items.map((item) => ({
            ...item,
            requiredTags: JSON.parse(item.requiredTags),
        }));
        return { items: parsedItems, total };
    }
    async findOne(id) {
        const item = await this.prisma.coa.findUnique({ where: { id } });
        if (!item)
            throw new common_1.NotFoundException('Coa not found');
        return {
            ...item,
            requiredTags: JSON.parse(item.requiredTags),
        };
    }
    async update(id, updateCoaDto) {
        const { requiredTags, ...rest } = updateCoaDto;
        const data = { ...rest };
        if (requiredTags) {
            data.requiredTags = JSON.stringify(requiredTags);
        }
        try {
            const item = await this.prisma.coa.update({
                where: { id },
                data,
            });
            return {
                ...item,
                requiredTags: JSON.parse(item.requiredTags),
            };
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2025')
                    throw new common_1.NotFoundException('Coa not found');
            }
            throw error;
        }
    }
    async remove(id) {
        try {
            return await this.prisma.coa.delete({ where: { id } });
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2025')
                    throw new common_1.NotFoundException('Coa not found');
            }
            throw error;
        }
    }
};
exports.CoaService = CoaService;
exports.CoaService = CoaService = CoaService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CoaService);
//# sourceMappingURL=coa.service.js.map