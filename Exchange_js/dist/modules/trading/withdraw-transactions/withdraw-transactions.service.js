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
var WithdrawTransactionsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WithdrawTransactionsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const withdraw_transaction_dto_1 = require("./dto/withdraw-transaction.dto");
const client_1 = require("@prisma/client");
const event_emitter_1 = require("@nestjs/event-emitter");
const withdraw_events_constant_1 = require("./constants/withdraw-events.constant");
const no_generator_util_1 = require("../../../common/utils/no-generator.util");
const journals_service_1 = require("../../accounting/journals/journals.service");
let WithdrawTransactionsService = WithdrawTransactionsService_1 = class WithdrawTransactionsService {
    generateWithdrawNo() {
        return (0, no_generator_util_1.generateReferenceNo)('WD');
    }
    constructor(prisma, eventEmitter, journalsService) {
        this.prisma = prisma;
        this.eventEmitter = eventEmitter;
        this.journalsService = journalsService;
        this.logger = new common_1.Logger(WithdrawTransactionsService_1.name);
        this.transitions = {
            [withdraw_transaction_dto_1.WithdrawTransactionStatus.CREATED]: {
                [withdraw_transaction_dto_1.WithdrawTransactionAction.CHECK]: withdraw_transaction_dto_1.WithdrawTransactionStatus.PENDING_COMPLIANCE,
                [withdraw_transaction_dto_1.WithdrawTransactionAction.CANCEL]: withdraw_transaction_dto_1.WithdrawTransactionStatus.CANCELLED,
            },
            [withdraw_transaction_dto_1.WithdrawTransactionStatus.PENDING_COMPLIANCE]: {
                [withdraw_transaction_dto_1.WithdrawTransactionAction.FLAG]: withdraw_transaction_dto_1.WithdrawTransactionStatus.UNDER_REVIEW,
                [withdraw_transaction_dto_1.WithdrawTransactionAction.REJECT]: withdraw_transaction_dto_1.WithdrawTransactionStatus.REJECTED,
                [withdraw_transaction_dto_1.WithdrawTransactionAction.APPROVE]: withdraw_transaction_dto_1.WithdrawTransactionStatus.PAYOUT_PENDING,
                [withdraw_transaction_dto_1.WithdrawTransactionAction.CANCEL]: withdraw_transaction_dto_1.WithdrawTransactionStatus.CANCELLED,
            },
            [withdraw_transaction_dto_1.WithdrawTransactionStatus.UNDER_REVIEW]: {
                [withdraw_transaction_dto_1.WithdrawTransactionAction.APPROVE]: withdraw_transaction_dto_1.WithdrawTransactionStatus.PAYOUT_PENDING,
                [withdraw_transaction_dto_1.WithdrawTransactionAction.REJECT]: withdraw_transaction_dto_1.WithdrawTransactionStatus.REJECTED,
                [withdraw_transaction_dto_1.WithdrawTransactionAction.CANCEL]: withdraw_transaction_dto_1.WithdrawTransactionStatus.CANCELLED,
            },
            [withdraw_transaction_dto_1.WithdrawTransactionStatus.APPROVED]: {
                [withdraw_transaction_dto_1.WithdrawTransactionAction.APPROVE]: withdraw_transaction_dto_1.WithdrawTransactionStatus.PAYOUT_PENDING,
            },
            [withdraw_transaction_dto_1.WithdrawTransactionStatus.PAYOUT_PENDING]: {
                [withdraw_transaction_dto_1.WithdrawTransactionAction.SUCCESS]: withdraw_transaction_dto_1.WithdrawTransactionStatus.SUCCESS,
                [withdraw_transaction_dto_1.WithdrawTransactionAction.FAIL]: withdraw_transaction_dto_1.WithdrawTransactionStatus.FAILED,
                [withdraw_transaction_dto_1.WithdrawTransactionAction.APPROVE]: withdraw_transaction_dto_1.WithdrawTransactionStatus.PAYOUT_PENDING,
            },
            [withdraw_transaction_dto_1.WithdrawTransactionStatus.SUCCESS]: {
                [withdraw_transaction_dto_1.WithdrawTransactionAction.RETURN]: withdraw_transaction_dto_1.WithdrawTransactionStatus.RETURNED,
                [withdraw_transaction_dto_1.WithdrawTransactionAction.SUCCESS]: withdraw_transaction_dto_1.WithdrawTransactionStatus.SUCCESS,
            },
            [withdraw_transaction_dto_1.WithdrawTransactionStatus.FAILED]: {
                [withdraw_transaction_dto_1.WithdrawTransactionAction.FAIL]: withdraw_transaction_dto_1.WithdrawTransactionStatus.FAILED,
            },
            [withdraw_transaction_dto_1.WithdrawTransactionStatus.REJECTED]: {},
            [withdraw_transaction_dto_1.WithdrawTransactionStatus.CANCELLED]: {},
            [withdraw_transaction_dto_1.WithdrawTransactionStatus.RETURNED]: {},
            [withdraw_transaction_dto_1.WithdrawTransactionStatus.HELD]: {},
        };
    }
    createAccountingContext(withdrawal) {
        return {
            src: {
                ownerId: withdrawal.ownerId,
                ownerType: withdrawal.ownerType,
                assetId: withdrawal.assetId,
                amount: withdrawal.amount.toString(),
                netAmount: withdrawal.netAmount.toString(),
                feeAmount: withdrawal.feeAmount.toString(),
                withdrawNo: withdrawal.withdrawNo,
            },
        };
    }
    assertComplianceGate(item, nextStatus) {
        if (![
            withdraw_transaction_dto_1.WithdrawTransactionStatus.PAYOUT_PENDING,
            withdraw_transaction_dto_1.WithdrawTransactionStatus.SUCCESS,
        ].includes(nextStatus)) {
            return;
        }
        if (item.complianceStatus !== 'CLEAR' ||
            item.preKytStatus !== 'PASS' ||
            item.kytStatus !== 'PASS') {
            throw new common_1.BadRequestException({
                code: 'COMPLIANCE_NOT_CLEARED',
                message: `Withdrawal ${item.id} compliance not cleared for status ${nextStatus}`,
            });
        }
        if (item.travelRuleRequired === true &&
            item.travelRuleStatus !== 'ACCEPTED') {
            throw new common_1.BadRequestException({
                code: 'COMPLIANCE_NOT_CLEARED',
                message: `Withdrawal ${item.id} travel rule not accepted for status ${nextStatus}`,
            });
        }
    }
    async findAll(query) {
        const { skip, take, withdrawNo, ownerId, ownerType, assetId, status, startDate, endDate, } = query;
        const where = {};
        if (withdrawNo)
            where.withdrawNo = { contains: withdrawNo };
        if (ownerId)
            where.ownerId = ownerId;
        if (ownerType)
            where.ownerType = ownerType;
        if (assetId)
            where.assetId = assetId;
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
            this.prisma.withdrawTransaction.findMany({
                skip: skip ? Number(skip) : 0,
                take: take ? Number(take) : 20,
                where,
                orderBy: { createdAt: 'desc' },
                include: {
                    asset: true,
                    customer: true,
                },
            }),
            this.prisma.withdrawTransaction.count({ where }),
        ]);
        return { items, total };
    }
    async findOne(id) {
        const item = await this.prisma.withdrawTransaction.findUnique({
            where: { id },
            include: {
                asset: true,
                customer: true,
                payout: {
                    include: {
                        clearings: {
                            include: {
                                lines: true
                            }
                        }
                    }
                },
                auditLogs: {
                    orderBy: { createdAt: 'desc' },
                },
            },
        });
        if (!item)
            throw new common_1.NotFoundException('Withdraw transaction not found');
        return item;
    }
    async create(dto, userId, ownerType = 'CUSTOMER') {
        const { assetId, amount, toWalletId, toAddress, toIban, parentType, parentId } = dto;
        const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
        if (!asset)
            throw new common_1.NotFoundException('Asset not found');
        const withdrawNo = this.generateWithdrawNo();
        let ownerNo = null;
        if (ownerType === 'CUSTOMER') {
            const customer = await this.prisma.customerMain.findUnique({ where: { id: userId } });
            if (customer)
                ownerNo = customer.customerNo;
        }
        const amountDecimal = new client_1.Prisma.Decimal(amount);
        const created = await this.prisma.$transaction(async (tx) => {
            const balances = await this.journalsService.getCustomerLiabilityBalance({
                ownerId: userId,
                ownerType,
                assetId,
            }, tx);
            if (balances.availableBalance.lt(amountDecimal)) {
                throw new common_1.BadRequestException({
                    code: 'INSUFFICIENT_AVAILABLE_BALANCE',
                    message: `Insufficient available balance for asset ${assetId}`,
                });
            }
            const record = await tx.withdrawTransaction.create({
                data: {
                    withdrawNo,
                    ownerType,
                    ownerId: userId,
                    ownerNo,
                    type: asset.type === 'FIAT' ? 'fiat' : 'crypto',
                    status: withdraw_transaction_dto_1.WithdrawTransactionStatus.CREATED,
                    assetId,
                    amount: amountDecimal,
                    netAmount: amountDecimal,
                    feeAmount: new client_1.Prisma.Decimal(0),
                    toWalletId,
                    toAddress,
                    toIban,
                    parentType,
                    parentId,
                    statusHistory: JSON.stringify([{
                            status: withdraw_transaction_dto_1.WithdrawTransactionStatus.CREATED,
                            timestamp: new Date().toISOString(),
                            operator: 'SYSTEM',
                            note: 'Withdrawal created'
                        }]),
                },
            });
            await tx.withdrawAuditLog.create({
                data: {
                    withdrawTransactionId: record.id,
                    operatorId: userId,
                    oldStatus: 'NONE',
                    newStatus: withdraw_transaction_dto_1.WithdrawTransactionStatus.CREATED,
                    reason: 'Customer initiated withdrawal',
                },
            });
            await this.journalsService.createJournal({
                sourceType: 'WITHDRAW',
                sourceId: record.id,
                eventCode: withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_CREATED,
                context: this.createAccountingContext(record),
            }, tx);
            return record;
        });
        this.eventEmitter.emit(withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_CREATED, {
            withdrawId: created.id,
        });
        return created;
    }
    async updateStatus(id, dto, tx) {
        const { action, reason } = dto;
        const item = await this.findOne(id);
        const currentStatus = item.status;
        const nextStatus = this.transitions[currentStatus]?.[action];
        if (!nextStatus) {
            throw new common_1.BadRequestException(`Invalid action "${action}" for current status "${currentStatus}"`);
        }
        this.assertComplianceGate(item, nextStatus);
        const executeUpdate = async (client) => {
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
                operator: 'SYSTEM',
                note: reason || `Status changed from ${currentStatus} to ${nextStatus}`
            });
            const updated = await client.withdrawTransaction.update({
                where: { id },
                data: {
                    status: nextStatus,
                    approvedAt: (nextStatus === withdraw_transaction_dto_1.WithdrawTransactionStatus.APPROVED || nextStatus === withdraw_transaction_dto_1.WithdrawTransactionStatus.PAYOUT_PENDING) && !item.approvedAt ? new Date() : item.approvedAt,
                    payoutRequestedAt: nextStatus === withdraw_transaction_dto_1.WithdrawTransactionStatus.PAYOUT_PENDING ? new Date() : item.payoutRequestedAt,
                    completedAt: [withdraw_transaction_dto_1.WithdrawTransactionStatus.SUCCESS, withdraw_transaction_dto_1.WithdrawTransactionStatus.FAILED, withdraw_transaction_dto_1.WithdrawTransactionStatus.REJECTED, withdraw_transaction_dto_1.WithdrawTransactionStatus.CANCELLED, withdraw_transaction_dto_1.WithdrawTransactionStatus.RETURNED].includes(nextStatus) ? new Date() : item.completedAt,
                    statusHistory: JSON.stringify(history),
                },
            });
            await client.withdrawAuditLog.create({
                data: {
                    withdrawTransactionId: id,
                    operatorId: 'SYSTEM',
                    oldStatus: currentStatus,
                    newStatus: nextStatus,
                    reason: reason || `Action: ${action}`,
                },
            });
            if (nextStatus === withdraw_transaction_dto_1.WithdrawTransactionStatus.CANCELLED) {
                this.eventEmitter.emit(withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_CANCELLED, {
                    withdrawId: id,
                });
            }
            else if (nextStatus === withdraw_transaction_dto_1.WithdrawTransactionStatus.REJECTED) {
                this.eventEmitter.emit(withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_REJECTED, {
                    withdrawId: id,
                });
            }
            else if (nextStatus === withdraw_transaction_dto_1.WithdrawTransactionStatus.APPROVED || nextStatus === withdraw_transaction_dto_1.WithdrawTransactionStatus.PAYOUT_PENDING) {
                if (currentStatus !== withdraw_transaction_dto_1.WithdrawTransactionStatus.APPROVED && currentStatus !== withdraw_transaction_dto_1.WithdrawTransactionStatus.PAYOUT_PENDING) {
                    if (updated.type === 'crypto') {
                        this.eventEmitter.emit(withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_APPROVED__CRYPTO, { withdrawId: id });
                    }
                    else if (updated.type === 'fiat') {
                        this.eventEmitter.emit(withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_APPROVED__FIAT, {
                            withdrawId: id,
                        });
                    }
                }
            }
            else if (nextStatus === withdraw_transaction_dto_1.WithdrawTransactionStatus.SUCCESS) {
                const successEvent = updated.type === 'crypto' ? withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_SUCCESS__CRYPTO : withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_SUCCESS__FIAT;
                this.eventEmitter.emit(successEvent, { withdrawId: id });
            }
            else if (nextStatus === withdraw_transaction_dto_1.WithdrawTransactionStatus.FAILED) {
                const failedEvent = updated.type === 'crypto' ? withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_FAILED__CRYPTO : withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_FAILED__FIAT;
                this.eventEmitter.emit(failedEvent, { withdrawId: id });
            }
            else if (nextStatus === withdraw_transaction_dto_1.WithdrawTransactionStatus.RETURNED) {
                this.eventEmitter.emit(withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_RETURNED__FIAT, { withdrawId: id });
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
    async createMockData() {
        const assets = await this.prisma.asset.findMany();
        if (assets.length === 0) {
            throw new common_1.BadRequestException('No assets found. Please seed assets first.');
        }
        const records = [];
        for (let i = 0; i < 10; i++) {
            const asset = assets[Math.floor(Math.random() * assets.length)];
            const amount = (Math.random() * 1000 + 10).toFixed(2);
            const record = await this.prisma.withdrawTransaction.create({
                data: {
                    withdrawNo: `WDR-${Date.now()}-${i}`,
                    ownerType: 'CUSTOMER',
                    ownerId: `USER-${Math.floor(Math.random() * 1000)}`,
                    type: asset.type === 'FIAT' ? 'fiat' : 'crypto',
                    status: withdraw_transaction_dto_1.WithdrawTransactionStatus.CREATED,
                    assetId: asset.id,
                    amount: new client_1.Prisma.Decimal(amount),
                    netAmount: new client_1.Prisma.Decimal(amount),
                    feeAmount: new client_1.Prisma.Decimal(0),
                    toAddress: asset.type !== 'FIAT' ? '0x' + Math.random().toString(16).slice(2) : null,
                    toIban: asset.type === 'FIAT' ? 'IBAN' + Math.random().toString().slice(2) : null,
                    statusHistory: JSON.stringify([{
                            from: 'NONE',
                            to: withdraw_transaction_dto_1.WithdrawTransactionStatus.CREATED,
                            action: 'CREATE',
                            timestamp: new Date(),
                        }]),
                },
            });
            records.push(record);
            await this.prisma.withdrawAuditLog.create({
                data: {
                    withdrawTransactionId: record.id,
                    operatorId: 'SYSTEM',
                    oldStatus: 'NONE',
                    newStatus: withdraw_transaction_dto_1.WithdrawTransactionStatus.CREATED,
                    reason: 'Initial creation',
                },
            });
        }
        return records;
    }
};
exports.WithdrawTransactionsService = WithdrawTransactionsService;
exports.WithdrawTransactionsService = WithdrawTransactionsService = WithdrawTransactionsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        event_emitter_1.EventEmitter2,
        journals_service_1.JournalsService])
], WithdrawTransactionsService);
//# sourceMappingURL=withdraw-transactions.service.js.map