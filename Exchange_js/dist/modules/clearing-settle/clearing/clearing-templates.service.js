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
exports.ClearingTemplatesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
let ClearingTemplatesService = class ClearingTemplatesService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto) {
        const { lineTemplates, ...headerData } = dto;
        return this.prisma.clearingTemplate.create({
            data: {
                ...headerData,
                lineTemplates: lineTemplates ? {
                    create: lineTemplates
                } : undefined
            },
            include: {
                lineTemplates: true
            }
        });
    }
    async findAll(query) {
        const { skip = 0, take = 10, code, status } = query;
        const where = {};
        if (code) {
            where.code = { contains: code };
        }
        if (status) {
            where.isEnabled = status === 'ACTIVE';
        }
        const [items, total] = await Promise.all([
            this.prisma.clearingTemplate.findMany({
                where,
                skip,
                take,
                orderBy: { updatedAt: 'desc' },
                include: { lineTemplates: true }
            }),
            this.prisma.clearingTemplate.count({ where })
        ]);
        return { items, total };
    }
    async findOne(id) {
        const template = await this.prisma.clearingTemplate.findUnique({
            where: { id },
            include: { lineTemplates: true }
        });
        if (!template) {
            throw new common_1.NotFoundException(`Clearing template with ID ${id} not found`);
        }
        return template;
    }
    async update(id, dto) {
        const { lineTemplates, ...headerData } = dto;
        if (lineTemplates) {
            await this.prisma.clearingLineTemplate.deleteMany({
                where: { clearingTemplateId: id }
            });
        }
        return this.prisma.clearingTemplate.update({
            where: { id },
            data: {
                ...headerData,
                lineTemplates: lineTemplates ? {
                    create: lineTemplates
                } : undefined
            },
            include: {
                lineTemplates: true
            }
        });
    }
    async remove(id) {
        return this.prisma.clearingTemplate.delete({
            where: { id }
        });
    }
};
exports.ClearingTemplatesService = ClearingTemplatesService;
exports.ClearingTemplatesService = ClearingTemplatesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ClearingTemplatesService);
//# sourceMappingURL=clearing-templates.service.js.map