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
var JournalLineTemplatesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.JournalLineTemplatesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const client_1 = require("@prisma/client");
let JournalLineTemplatesService = JournalLineTemplatesService_1 = class JournalLineTemplatesService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(JournalLineTemplatesService_1.name);
    }
    async create(createDto) {
        const header = await this.prisma.journalHeaderTemplate.findUnique({
            where: { id: createDto.templateId },
        });
        if (!header)
            throw new common_1.BadRequestException(`Journal Header Template ${createDto.templateId} not found`);
        const coa = await this.prisma.coa.findUnique({
            where: { code: createDto.accountCode },
        });
        if (!coa)
            throw new common_1.BadRequestException(`Account Code ${createDto.accountCode} not found`);
        const existing = await this.prisma.journalLineTemplate.findUnique({
            where: {
                templateId_lineNo: {
                    templateId: createDto.templateId,
                    lineNo: createDto.lineNo,
                },
            },
        });
        if (existing)
            throw new common_1.BadRequestException(`Line No ${createDto.lineNo} already exists for this template`);
        return this.prisma.journalLineTemplate.create({
            data: {
                ...createDto,
                dimensionsRule: createDto.dimensionsRule || '{}',
            },
        });
    }
    async findAll(query) {
        const where = {};
        if (query.templateId)
            where.templateId = query.templateId;
        return this.prisma.journalLineTemplate.findMany({
            where,
            orderBy: { lineNo: 'asc' },
            include: {
                account: true,
            },
        });
    }
    async findOne(id) {
        const item = await this.prisma.journalLineTemplate.findUnique({
            where: { id },
            include: {
                account: true,
            },
        });
        if (!item)
            throw new common_1.NotFoundException('Line Template not found');
        return item;
    }
    async update(id, updateDto) {
        if (updateDto.accountCode) {
            const coa = await this.prisma.coa.findUnique({
                where: { code: updateDto.accountCode },
            });
            if (!coa)
                throw new common_1.BadRequestException(`Account Code ${updateDto.accountCode} not found`);
        }
        try {
            return await this.prisma.journalLineTemplate.update({
                where: { id },
                data: updateDto,
            });
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2025')
                    throw new common_1.NotFoundException('Line Template not found');
            }
            throw error;
        }
    }
    async remove(id) {
        try {
            return await this.prisma.journalLineTemplate.delete({
                where: { id },
            });
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2025')
                    throw new common_1.NotFoundException('Line Template not found');
            }
            throw error;
        }
    }
    async reorderLines(templateId, lines) {
        return this.prisma.$transaction(lines.map((line) => this.prisma.journalLineTemplate.update({
            where: { id: line.id },
            data: { lineNo: line.lineNo },
        })));
    }
};
exports.JournalLineTemplatesService = JournalLineTemplatesService;
exports.JournalLineTemplatesService = JournalLineTemplatesService = JournalLineTemplatesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], JournalLineTemplatesService);
//# sourceMappingURL=journal-line-templates.service.js.map