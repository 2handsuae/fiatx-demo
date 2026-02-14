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
var DepositTransactionsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DepositTransactionsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const deposit_transaction_dto_1 = require("./dto/deposit-transaction.dto");
const client_1 = require("@prisma/client");
const no_generator_util_1 = require("../../../common/utils/no-generator.util");
const event_emitter_1 = require("@nestjs/event-emitter");
const deposit_transaction_events_1 = require("./events/deposit-transaction.events");
const transaction_compliance_service_1 = require("../../risk-engine/transaction-compliance/transaction-compliance.service");
const tx_compliance_types_1 = require("../../risk-engine/transaction-compliance/types/tx-compliance.types");
let DepositTransactionsService = DepositTransactionsService_1 = class DepositTransactionsService {
    constructor(prisma, eventEmitter, transactionComplianceService) {
        this.prisma = prisma;
        this.eventEmitter = eventEmitter;
        this.transactionComplianceService = transactionComplianceService;
        this.logger = new common_1.Logger(DepositTransactionsService_1.name);
    }
    assertComplianceBeforeSuccess(item, nextStatus) {
        if (nextStatus !== deposit_transaction_dto_1.DepositTransactionStatus.SUCCESS)
            return;
        if (item.kytStatus !== 'PASS') {
            throw new common_1.BadRequestException({
                code: 'COMPLIANCE_NOT_CLEARED',
                message: `Deposit ${item.id} kytStatus is not PASS`,
            });
        }
        if (item.travelRuleRequired === true && item.travelRuleStatus !== 'ACCEPTED') {
            throw new common_1.BadRequestException({
                code: 'COMPLIANCE_NOT_CLEARED',
                message: `Deposit ${item.id} travelRuleStatus is not ACCEPTED`,
            });
        }
    }
    async findAll(query) {
        const { skip, take, depositNo, ownerId, ownerType, assetId, toWalletId, status, startDate, endDate, } = query;
        const where = {};
        if (depositNo)
            where.depositNo = { contains: depositNo };
        if (ownerId)
            where.ownerId = ownerId;
        if (ownerType)
            where.ownerType = ownerType;
        if (assetId)
            where.assetId = assetId;
        if (toWalletId)
            where.toWalletId = toWalletId;
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
            this.prisma.depositTransaction.findMany({
                skip: skip ? Number(skip) : 0,
                take: take ? Number(take) : 20,
                where,
                orderBy: { createdAt: 'desc' },
                include: {
                    asset: true,
                    wallet: true,
                    customer: {
                        select: {
                            customerNo: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                },
            }),
            this.prisma.depositTransaction.count({ where }),
        ]);
        return { items, total };
    }
    async findOne(id) {
        const item = await this.prisma.depositTransaction.findUnique({
            where: { id },
            include: {
                asset: true,
                wallet: true,
                fromWallet: true,
                payin: true,
                customer: { select: { customerNo: true, firstName: true, lastName: true, email: true } },
                auditLogs: {
                    orderBy: { createdAt: 'desc' },
                },
            },
        });
        if (!item)
            throw new common_1.NotFoundException('Deposit transaction not found');
        const deposit = item;
        let ownerNo = deposit.ownerNo;
        if (!ownerNo && deposit.ownerType === 'CUSTOMER' && deposit.customer) {
            ownerNo = deposit.customer.customerNo;
        }
        const { kytCase, travelRuleCase } = await this.transactionComplianceService.getCaseSummaries(tx_compliance_types_1.TxSourceType.DEPOSIT, id, tx_compliance_types_1.KytScreeningStage.MAIN);
        return {
            ...item,
            ownerNo,
            payinNo: deposit.payin?.payinNo,
            toWalletNo: deposit.wallet?.walletNo,
            fromWalletNo: deposit.fromWallet?.walletNo,
            kytCase,
            travelRuleCase,
        };
    }
    async updateStatus(id, dto) {
        const transaction = await this.findOne(id);
        const currentStatus = transaction.status;
        const action = dto.action;
        const nextStatus = this.getNextStatus(currentStatus, action);
        this.assertComplianceBeforeSuccess(transaction, nextStatus);
        const historyEntry = {
            status: nextStatus,
            timestamp: new Date().toISOString(),
            operatorId: 'SYSTEM',
            reason: dto.reason || action,
        };
        let currentHistory = [];
        try {
            currentHistory = transaction.statusHistory
                ? JSON.parse(transaction.statusHistory)
                : [];
        }
        catch (e) {
            currentHistory = [];
        }
        currentHistory.push(historyEntry);
        const updateData = {
            status: nextStatus,
            statusHistory: JSON.stringify(currentHistory),
        };
        if (nextStatus === deposit_transaction_dto_1.DepositTransactionStatus.SUCCESS) {
            updateData.completedAt = new Date();
        }
        const updated = await this.prisma.depositTransaction.update({
            where: { id },
            data: updateData,
        });
        await this.prisma.depositAuditLog.create({
            data: {
                depositTransactionId: id,
                operatorId: 'SYSTEM',
                oldStatus: currentStatus,
                newStatus: nextStatus,
                reason: dto.reason || `Action: ${action}`,
            },
        });
        this.eventEmitter.emit('deposit.status.changed', new deposit_transaction_events_1.DepositStatusChangedEvent(updated.id, currentStatus, nextStatus, updated.ownerType, updated.ownerId, updated.assetId, updated.amount.toString(), updated.payinId));
        return updated;
    }
    getNextStatus(current, action) {
        const transitions = {
            [deposit_transaction_dto_1.DepositTransactionStatus.PAYIN_PENDING]: {
                [deposit_transaction_dto_1.DepositTransactionAction.PAYIN_CONFIRMED]: deposit_transaction_dto_1.DepositTransactionStatus.COMPLIANCE_PENDING,
                [deposit_transaction_dto_1.DepositTransactionAction.FAIL]: deposit_transaction_dto_1.DepositTransactionStatus.FAILED,
            },
            [deposit_transaction_dto_1.DepositTransactionStatus.COMPLIANCE_PENDING]: {
                [deposit_transaction_dto_1.DepositTransactionAction.SUCCESS]: deposit_transaction_dto_1.DepositTransactionStatus.SUCCESS,
                [deposit_transaction_dto_1.DepositTransactionAction.FLAG]: deposit_transaction_dto_1.DepositTransactionStatus.UNDER_REVIEW,
                [deposit_transaction_dto_1.DepositTransactionAction.REJECT]: deposit_transaction_dto_1.DepositTransactionStatus.REJECTED,
                [deposit_transaction_dto_1.DepositTransactionAction.FAIL]: deposit_transaction_dto_1.DepositTransactionStatus.FAILED,
            },
            [deposit_transaction_dto_1.DepositTransactionStatus.UNDER_REVIEW]: {
                [deposit_transaction_dto_1.DepositTransactionAction.SUCCESS]: deposit_transaction_dto_1.DepositTransactionStatus.SUCCESS,
                [deposit_transaction_dto_1.DepositTransactionAction.REJECT]: deposit_transaction_dto_1.DepositTransactionStatus.REJECTED,
                [deposit_transaction_dto_1.DepositTransactionAction.FAIL]: deposit_transaction_dto_1.DepositTransactionStatus.FAILED,
            },
            [deposit_transaction_dto_1.DepositTransactionStatus.FAILED]: {
                [deposit_transaction_dto_1.DepositTransactionAction.SUCCESS]: deposit_transaction_dto_1.DepositTransactionStatus.FAILED,
                [deposit_transaction_dto_1.DepositTransactionAction.REJECT]: deposit_transaction_dto_1.DepositTransactionStatus.FAILED,
                [deposit_transaction_dto_1.DepositTransactionAction.FAIL]: deposit_transaction_dto_1.DepositTransactionStatus.FAILED,
                [deposit_transaction_dto_1.DepositTransactionAction.FLAG]: deposit_transaction_dto_1.DepositTransactionStatus.FAILED,
                [deposit_transaction_dto_1.DepositTransactionAction.PAYIN_CONFIRMED]: deposit_transaction_dto_1.DepositTransactionStatus.FAILED,
            },
        };
        const nextStatus = transitions[current]?.[action];
        if (!nextStatus) {
            throw new common_1.BadRequestException(`Invalid action '${action}' for status '${current}'`);
        }
        return nextStatus;
    }
    async createFromPayin(amount, assetId, toWalletId, txHash, fromAddress, payinId) {
        const wallet = await this.prisma.wallet.findUnique({
            where: { id: toWalletId },
        });
        if (!wallet)
            throw new common_1.NotFoundException('Wallet not found');
        const depositNo = (0, no_generator_util_1.generateReferenceNo)('DEP');
        return this.prisma.depositTransaction.create({
            data: {
                depositNo,
                ownerType: wallet.ownerType,
                ownerId: wallet.ownerId || 'UNKNOWN',
                status: deposit_transaction_dto_1.DepositTransactionStatus.PAYIN_PENDING,
                statusHistory: JSON.stringify([
                    {
                        status: deposit_transaction_dto_1.DepositTransactionStatus.PAYIN_PENDING,
                        timestamp: new Date().toISOString(),
                        operatorId: 'SYSTEM',
                        reason: 'Created from Payin',
                    },
                ]),
                assetId,
                toWalletId,
                payinId,
                amount: new client_1.Prisma.Decimal(amount),
                netAmount: new client_1.Prisma.Decimal(amount),
                feeAmount: new client_1.Prisma.Decimal(0),
                txHash,
                fromAddress,
                toAddress: wallet.address,
                toIban: wallet.iban,
            },
        });
    }
    async createRandom() {
        const results = [];
        for (let i = 0; i < 10; i++) {
            const assets = await this.prisma.asset.findMany({
                where: { status: 'ACTIVE' },
            });
            if (assets.length === 0)
                throw new common_1.NotFoundException('No active asset found for demo');
            const asset = assets[Math.floor(Math.random() * assets.length)];
            let wallet = await this.prisma.wallet.findFirst({
                where: { assetId: asset.id },
            });
            if (!wallet) {
                wallet = await this.prisma.wallet.create({
                    data: {
                        ownerType: 'CUSTOMER',
                        ownerId: 'U_DEMO_' + Math.floor(Math.random() * 10000),
                        type: asset.type === 'CRYPTO' ? 'CRYPTO_ADDRESS' : 'BANK_ACCOUNT',
                        direction: 'INBOUND',
                        assetId: asset.id,
                        status: 'ACTIVE',
                        address: asset.type === 'CRYPTO' ? 'T_DEMO_' + Date.now() + i : null,
                        iban: asset.type === 'FIAT' ? 'US_DEMO_' + Date.now() + i : null,
                    },
                });
            }
            const amount = (Math.random() * 1000 + 10).toFixed(2);
            const depositNo = (0, no_generator_util_1.generateReferenceNo)('DEP');
            const deposit = await this.prisma.depositTransaction.create({
                data: {
                    depositNo,
                    ownerType: 'CUSTOMER',
                    ownerId: wallet.ownerId || 'UNKNOWN',
                    status: deposit_transaction_dto_1.DepositTransactionStatus.PAYIN_PENDING,
                    statusHistory: JSON.stringify([
                        {
                            status: deposit_transaction_dto_1.DepositTransactionStatus.PAYIN_PENDING,
                            timestamp: new Date().toISOString(),
                            operatorId: 'SYSTEM',
                            reason: 'Initial creation',
                        },
                    ]),
                    assetId: asset.id,
                    toWalletId: wallet.id,
                    amount: new client_1.Prisma.Decimal(amount),
                    netAmount: new client_1.Prisma.Decimal(amount),
                    feeAmount: new client_1.Prisma.Decimal(0),
                    fromAddress: asset.type === 'CRYPTO' ? 'T_SENDER_' + Date.now() + i : null,
                    fromIban: asset.type === 'FIAT' ? 'US_SENDER_' + Date.now() + i : null,
                    txHash: asset.type === 'CRYPTO'
                        ? '0x' +
                            Date.now().toString(16) +
                            Math.random().toString(16).substr(2)
                        : null,
                    referenceNo: asset.type === 'FIAT' ? 'REF_' + Date.now() + i : null,
                    toAddress: wallet.address,
                    toIban: wallet.iban,
                },
            });
            results.push(deposit);
        }
        return results;
    }
};
exports.DepositTransactionsService = DepositTransactionsService;
exports.DepositTransactionsService = DepositTransactionsService = DepositTransactionsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        event_emitter_1.EventEmitter2,
        transaction_compliance_service_1.TransactionComplianceService])
], DepositTransactionsService);
//# sourceMappingURL=deposit-transactions.service.js.map