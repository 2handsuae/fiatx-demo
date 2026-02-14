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
var JournalsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.JournalsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const client_1 = require("@prisma/client");
const crypto = require("crypto");
const no_generator_util_1 = require("../../../common/utils/no-generator.util");
let JournalsService = JournalsService_1 = class JournalsService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(JournalsService_1.name);
    }
    toCanonicalSourcePath(source) {
        if (source === 'source')
            return 'src';
        if (source.startsWith('source.'))
            return `src.${source.slice('source.'.length)}`;
        return source;
    }
    resolveTemplateValue(source, context) {
        if (!source)
            return null;
        const normalizedSource = this.toCanonicalSourcePath(source);
        if (normalizedSource.startsWith('FIXED_')) {
            return normalizedSource.replace('FIXED_', '');
        }
        if (normalizedSource.includes('.')) {
            const keys = normalizedSource.split('.');
            let value = context;
            for (const key of keys) {
                if (value && Object.prototype.hasOwnProperty.call(value, key)) {
                    value = value[key];
                }
                else {
                    return null;
                }
            }
            return value !== undefined ? String(value) : null;
        }
        if (context &&
            Object.prototype.hasOwnProperty.call(context, normalizedSource)) {
            return String(context[normalizedSource]);
        }
        return normalizedSource;
    }
    processTemplateString(templateStr, context) {
        if (!templateStr || templateStr === '{}')
            return templateStr || '{}';
        try {
            let result = templateStr;
            result = result.replace(/\{\{([\w\.]+)\}\}/g, (match, path) => {
                const val = this.resolveTemplateValue(path, context);
                return val !== null ? val : match;
            });
            return result;
        }
        catch (e) {
            this.logger.error('Error processing template string', e);
            return templateStr;
        }
    }
    parseDecimal(value) {
        if (value === null || value === undefined)
            return new client_1.Prisma.Decimal(0);
        if (value instanceof client_1.Prisma.Decimal)
            return value;
        return new client_1.Prisma.Decimal(value);
    }
    assertJournalBalancedByAsset(lines, eventCode) {
        const balanceByAsset = new Map();
        for (const line of lines) {
            if (!line.assetId) {
                throw new common_1.BadRequestException({
                    code: 'JOURNAL_IMBALANCED',
                    message: `Missing assetId on journal line ${line.lineNo} (${eventCode})`,
                });
            }
            const amount = this.parseDecimal(line.amount);
            if (amount.lt(0)) {
                throw new common_1.BadRequestException({
                    code: 'JOURNAL_IMBALANCED',
                    message: `Negative amount on journal line ${line.lineNo} (${eventCode})`,
                });
            }
            const bucket = balanceByAsset.get(line.assetId) || {
                dr: new client_1.Prisma.Decimal(0),
                cr: new client_1.Prisma.Decimal(0),
            };
            if (line.drCr === 'DR') {
                bucket.dr = bucket.dr.plus(amount);
            }
            else if (line.drCr === 'CR') {
                bucket.cr = bucket.cr.plus(amount);
            }
            else {
                throw new common_1.BadRequestException({
                    code: 'JOURNAL_IMBALANCED',
                    message: `Invalid drCr "${line.drCr}" on journal line ${line.lineNo} (${eventCode})`,
                });
            }
            balanceByAsset.set(line.assetId, bucket);
        }
        for (const [assetId, totals] of balanceByAsset.entries()) {
            if (!totals.dr.eq(totals.cr)) {
                throw new common_1.BadRequestException({
                    code: 'JOURNAL_IMBALANCED',
                    message: `Journal not balanced for asset ${assetId} (${eventCode}), DR=${totals.dr.toString()} CR=${totals.cr.toString()}`,
                });
            }
        }
    }
    async getCustomerLiabilityBalance(params, tx) {
        const { ownerId, assetId, ownerType = 'CUSTOMER' } = params;
        const client = tx || this.prisma;
        const [creditCr, creditDr, heldCr, heldDr] = await Promise.all([
            client.journalLine.aggregate({
                _sum: { amount: true },
                where: {
                    accountCode: 'L.CLIENT_CREDIT',
                    ownerType,
                    ownerId,
                    assetId,
                    drCr: 'CR',
                },
            }),
            client.journalLine.aggregate({
                _sum: { amount: true },
                where: {
                    accountCode: 'L.CLIENT_CREDIT',
                    ownerType,
                    ownerId,
                    assetId,
                    drCr: 'DR',
                },
            }),
            client.journalLine.aggregate({
                _sum: { amount: true },
                where: {
                    accountCode: 'L.CLIENT_HELD',
                    ownerType,
                    ownerId,
                    assetId,
                    drCr: 'CR',
                },
            }),
            client.journalLine.aggregate({
                _sum: { amount: true },
                where: {
                    accountCode: 'L.CLIENT_HELD',
                    ownerType,
                    ownerId,
                    assetId,
                    drCr: 'DR',
                },
            }),
        ]);
        const creditBalance = this.parseDecimal(creditCr?._sum?.amount).minus(this.parseDecimal(creditDr?._sum?.amount));
        const heldBalance = this.parseDecimal(heldCr?._sum?.amount).minus(this.parseDecimal(heldDr?._sum?.amount));
        const availableBalance = creditBalance;
        return {
            ownerId,
            ownerType,
            assetId,
            availableBalance,
            creditBalance,
            heldBalance,
        };
    }
    async createJournal(params, tx) {
        const { sourceType, sourceId, eventCode, context } = params;
        const client = tx || this.prisma;
        const existing = await client.journal.findFirst({
            where: { sourceType, sourceId, eventCode },
            include: { lines: true },
        });
        if (existing) {
            this.logger.log(`Journal entry already exists for ${sourceType} ${sourceId} event ${eventCode}`);
            return existing;
        }
        const template = await client.journalHeaderTemplate.findFirst({
            where: { eventCode, status: 'ACTIVE' },
            include: { journalLineTemplates: true },
        });
        if (!template) {
            this.logger.error(`No active journal template found for event ${eventCode}. Please check JournalHeaderTemplate table.`);
            throw new common_1.NotFoundException(`No active journal template found for event ${eventCode}`);
        }
        this.logger.log(`Creating journal entry using template ${template.templateCode}`);
        let sourceNo = null;
        try {
            if (sourceType === 'DEPOSIT') {
                sourceNo = context.src.depositNo;
            }
            else if (sourceType === 'SWAP') {
                const source = await client.swapTransaction.findUnique({ where: { id: sourceId }, select: { swapNo: true } });
                sourceNo = source?.swapNo;
            }
            else if (sourceType === 'WITHDRAWAL' || sourceType === 'WITHDRAW') {
                const source = await client.withdrawTransaction.findUnique({ where: { id: sourceId }, select: { withdrawNo: true } });
                sourceNo = source?.withdrawNo;
            }
            else if (sourceType === 'PAYIN') {
                const source = await client.payin.findUnique({ where: { id: sourceId }, select: { payinNo: true } });
                sourceNo = source?.payinNo;
            }
            else if (sourceType === 'PAYOUT') {
                const source = await client.payout.findUnique({ where: { id: sourceId }, select: { payoutNo: true } });
                sourceNo = source?.payoutNo;
            }
            else if (sourceType === 'CLEARING') {
                const source = await client.clearing.findUnique({ where: { id: sourceId }, select: { clearingNo: true } });
                sourceNo = source?.clearingNo;
            }
        }
        catch (e) {
        }
        const journalId = crypto.randomUUID();
        const linesCreateInput = [];
        for (const lineTemplate of template.journalLineTemplates) {
            let amount = new client_1.Prisma.Decimal(0);
            if (lineTemplate.amountSource === 'AMOUNT') {
                amount = new client_1.Prisma.Decimal(context.src.amount || 0);
            }
            else if (lineTemplate.amountSource === 'NET_AMOUNT') {
                amount = new client_1.Prisma.Decimal(context.src.netAmount || 0);
            }
            else if (lineTemplate.amountSource === 'FROM_AMOUNT') {
                amount = new client_1.Prisma.Decimal(context.src.fromAmount || 0);
            }
            else if (lineTemplate.amountSource === 'TO_AMOUNT') {
                amount = new client_1.Prisma.Decimal(context.src.toAmount || 0);
            }
            else if (lineTemplate.amountSource === 'FEE_AMOUNT') {
                amount = new client_1.Prisma.Decimal(context.src.feeAmount || 0);
            }
            let assetId = context.src.assetId;
            if (lineTemplate.assetSource === 'FROM_ASSET_ID') {
                assetId = context.src.fromAssetId;
            }
            else if (lineTemplate.assetSource === 'TO_ASSET_ID') {
                assetId = context.src.toAssetId;
            }
            else if (lineTemplate.assetSource === 'FEE_ASSET_ID') {
                assetId = context.src.feeAssetId;
            }
            const ownerType = this.resolveTemplateValue(lineTemplate.ownerTypeSource, context) ||
                'PLATFORM';
            const ownerId = this.resolveTemplateValue(lineTemplate.ownerIdSource, context);
            const fxRateVal = this.resolveTemplateValue(lineTemplate.fxRateSource, context);
            const fxRate = fxRateVal ? new client_1.Prisma.Decimal(fxRateVal) : null;
            const referenceId = this.resolveTemplateValue(lineTemplate.referenceSource, context);
            const dimensions = this.processTemplateString(lineTemplate.dimensionsRule, context);
            const description = this.processTemplateString(lineTemplate.description || template.description, context);
            linesCreateInput.push({
                id: `JEL_${crypto.randomUUID()}`,
                journalId,
                lineNo: lineTemplate.lineNo,
                accountCode: lineTemplate.accountCode,
                drCr: lineTemplate.drCr,
                amount,
                assetId,
                fxRate,
                referenceId,
                ownerType,
                ownerId,
                dimensions,
                description,
                journalLineTemplateId: lineTemplate.id,
            });
        }
        this.assertJournalBalancedByAsset(linesCreateInput.map((line) => ({
            lineNo: line.lineNo,
            drCr: line.drCr,
            amount: this.parseDecimal(line.amount),
            assetId: line.assetId,
        })), eventCode);
        const executeCreate = async (transactionClient) => {
            try {
                const createdJournal = await transactionClient.journal.create({
                    data: {
                        id: journalId,
                        journalNo: (0, no_generator_util_1.generateReferenceNo)('JO'),
                        sourceType,
                        sourceId,
                        sourceNo,
                        eventCode,
                        postingStatus: 'POSTED',
                        baseAssetId: template.baseAssetId,
                        postedAt: new Date(),
                        description: this.processTemplateString(template.description, context),
                        totalAmount: new client_1.Prisma.Decimal(context.src.amount || 0),
                        journalHeaderTemplateId: template.id,
                    },
                });
                if (linesCreateInput.length > 0) {
                    await transactionClient.journalLine.createMany({ data: linesCreateInput });
                }
                return createdJournal;
            }
            catch (error) {
                this.logger.error(`Failed to create journal entry for ${eventCode}: ${error.message}`, error.stack);
                throw error;
            }
        };
        if (tx) {
            return executeCreate(tx);
        }
        else {
            return this.prisma.$transaction(async (transactionClient) => {
                return executeCreate(transactionClient);
            });
        }
    }
    async triggerEvent(params, tx) {
        const { entityType, triggerKey, fromStatus, toStatus, assetType, context, sourceId, } = params;
        const client = tx || this.prisma;
        const event = await client.acctEvent.findFirst({
            where: {
                entityType,
                triggerType: 'STATUS_TRANSITION',
                triggerKey,
                isActive: true,
                OR: [
                    { fromStatus: fromStatus || null },
                    { fromStatus: null },
                ],
                toStatus,
                assetType: { in: [assetType, 'ALL'] },
            },
        });
        if (!event) {
            this.logger.warn(`No matching accounting event found for ${entityType} ${triggerKey} ${fromStatus}->${toStatus} (${assetType}). Please check AcctEvent table.`);
            return null;
        }
        this.logger.log(`Matched Accounting Event: ${event.eventCode}`);
        if (event.postingMode === 'AUTO_REVERSAL') {
            return this.reverseJournal({
                sourceType: entityType,
                sourceId,
                reversalEventCode: event.eventCode,
                targetEventCode: event.postingReversalOfEventCode,
                context,
            }, tx);
        }
        return this.createJournal({
            sourceType: entityType,
            sourceId,
            eventCode: event.eventCode,
            context,
        }, tx);
    }
    async reverseJournal(params, tx) {
        const { sourceType, sourceId, reversalEventCode, targetEventCode, context } = params;
        const client = tx || this.prisma;
        const existing = await client.journal.findFirst({
            where: { sourceType, sourceId, eventCode: reversalEventCode },
        });
        if (existing) {
            this.logger.log(`Reversal journal already exists for ${sourceType} ${sourceId} event ${reversalEventCode}`);
            return existing;
        }
        const originalJournal = await client.journal.findFirst({
            where: { sourceType, sourceId, eventCode: targetEventCode },
            include: { lines: true },
        });
        if (!originalJournal) {
            this.logger.error(`Cannot perform AUTO_REVERSAL: Original journal not found for ${sourceType} ${sourceId} event ${targetEventCode}`);
            return null;
        }
        this.logger.log(`Performing AUTO_REVERSAL of journal ${originalJournal.id} (Event: ${targetEventCode})`);
        const reversalJournalId = crypto.randomUUID();
        const reversalLines = originalJournal.lines.map((line) => ({
            id: `JEL_${crypto.randomUUID()}`,
            journalId: reversalJournalId,
            lineNo: line.lineNo,
            accountCode: line.accountCode,
            drCr: line.drCr === 'DR' ? 'CR' : 'DR',
            amount: line.amount,
            assetId: line.assetId,
            fxRate: line.fxRate,
            ownerType: line.ownerType,
            ownerId: line.ownerId,
            dimensions: line.dimensions,
            referenceId: line.referenceId,
            description: `[REVERSAL] ${line.description}`,
            journalLineTemplateId: line.journalLineTemplateId,
        }));
        const executeReverse = async (transactionClient) => {
            const createdJournal = await transactionClient.journal.create({
                data: {
                    id: reversalJournalId,
                    journalNo: (0, no_generator_util_1.generateReferenceNo)('JO'),
                    sourceType,
                    sourceId,
                    eventCode: reversalEventCode,
                    postingStatus: 'POSTED',
                    baseAssetId: originalJournal.baseAssetId,
                    reversalOfJournalId: originalJournal.id,
                    postedAt: new Date(),
                    description: `[REVERSAL] ${originalJournal.description}`,
                    totalAmount: originalJournal.totalAmount,
                    journalHeaderTemplateId: originalJournal.journalHeaderTemplateId,
                },
            });
            if (reversalLines.length > 0) {
                await transactionClient.journalLine.createMany({ data: reversalLines });
            }
            return createdJournal;
        };
        if (tx) {
            return executeReverse(tx);
        }
        else {
            return this.prisma.$transaction(async (transactionClient) => {
                return executeReverse(transactionClient);
            });
        }
    }
    async createDepositJournal(depositId, eventCode, amount, assetId, ownerId) {
        const deposit = await this.prisma.depositTransaction.findUnique({
            where: { id: depositId },
        });
        const context = {
            src: {
                ownerId,
                ownerType: deposit?.ownerType || 'CUSTOMER',
                assetId,
                depositId,
                amount,
                depositNo: deposit?.depositNo,
                walletId: deposit?.toWalletId,
            },
        };
        return this.createJournal({
            sourceType: 'DEPOSIT',
            sourceId: depositId,
            eventCode,
            context,
        });
    }
    async findAll(query) {
        const { skip, take, id, sourceType, eventCode, postingStatus, baseAssetId, createdAtStart, createdAtEnd, postedAtStart, postedAtEnd, sortBy, sortOrder, } = query;
        const where = {};
        if (id)
            where.id = { contains: id };
        if (sourceType)
            where.sourceType = sourceType;
        if (eventCode)
            where.eventCode = { contains: eventCode };
        if (postingStatus)
            where.postingStatus = postingStatus;
        if (baseAssetId)
            where.baseAssetId = baseAssetId;
        if (createdAtStart || createdAtEnd) {
            where.createdAt = {};
            if (createdAtStart)
                where.createdAt.gte = new Date(createdAtStart);
            if (createdAtEnd)
                where.createdAt.lte = new Date(createdAtEnd);
        }
        if (postedAtStart || postedAtEnd) {
            where.postedAt = {};
            if (postedAtStart)
                where.postedAt.gte = new Date(postedAtStart);
            if (postedAtEnd)
                where.postedAt.lte = new Date(postedAtEnd);
        }
        const orderBy = {};
        if (sortBy) {
            orderBy[sortBy] = sortOrder || 'asc';
        }
        else {
            orderBy.createdAt = 'desc';
        }
        const [items, total] = await Promise.all([
            this.prisma.journal.findMany({
                skip: skip ? Number(skip) : 0,
                take: take ? Number(take) : 20,
                where,
                orderBy,
                include: {
                    baseAsset: {
                        select: {
                            code: true,
                            type: true,
                        },
                    },
                },
            }),
            this.prisma.journal.count({ where }),
        ]);
        const itemsWithSourceNo = items;
        return { items: itemsWithSourceNo, total };
    }
    async findOne(id) {
        const item = await this.prisma.journal.findUnique({
            where: { id },
            include: {
                baseAsset: true,
            },
        });
        if (!item)
            throw new common_1.NotFoundException('Journal entry not found');
        return item;
    }
};
exports.JournalsService = JournalsService;
exports.JournalsService = JournalsService = JournalsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], JournalsService);
//# sourceMappingURL=journals.service.js.map