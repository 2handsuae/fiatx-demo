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
var SwapTransactionsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapTransactionsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const swap_transaction_dto_1 = require("./dto/swap-transaction.dto");
const client_1 = require("@prisma/client");
const axios_1 = require("axios");
const event_emitter_1 = require("@nestjs/event-emitter");
const swap_events_constant_1 = require("./constants/swap-events.constant");
const no_generator_util_1 = require("../../../common/utils/no-generator.util");
let SwapTransactionsService = SwapTransactionsService_1 = class SwapTransactionsService {
    constructor(prisma, eventEmitter) {
        this.prisma = prisma;
        this.eventEmitter = eventEmitter;
        this.logger = new common_1.Logger(SwapTransactionsService_1.name);
        this.AED_USD_RATE = 3.6725;
    }
    async create(dto) {
        const swapNo = (0, no_generator_util_1.generateReferenceNo)('SWP');
        const fromAsset = await this.prisma.asset.findUnique({ where: { id: dto.fromAssetId } });
        const toAsset = await this.prisma.asset.findUnique({ where: { id: dto.toAssetId } });
        let ownerNo = null;
        if (dto.ownerType === 'CUSTOMER') {
            const customer = await this.prisma.customerMain.findUnique({ where: { id: dto.ownerId } });
            if (customer)
                ownerNo = customer.customerNo;
        }
        const swap = await this.prisma.swapTransaction.create({
            data: {
                swapNo,
                ownerType: dto.ownerType,
                ownerId: dto.ownerId,
                ownerNo,
                status: swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE,
                fromAssetId: dto.fromAssetId,
                fromAssetCode: fromAsset?.code,
                fromAmount: new client_1.Prisma.Decimal(dto.fromAmount),
                toAssetId: dto.toAssetId,
                toAssetCode: toAsset?.code,
                toAmount: new client_1.Prisma.Decimal(dto.toAmount),
                exchangeRate: new client_1.Prisma.Decimal(dto.exchangeRate),
                statusHistory: JSON.stringify([{
                        status: swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE,
                        timestamp: new Date().toISOString(),
                        operator: 'SYSTEM',
                        note: 'Swap created'
                    }]),
            },
        });
        this.logger.log(`Swap created: ${swap.id} (${swap.swapNo})`);
        this.eventEmitter.emit(swap_events_constant_1.SwapEvents.EVT_SWAP_CREATED, { swapId: swap.id });
        return swap;
    }
    async updateStatus(id, newStatus, operatorId = 'SYSTEM', reason) {
        const swap = await this.findOne(id);
        const oldStatus = swap.status;
        if (oldStatus === newStatus)
            return swap;
        const updatedSwap = await this.prisma.$transaction(async (tx) => {
            let history = [];
            try {
                if (swap.statusHistory) {
                    history = JSON.parse(swap.statusHistory);
                }
            }
            catch (e) {
            }
            history.push({
                status: newStatus,
                timestamp: new Date().toISOString(),
                operator: operatorId,
                note: reason || `Status changed from ${oldStatus} to ${newStatus}`
            });
            const updated = await tx.swapTransaction.update({
                where: { id },
                data: {
                    status: newStatus,
                    statusHistory: JSON.stringify(history),
                    completedAt: newStatus === swap_transaction_dto_1.SwapTransactionStatus.SUCCESS ? new Date() : null,
                },
            });
            await tx.swapTransactionAuditLog.create({
                data: {
                    swapTransactionId: id,
                    operatorId,
                    oldStatus,
                    newStatus,
                    reason,
                },
            });
            return updated;
        });
        this.logger.log(`Swap ${id} status changed: ${oldStatus} -> ${newStatus}`);
        if (newStatus === swap_transaction_dto_1.SwapTransactionStatus.SUCCESS) {
            this.eventEmitter.emit(swap_events_constant_1.SwapEvents.EVT_SWAP_SUCCESS, {
                swapId: id,
                oldStatus,
            });
        }
        else if (newStatus === swap_transaction_dto_1.SwapTransactionStatus.REJECTED) {
            this.eventEmitter.emit(swap_events_constant_1.SwapEvents.EVT_SWAP_REJECTED, {
                swapId: id,
                oldStatus,
                reason,
            });
        }
        return updatedSwap;
    }
    async fetchMarketRate(fromCode, toCode) {
        const getBinanceCode = (code) => {
            if (code === 'USD' || code === 'AED')
                return 'USDT';
            return code;
        };
        const bFrom = getBinanceCode(fromCode);
        const bTo = getBinanceCode(toCode);
        let rate = null;
        if (fromCode === toCode) {
            rate = new client_1.Prisma.Decimal(1);
        }
        else if (bFrom === bTo) {
            rate = new client_1.Prisma.Decimal(1);
        }
        else {
            const pair = `${bFrom}${bTo}`;
            const reversePair = `${bTo}${bFrom}`;
            try {
                const response = await axios_1.default.get(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`);
                rate = new client_1.Prisma.Decimal(response.data.price);
                this.logger.log(`[Rate Query] Success: ${pair} = ${rate.toString()}`);
            }
            catch (e) {
                this.logger.warn(`[Rate Query] Forward pair ${pair} failed, trying inverse...`);
                try {
                    const response = await axios_1.default.get(`https://api.binance.com/api/v3/ticker/price?symbol=${reversePair}`);
                    const revRate = new client_1.Prisma.Decimal(response.data.price);
                    rate = new client_1.Prisma.Decimal(1).div(revRate);
                    this.logger.log(`[Rate Query] Success (Inverse): ${reversePair} = ${revRate.toString()}, converted to ${pair} = ${rate.toString()}`);
                }
                catch (e2) {
                    this.logger.error(`[Rate Query] Both ${pair} and ${reversePair} failed.`);
                }
            }
        }
        if (!rate) {
            throw new common_1.BadRequestException(`Market rate not available for ${fromCode}/${toCode} in either direction`);
        }
        const aedUsdRate = new client_1.Prisma.Decimal(this.AED_USD_RATE);
        if (fromCode === 'AED') {
            rate = rate.div(aedUsdRate);
        }
        if (toCode === 'AED') {
            rate = rate.mul(aedUsdRate);
        }
        return rate;
    }
    async preview(dto) {
        const fromAsset = await this.prisma.asset.findUnique({
            where: { id: dto.fromAssetId },
        });
        const toAsset = await this.prisma.asset.findUnique({
            where: { id: dto.toAssetId },
        });
        if (!fromAsset || !toAsset)
            throw new common_1.NotFoundException('Asset not found');
        if (fromAsset.type === 'FIAT' && toAsset.type === 'FIAT') {
            throw new common_1.BadRequestException('Fiat to Fiat swap is not supported');
        }
        const rate = await this.fetchMarketRate(fromAsset.code, toAsset.code);
        const fromAmount = new client_1.Prisma.Decimal(dto.fromAmount);
        const toAmount = fromAmount.mul(rate);
        return {
            fromAssetId: fromAsset.id,
            fromAssetCode: fromAsset.code,
            fromAmount: fromAmount.toNumber(),
            toAssetId: toAsset.id,
            toAssetCode: toAsset.code,
            toAmount: toAmount.toNumber(),
            exchangeRate: rate.toNumber(),
        };
    }
    async findAll(query) {
        const { skip, take, swapNo, ownerId, ownerType, status, startDate, endDate, } = query;
        const where = {};
        if (swapNo)
            where.swapNo = { contains: swapNo };
        if (ownerId)
            where.ownerId = ownerId;
        if (ownerType)
            where.ownerType = ownerType;
        if (status)
            where.status = status;
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate)
                where.createdAt.gte = new Date(startDate);
            if (endDate)
                where.createdAt.lte = new Date(endDate);
        }
        const [items, total] = await Promise.all([
            this.prisma.swapTransaction.findMany({
                skip: skip ? Number(skip) : 0,
                take: take ? Number(take) : 20,
                where,
                orderBy: { createdAt: 'desc' },
                include: {
                    fromAsset: true,
                    toAsset: true,
                    customer: true,
                },
            }),
            this.prisma.swapTransaction.count({ where }),
        ]);
        return { items, total };
    }
    async findOne(id) {
        const item = await this.prisma.swapTransaction.findUnique({
            where: { id },
            include: {
                fromAsset: true,
                toAsset: true,
                customer: true,
                auditLogs: {
                    orderBy: { createdAt: 'desc' },
                },
            },
        });
        if (!item)
            throw new common_1.NotFoundException('Swap transaction not found');
        return item;
    }
};
exports.SwapTransactionsService = SwapTransactionsService;
exports.SwapTransactionsService = SwapTransactionsService = SwapTransactionsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        event_emitter_1.EventEmitter2])
], SwapTransactionsService);
//# sourceMappingURL=swap-transactions.service.js.map