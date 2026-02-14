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
exports.ClearingsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const client_1 = require("@prisma/client");
const no_generator_util_1 = require("../../../common/utils/no-generator.util");
let ClearingsService = class ClearingsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    toCanonicalSourcePath(expr) {
        if (expr === 'source')
            return 'src';
        if (expr.startsWith('source.'))
            return `src.${expr.slice('source.'.length)}`;
        return expr;
    }
    resolveTemplatePath(context, expr) {
        const normalized = this.toCanonicalSourcePath(expr.trim());
        const keys = normalized.split('.');
        let value = context;
        for (const key of keys) {
            if (value && Object.prototype.hasOwnProperty.call(value, key)) {
                value = value[key];
            }
            else {
                return undefined;
            }
        }
        return value;
    }
    evalDecimal(expr, context, field) {
        const value = this.resolveTemplatePath(context, expr);
        if (value === undefined || value === null || value === '') {
            throw new common_1.BadRequestException({
                code: 'CLEARING_TEMPLATE_EVAL_FAILED',
                message: `Clearing template field "${field}" cannot be resolved from "${expr}"`,
            });
        }
        try {
            const amount = new client_1.Prisma.Decimal(value);
            if (amount.lt(0)) {
                throw new common_1.BadRequestException({
                    code: 'CLEARING_TEMPLATE_EVAL_FAILED',
                    message: `Clearing template field "${field}" resolved to negative value`,
                });
            }
            return amount;
        }
        catch (error) {
            if (error instanceof common_1.BadRequestException)
                throw error;
            throw new common_1.BadRequestException({
                code: 'CLEARING_TEMPLATE_EVAL_FAILED',
                message: `Clearing template field "${field}" is not a valid decimal`,
            });
        }
    }
    evalString(expr, context, field, required = true) {
        const value = this.resolveTemplatePath(context, expr);
        if (value === undefined || value === null || value === '') {
            if (!required)
                return null;
            throw new common_1.BadRequestException({
                code: 'CLEARING_TEMPLATE_EVAL_FAILED',
                message: `Clearing template field "${field}" cannot be resolved from "${expr}"`,
            });
        }
        return String(value);
    }
    async triggerClearing(params, tx) {
        const { sourceType, sourceId, eventCode, context } = params;
        const client = tx || this.prisma;
        const existing = await client.clearing.findFirst({
            where: { sourceType, sourceId, clearingType: eventCode },
        });
        if (existing) {
            return existing;
        }
        const event = await client.acctEvent.findUnique({
            where: { eventCode },
        });
        if (!event || !event.clearingTemplateCode) {
            return null;
        }
        const template = await client.clearingTemplate.findUnique({
            where: { code: event.clearingTemplateCode },
            include: { lineTemplates: true },
        });
        if (!template) {
            throw new common_1.BadRequestException({
                code: 'CLEARING_TEMPLATE_EVAL_FAILED',
                message: `Clearing template "${event.clearingTemplateCode}" not found`,
            });
        }
        const executeCreate = async (transactionClient) => {
            const outAssetId = this.evalString(template.outAssetSource, context, 'outAssetSource');
            const outAmount = this.evalDecimal(template.outAmountSource, context, 'outAmountSource');
            const inAssetId = this.evalString(template.inAssetSource, context, 'inAssetSource');
            const inAmount = this.evalDecimal(template.inAmountSource, context, 'inAmountSource');
            const feeAssetId = this.evalString(template.feeAssetSource, context, 'feeAssetSource');
            const feeAmount = this.evalDecimal(template.feeAmountSource, context, 'feeAmountSource');
            const outPayoutId = template.outPayoutIdSource
                ? this.evalString(template.outPayoutIdSource, context, 'outPayoutIdSource', false)
                : null;
            const inPayinId = template.inPayinIdSource
                ? this.evalString(template.inPayinIdSource, context, 'inPayinIdSource', false)
                : null;
            if (sourceType === 'WITHDRAWAL') {
                await transactionClient.withdrawTransaction.update({
                    where: { id: sourceId },
                    data: {
                        feeAmount,
                        netAmount: inAmount,
                    }
                });
            }
            const clearing = await transactionClient.clearing.create({
                data: {
                    clearingNo: (0, no_generator_util_1.generateReferenceNo)('CL'),
                    clearingType: eventCode,
                    sourceType,
                    sourceId,
                    outAssetId,
                    outAmount,
                    inAssetId,
                    inAmount,
                    feeAssetId,
                    feeAmount,
                    feeMethod: template.feeMethod,
                    outPayoutId,
                    inPayinId,
                    clearingStatus: 'CLEARED',
                    memo: template.memoTemplate || `Auto clearing for ${eventCode}`,
                },
            });
            for (const lt of template.lineTemplates) {
                const lineAmount = this.evalDecimal(lt.amountSource, context, `lineTemplates[${lt.lineNo}].amountSource`);
                const lineAssetId = this.evalString(lt.assetSource, context, `lineTemplates[${lt.lineNo}].assetSource`);
                const linePartyId = lt.partyIdSource
                    ? this.evalString(lt.partyIdSource, context, `lineTemplates[${lt.lineNo}].partyIdSource`, false)
                    : null;
                const lineRefId = lt.refIdSource
                    ? this.evalString(lt.refIdSource, context, `lineTemplates[${lt.lineNo}].refIdSource`, false)
                    : null;
                await transactionClient.clearingLine.create({
                    data: {
                        clearingId: clearing.id,
                        lineNo: lt.lineNo,
                        lineType: lt.lineType,
                        partyType: lt.partyType,
                        partyId: linePartyId,
                        assetId: lineAssetId,
                        amount: lineAmount,
                        refType: lt.refTypeConst || null,
                        refId: lineRefId,
                    },
                });
            }
            return clearing;
        };
        if (tx) {
            return executeCreate(tx);
        }
        return await this.prisma.$transaction(async (transactionClient) => {
            return executeCreate(transactionClient);
        });
    }
    async findAll(query) {
        const { skip = 0, take = 10, sourceId, clearingStatus, sortBy, sortOrder } = query;
        const where = {};
        if (sourceId) {
            where.sourceId = { contains: sourceId };
        }
        if (clearingStatus) {
            where.clearingStatus = clearingStatus;
        }
        const orderBy = {};
        if (sortBy) {
            orderBy[sortBy] = sortOrder || 'asc';
        }
        else {
            orderBy.createdAt = 'desc';
        }
        const [items, total] = await Promise.all([
            this.prisma.clearing.findMany({
                where,
                skip,
                take,
                orderBy,
                include: {
                    lines: true,
                    outPayout: true,
                    inPayin: true,
                },
            }),
            this.prisma.clearing.count({ where }),
        ]);
        const enrichedItems = await Promise.all(items.map(async (item) => {
            let outAssetNo = null;
            let inAssetNo = null;
            let sourceNo = null;
            if (item.outAssetId) {
                const asset = await this.prisma.asset.findUnique({ where: { id: item.outAssetId }, select: { code: true } });
                outAssetNo = asset?.code;
            }
            if (item.inAssetId) {
                const asset = await this.prisma.asset.findUnique({ where: { id: item.inAssetId }, select: { code: true } });
                inAssetNo = asset?.code;
            }
            if (item.sourceId) {
                try {
                    if (item.sourceType === 'WITHDRAWAL') {
                        const src = await this.prisma.withdrawTransaction.findUnique({ where: { id: item.sourceId }, select: { withdrawNo: true } });
                        sourceNo = src?.withdrawNo;
                    }
                    else if (item.sourceType === 'DEPOSIT') {
                        const src = await this.prisma.depositTransaction.findUnique({ where: { id: item.sourceId }, select: { depositNo: true } });
                        sourceNo = src?.depositNo;
                    }
                    else if (item.sourceType === 'SWAP') {
                        const src = await this.prisma.swapTransaction.findUnique({ where: { id: item.sourceId }, select: { swapNo: true } });
                        sourceNo = src?.swapNo;
                    }
                }
                catch (e) { }
            }
            return {
                ...item,
                outAssetNo,
                inAssetNo,
                sourceNo
            };
        }));
        return { items: enrichedItems, total };
    }
    async findOne(id) {
        const clearing = await this.prisma.clearing.findUnique({
            where: { id },
            include: {
                lines: {
                    orderBy: { lineNo: 'asc' },
                },
                outPayout: true,
                inPayin: true,
            },
        });
        if (!clearing) {
            throw new common_1.NotFoundException(`Clearing with ID ${id} not found`);
        }
        const [outAsset, inAsset, feeAsset] = await Promise.all([
            this.prisma.asset.findUnique({ where: { id: clearing.outAssetId } }),
            this.prisma.asset.findUnique({ where: { id: clearing.inAssetId } }),
            clearing.feeAssetId ? this.prisma.asset.findUnique({ where: { id: clearing.feeAssetId } }) : null
        ]);
        return {
            ...clearing,
            outAssetNo: outAsset?.code || null,
            inAssetNo: inAsset?.code || null,
            feeAssetNo: feeAsset?.code || null,
            outPayoutNo: clearing.outPayout?.payoutNo || null,
            inPayinNo: clearing.inPayin?.payinNo || null
        };
    }
    async findLine(id) {
        const line = await this.prisma.clearingLine.findUnique({
            where: { id },
            include: {
                clearing: {
                    select: { clearingNo: true }
                }
            }
        });
        if (!line) {
            throw new common_1.NotFoundException(`Clearing Line with ID ${id} not found`);
        }
        let partyNo = null;
        if (line.partyId) {
            try {
                if (line.partyType === 'CUSTOMER') {
                    const source = await this.prisma.customerMain.findUnique({ where: { id: line.partyId }, select: { customerNo: true } });
                    partyNo = source?.customerNo;
                }
                else if (line.partyType === 'LIQUIDITY_PROVIDER') {
                    const source = await this.prisma.liquidityProvider.findUnique({ where: { id: line.partyId }, select: { lpNo: true } });
                    partyNo = source?.lpNo;
                }
            }
            catch (e) { }
        }
        let assetCode = null;
        try {
            const asset = await this.prisma.asset.findUnique({ where: { id: line.assetId }, select: { code: true } });
            assetCode = asset?.code;
        }
        catch (e) { }
        return {
            ...line,
            clearingNo: line.clearing?.clearingNo,
            partyNo,
            assetCode
        };
    }
    async findAllLines(query) {
        const { skip, take, clearingId, sortBy, sortOrder } = query;
        const where = {};
        if (clearingId) {
            where.clearingId = clearingId;
        }
        const orderBy = {};
        if (sortBy) {
            orderBy[sortBy] = sortOrder || 'asc';
        }
        else {
            orderBy.createdAt = 'desc';
        }
        const [items, total] = await Promise.all([
            this.prisma.clearingLine.findMany({
                where,
                skip: skip ? Number(skip) : 0,
                take: take ? Number(take) : 10,
                orderBy,
                include: {
                    clearing: true,
                },
            }),
            this.prisma.clearingLine.count({ where }),
        ]);
        const itemsWithNo = await Promise.all(items.map(async (item) => {
            let partyNo = null;
            if (item.partyId) {
                try {
                    if (item.partyType === 'CUSTOMER') {
                        const source = await this.prisma.customerMain.findUnique({ where: { id: item.partyId }, select: { customerNo: true } });
                        partyNo = source?.customerNo;
                    }
                    else if (item.partyType === 'LIQUIDITY_PROVIDER') {
                        const source = await this.prisma.liquidityProvider.findUnique({ where: { id: item.partyId }, select: { lpNo: true } });
                        partyNo = source?.lpNo;
                    }
                }
                catch (e) { }
            }
            let assetNo = null;
            if (item.assetId) {
                const asset = await this.prisma.asset.findUnique({ where: { id: item.assetId }, select: { code: true } });
                assetNo = asset?.code;
            }
            return {
                ...item,
                partyNo,
                assetNo
            };
        }));
        return { items: itemsWithNo, total };
    }
    async reClear(id) {
        const clearing = await this.findOne(id);
        return this.prisma.clearing.update({
            where: { id },
            data: { updatedAt: new Date() },
            include: { lines: true },
        });
    }
    async updateStatusBySource(sourceId, status, tx) {
        const client = tx || this.prisma;
        return client.clearing.updateMany({
            where: { sourceId },
            data: { clearingStatus: status, updatedAt: new Date() },
        });
    }
};
exports.ClearingsService = ClearingsService;
exports.ClearingsService = ClearingsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ClearingsService);
//# sourceMappingURL=clearings.service.js.map