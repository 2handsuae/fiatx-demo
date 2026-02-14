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
var PayoutsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayoutsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const payout_dto_1 = require("./dto/payout.dto");
const CRYPTO_TRANSITIONS = {
    [payout_dto_1.PayoutStatus.CREATED]: { [payout_dto_1.PayoutAction.SIGN]: payout_dto_1.PayoutStatus.SIGNING },
    [payout_dto_1.PayoutStatus.SIGNING]: {
        [payout_dto_1.PayoutAction.BROADCAST]: payout_dto_1.PayoutStatus.BROADCASTED,
        [payout_dto_1.PayoutAction.SIGN_FAIL]: payout_dto_1.PayoutStatus.FAILED
    },
    [payout_dto_1.PayoutStatus.BROADCASTED]: {
        [payout_dto_1.PayoutAction.SEEN_IN_MEMPOOL]: payout_dto_1.PayoutStatus.CONFIRMING,
        [payout_dto_1.PayoutAction.DROP]: payout_dto_1.PayoutStatus.FAILED,
        [payout_dto_1.PayoutAction.TIMEOUT]: payout_dto_1.PayoutStatus.TIMEOUT
    },
    [payout_dto_1.PayoutStatus.CONFIRMING]: {
        [payout_dto_1.PayoutAction.CONFIRM]: payout_dto_1.PayoutStatus.CONFIRMED,
        [payout_dto_1.PayoutAction.TIMEOUT]: payout_dto_1.PayoutStatus.TIMEOUT,
        [payout_dto_1.PayoutAction.FAIL]: payout_dto_1.PayoutStatus.FAILED
    },
    [payout_dto_1.PayoutStatus.CONFIRMED]: { [payout_dto_1.PayoutAction.CLEAR]: payout_dto_1.PayoutStatus.CLEAR },
    [payout_dto_1.PayoutStatus.FAILED]: {},
    [payout_dto_1.PayoutStatus.TIMEOUT]: {},
    [payout_dto_1.PayoutStatus.CLEAR]: {},
    [payout_dto_1.PayoutStatus.RETURNED]: {},
};
const FIAT_TRANSITIONS = {
    [payout_dto_1.PayoutStatus.CREATED]: { [payout_dto_1.PayoutAction.SUBMIT]: payout_dto_1.PayoutStatus.CONFIRMING },
    [payout_dto_1.PayoutStatus.CONFIRMING]: {
        [payout_dto_1.PayoutAction.CONFIRM]: payout_dto_1.PayoutStatus.CONFIRMED,
        [payout_dto_1.PayoutAction.FAIL]: payout_dto_1.PayoutStatus.FAILED,
        [payout_dto_1.PayoutAction.TIMEOUT]: payout_dto_1.PayoutStatus.TIMEOUT
    },
    [payout_dto_1.PayoutStatus.CONFIRMED]: {
        [payout_dto_1.PayoutAction.CLEAR]: payout_dto_1.PayoutStatus.CLEAR,
        [payout_dto_1.PayoutAction.RETURN]: payout_dto_1.PayoutStatus.RETURNED
    },
    [payout_dto_1.PayoutStatus.CLEAR]: { [payout_dto_1.PayoutAction.RETURN]: payout_dto_1.PayoutStatus.RETURNED },
    [payout_dto_1.PayoutStatus.FAILED]: {},
    [payout_dto_1.PayoutStatus.TIMEOUT]: {},
    [payout_dto_1.PayoutStatus.RETURNED]: {},
};
const client_1 = require("@prisma/client");
const uuid_1 = require("uuid");
const event_emitter_1 = require("@nestjs/event-emitter");
const payout_events_constant_1 = require("./constants/payout-events.constant");
const withdraw_events_constant_1 = require("../../trading/withdraw-transactions/constants/withdraw-events.constant");
const no_generator_util_1 = require("../../../common/utils/no-generator.util");
let PayoutsService = PayoutsService_1 = class PayoutsService {
    constructor(prisma, eventEmitter) {
        this.prisma = prisma;
        this.eventEmitter = eventEmitter;
        this.logger = new common_1.Logger(PayoutsService_1.name);
    }
    generatePayoutId() {
        return `PO_${(0, uuid_1.v4)()}`;
    }
    async findAll(query) {
        const { skip, take, withdrawId, status, type, assetId } = query;
        const where = {};
        if (withdrawId)
            where.withdrawId = withdrawId;
        if (status)
            where.status = status;
        if (type)
            where.type = type;
        if (assetId)
            where.assetId = assetId;
        const [items, total] = await Promise.all([
            this.prisma.payout.findMany({
                skip: skip ? Number(skip) : 0,
                take: take ? Number(take) : 20,
                where,
                orderBy: { createdAt: 'desc' },
                include: {
                    asset: true,
                    withdraw: true,
                    customer: true,
                },
            }),
            this.prisma.payout.count({ where }),
        ]);
        return { items, total };
    }
    async findOne(id) {
        const item = await this.prisma.payout.findUnique({
            where: { id },
            include: {
                asset: true,
                withdraw: true,
                customer: true,
                clearings: {
                    include: {
                        lines: true
                    }
                },
                auditLogs: {
                    orderBy: { createdAt: 'desc' },
                },
            },
        });
        if (!item)
            throw new common_1.NotFoundException('Payout not found');
        return item;
    }
    async create(dto, operatorId, tx) {
        const { withdrawId, type, amount, assetId, toWalletId, toAddress, toIban } = dto;
        const payoutId = this.generatePayoutId();
        const executeCreate = async (client) => {
            const record = await client.payout.create({
                data: {
                    id: payoutId,
                    payoutNo: (0, no_generator_util_1.generateReferenceNo)('PO'),
                    withdrawId,
                    type,
                    status: payout_dto_1.PayoutStatus.CREATED,
                    amount: new client_1.Prisma.Decimal(amount),
                    assetId,
                    toWalletId,
                    toAddress,
                    toIban,
                    statusHistory: JSON.stringify([{
                            status: payout_dto_1.PayoutStatus.CREATED,
                            timestamp: new Date().toISOString(),
                            operator: operatorId,
                            note: 'Payout initiated'
                        }]),
                },
            });
            await client.payoutAuditLog.create({
                data: {
                    payoutId: record.id,
                    operatorId,
                    oldStatus: 'NONE',
                    newStatus: payout_dto_1.PayoutStatus.CREATED,
                    reason: 'Payout initiated',
                },
            });
            return record;
        };
        if (tx) {
            return executeCreate(tx);
        }
        return await this.prisma.$transaction(async (client) => {
            return executeCreate(client);
        });
    }
    async updateStatus(id, dto, operatorId, tx) {
        const { action, txHash, referenceNo, reason } = dto;
        const item = await this.findOne(id);
        const oldStatus = item.status;
        const type = item.type;
        const transitions = type === payout_dto_1.PayoutType.CRYPTO ? CRYPTO_TRANSITIONS : FIAT_TRANSITIONS;
        const nextStatus = transitions[oldStatus]?.[action];
        if (!nextStatus) {
            throw new common_1.BadRequestException(`Invalid action ${action} for current status ${oldStatus} and type ${type}`);
        }
        const executeUpdate = async (client) => {
            const updateData = { status: nextStatus };
            if (nextStatus === payout_dto_1.PayoutStatus.SIGNING || (type === payout_dto_1.PayoutType.FIAT && nextStatus === payout_dto_1.PayoutStatus.CONFIRMING)) {
                if (!item.sentAt) {
                    updateData.sentAt = new Date();
                }
            }
            if ([payout_dto_1.PayoutStatus.CLEAR, payout_dto_1.PayoutStatus.FAILED, payout_dto_1.PayoutStatus.TIMEOUT, payout_dto_1.PayoutStatus.RETURNED].includes(nextStatus)) {
                updateData.completedAt = new Date();
            }
            if (txHash)
                updateData.txHash = txHash;
            if (referenceNo)
                updateData.referenceNo = referenceNo;
            let history = [];
            try {
                if (item.statusHistory) {
                    history = JSON.parse(item.statusHistory);
                }
            }
            catch (e) {
            }
            history.push({
                status: nextStatus,
                timestamp: new Date().toISOString(),
                operator: operatorId,
                note: reason || (action ? `Action: ${action}` : `Status updated to ${nextStatus}`)
            });
            updateData.statusHistory = JSON.stringify(history);
            const updated = await client.payout.update({
                where: { id },
                data: updateData,
            });
            await client.payoutAuditLog.create({
                data: {
                    payoutId: id,
                    operatorId,
                    oldStatus,
                    newStatus: nextStatus,
                    reason: reason || (action ? `Action: ${action}` : `Status updated to ${nextStatus}`),
                },
            });
            if (nextStatus === payout_dto_1.PayoutStatus.CONFIRMED) {
                this.eventEmitter.emit(payout_events_constant_1.PayoutEvents.EVT_PAYOUT_CONFIRMED, {
                    payoutId: id,
                    withdrawId: item.withdrawId,
                });
            }
            else if (nextStatus === payout_dto_1.PayoutStatus.FAILED || nextStatus === payout_dto_1.PayoutStatus.TIMEOUT) {
                if (item.withdrawId) {
                    const event = type === payout_dto_1.PayoutType.CRYPTO
                        ? withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_FAILED__CRYPTO
                        : withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_FAILED__FIAT;
                    this.eventEmitter.emit(event, {
                        withdrawId: item.withdrawId,
                        payoutId: id,
                        status: nextStatus,
                    });
                }
                else {
                    const event = nextStatus === payout_dto_1.PayoutStatus.FAILED
                        ? payout_events_constant_1.PayoutEvents.EVT_PAYOUT_FAILED
                        : payout_events_constant_1.PayoutEvents.EVT_PAYOUT_TIMEOUT;
                    this.eventEmitter.emit(event, {
                        payoutId: id,
                        withdrawId: item.withdrawId,
                    });
                }
            }
            else if (nextStatus === payout_dto_1.PayoutStatus.RETURNED) {
                this.eventEmitter.emit(payout_events_constant_1.PayoutEvents.EVT_PAYOUT_RETURNED, {
                    payoutId: id,
                    withdrawId: item.withdrawId,
                });
            }
            return updated;
        };
        if (tx) {
            return executeUpdate(tx);
        }
        else {
            return await this.prisma.$transaction(async (client) => {
                return executeUpdate(client);
            });
        }
    }
    async createMock(operatorId) {
        const assets = await this.prisma.asset.findMany({ take: 10 });
        if (assets.length === 0)
            throw new common_1.BadRequestException('No assets found to create mock payouts');
        const createdPayouts = [];
        for (let i = 0; i < 3; i++) {
            const asset = assets[Math.floor(Math.random() * assets.length)];
            const type = Math.random() > 0.5 ? payout_dto_1.PayoutType.CRYPTO : payout_dto_1.PayoutType.FIAT;
            const amount = Math.floor(Math.random() * 1000) + 10;
            const withdrawNo = `WDR_MOCK_${(0, uuid_1.v4)().substring(0, 8)}`;
            const withdrawId = (0, uuid_1.v4)();
            await this.prisma.$transaction(async (tx) => {
                const withdraw = await tx.withdrawTransaction.create({
                    data: {
                        id: withdrawId,
                        withdrawNo,
                        ownerType: 'CUSTOMER',
                        ownerId: 'MOCK_USER',
                        type: 'WITHDRAW',
                        status: 'APPROVED',
                        assetId: asset.id,
                        amount: new client_1.Prisma.Decimal(amount),
                        netAmount: new client_1.Prisma.Decimal(amount),
                    },
                });
                const payoutId = this.generatePayoutId();
                const payout = await tx.payout.create({
                    data: {
                        id: payoutId,
                        withdrawId: withdraw.id,
                        type,
                        status: payout_dto_1.PayoutStatus.CREATED,
                        amount: new client_1.Prisma.Decimal(amount),
                        assetId: asset.id,
                        toAddress: type === payout_dto_1.PayoutType.CRYPTO ? '0x' + (0, uuid_1.v4)().replace(/-/g, '') : null,
                        toIban: type === payout_dto_1.PayoutType.FIAT ? 'IBAN' + (0, uuid_1.v4)().substring(0, 20) : null,
                    },
                });
                await tx.payoutAuditLog.create({
                    data: {
                        payoutId: payout.id,
                        operatorId,
                        oldStatus: 'NONE',
                        newStatus: payout_dto_1.PayoutStatus.CREATED,
                        reason: 'Mock payout created',
                    },
                });
                createdPayouts.push(payout);
            });
        }
        return createdPayouts;
    }
};
exports.PayoutsService = PayoutsService;
exports.PayoutsService = PayoutsService = PayoutsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, event_emitter_1.EventEmitter2])
], PayoutsService);
//# sourceMappingURL=payouts.service.js.map