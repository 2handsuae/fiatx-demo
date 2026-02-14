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
var JournalLinesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.JournalLinesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const client_1 = require("@prisma/client");
let JournalLinesService = JournalLinesService_1 = class JournalLinesService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(JournalLinesService_1.name);
    }
    async findAll(query) {
        const { skip, take, id, journalId, journalNo, sortBy, sortOrder } = query;
        const where = {};
        if (id)
            where.id = id;
        if (journalId)
            where.journalId = { contains: journalId };
        if (journalNo)
            where.journal = { journalNo: { contains: journalNo } };
        const orderBy = {};
        if (sortBy) {
            orderBy[sortBy] = sortOrder || 'asc';
        }
        else {
            orderBy.createdAt = 'desc';
        }
        const [items, total] = await Promise.all([
            this.prisma.journalLine.findMany({
                skip: skip ? Number(skip) : 0,
                take: take ? Number(take) : 20,
                where,
                orderBy,
                include: {
                    journal: {
                        select: {
                            eventCode: true,
                            journalNo: true,
                        },
                    },
                    account: {
                        select: {
                            name: true,
                        },
                    },
                    asset: {
                        select: {
                            code: true,
                        },
                    },
                },
            }),
            this.prisma.journalLine.count({ where }),
        ]);
        const parsedItems = items.map((item) => ({
            ...item,
            dimensions: typeof item.dimensions === 'string'
                ? JSON.parse(item.dimensions)
                : item.dimensions,
        }));
        return { items: parsedItems, total };
    }
    async findOne(id) {
        const item = await this.prisma.journalLine.findUnique({
            where: { id },
            include: {
                journal: true,
                account: true,
                asset: true,
            },
        });
        if (!item)
            throw new common_1.NotFoundException('Journal line not found');
        return {
            ...item,
            dimensions: typeof item.dimensions === 'string'
                ? JSON.parse(item.dimensions)
                : item.dimensions,
        };
    }
    async getCustomerBalanceHistory(query) {
        const { customerId, assetId, startDate, endDate, skip, take } = query;
        const skipNum = skip ? Number(skip) : 0;
        const takeNum = take ? Number(take) : 20;
        const where = {
            accountCode: 'L.CLIENT_CREDIT',
            ownerType: 'CUSTOMER',
            ownerId: customerId,
            assetId: assetId,
        };
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate)
                where.createdAt.gte = new Date(startDate);
            if (endDate)
                where.createdAt.lte = new Date(endDate);
        }
        const total = await this.prisma.journalLine.count({ where });
        const pageRecords = await this.prisma.journalLine.findMany({
            where,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            skip: skipNum,
            take: takeNum,
            include: {
                journal: {
                    select: {
                        eventCode: true,
                        sourceType: true,
                        sourceId: true,
                    },
                },
                asset: {
                    select: {
                        code: true,
                        decimals: true,
                    },
                },
            },
        });
        let openingBalance = new client_1.Prisma.Decimal(0);
        if (skipNum > 0 && pageRecords.length > 0) {
            const firstRecord = pageRecords[0];
            const preSumCr = await this.prisma.journalLine.aggregate({
                _sum: { amount: true },
                where: {
                    ...where,
                    OR: [
                        { createdAt: { lt: firstRecord.createdAt } },
                        {
                            createdAt: firstRecord.createdAt,
                            id: { lt: firstRecord.id },
                        },
                    ],
                    drCr: 'CR',
                },
            });
            const preSumDr = await this.prisma.journalLine.aggregate({
                _sum: { amount: true },
                where: {
                    ...where,
                    OR: [
                        { createdAt: { lt: firstRecord.createdAt } },
                        {
                            createdAt: firstRecord.createdAt,
                            id: { lt: firstRecord.id },
                        },
                    ],
                    drCr: 'DR',
                },
            });
            openingBalance = new client_1.Prisma.Decimal(preSumCr._sum.amount || 0).minus(new client_1.Prisma.Decimal(preSumDr._sum.amount || 0));
        }
        else if (skipNum > 0 && pageRecords.length === 0) {
            const totalCr = await this.prisma.journalLine.aggregate({
                _sum: { amount: true },
                where: { ...where, drCr: 'CR' },
            });
            const totalDr = await this.prisma.journalLine.aggregate({
                _sum: { amount: true },
                where: { ...where, drCr: 'DR' },
            });
            openingBalance = new client_1.Prisma.Decimal(totalCr._sum.amount || 0).minus(new client_1.Prisma.Decimal(totalDr._sum.amount || 0));
        }
        let currentBalance = openingBalance;
        const items = pageRecords.map((line) => {
            const amount = new client_1.Prisma.Decimal(line.amount);
            const change = line.drCr === 'CR' ? amount : amount.negated();
            currentBalance = currentBalance.plus(change);
            return {
                ...line,
                changeAmount: change,
                postBalance: currentBalance,
                dimensions: typeof line.dimensions === 'string'
                    ? JSON.parse(line.dimensions)
                    : line.dimensions,
            };
        });
        return {
            items: items.reverse(),
            total,
            openingBalance: openingBalance,
            closingBalance: currentBalance,
        };
    }
};
exports.JournalLinesService = JournalLinesService;
exports.JournalLinesService = JournalLinesService = JournalLinesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], JournalLinesService);
//# sourceMappingURL=journal-lines.service.js.map