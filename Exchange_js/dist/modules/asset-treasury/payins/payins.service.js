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
var PayinsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayinsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const payin_dto_1 = require("./dto/payin.dto");
const client_1 = require("@prisma/client");
const crypto = require("crypto");
const event_emitter_1 = require("@nestjs/event-emitter");
const payin_events_1 = require("./events/payin.events");
const no_generator_util_1 = require("../../../common/utils/no-generator.util");
let PayinsService = PayinsService_1 = class PayinsService {
    constructor(prisma, eventEmitter) {
        this.prisma = prisma;
        this.eventEmitter = eventEmitter;
        this.logger = new common_1.Logger(PayinsService_1.name);
    }
    async simulate(dto) {
        const { assetId, toWalletId, type } = dto;
        this.logger.log(`Simulating payin for wallet ${toWalletId} (Type: ${type})`);
        const wallet = await this.prisma.wallet.findUnique({
            where: { id: toWalletId },
        });
        if (!wallet)
            throw new common_1.NotFoundException('Wallet not found');
        if (type === payin_dto_1.PayinType.FIAT) {
        }
        const amount = (Math.random() * 1000).toFixed(2);
        const initialStatus = payin_dto_1.PayinStatus.DETECTED;
        const initialHistory = [
            {
                status: initialStatus,
                changedAt: new Date(),
                reason: 'Initial simulation',
                operatorId: 'SYSTEM'
            }
        ];
        const payin = await this.prisma.payin.create({
            data: {
                payinNo: (0, no_generator_util_1.generateReferenceNo)('PI'),
                type,
                status: initialStatus,
                amount: new client_1.Prisma.Decimal(amount),
                assetId: assetId,
                toWalletId: toWalletId,
                ownerId: wallet.ownerType === 'CUSTOMER' ? wallet.ownerId : undefined,
                statusHistory: JSON.stringify(initialHistory),
                txHash: type === payin_dto_1.PayinType.CRYPTO ? '0x' + crypto.randomBytes(32).toString('hex') : undefined,
                fromAddress: type === payin_dto_1.PayinType.CRYPTO
                    ? '0x' + crypto.randomBytes(20).toString('hex')
                    : undefined,
                fromIban: type === payin_dto_1.PayinType.FIAT
                    ? 'US' + crypto.randomInt(10000000, 99999999)
                    : undefined,
                referenceNo: type === payin_dto_1.PayinType.FIAT
                    ? 'REF-' + crypto.randomInt(100000, 999999)
                    : undefined,
                receivedAt: new Date(),
            },
        });
        await this.prisma.payinAuditLog.create({
            data: {
                payinId: payin.id,
                operatorId: 'SYSTEM',
                oldStatus: 'NONE',
                newStatus: payin_dto_1.PayinStatus.DETECTED,
                reason: 'Initial simulation',
            },
        });
        this.logger.log(`Emitting payin.created event for ${payin.id}`);
        console.log('PAYIN_SERVICE: Emitting payin.created for', payin.id);
        const emitted = this.eventEmitter.emit('payin.created', new payin_events_1.PayinCreatedEvent(payin.id, payin.status, payin.type, payin.depositId, payin.assetId, payin.amount.toString()));
        console.log('PAYIN_SERVICE: Emitted result:', emitted);
        return payin;
    }
    async findAll(query) {
        const { skip, take, status, type, assetId, txHash, depositId } = query;
        const where = {};
        if (status)
            where.status = status;
        if (type)
            where.type = type;
        if (assetId)
            where.assetId = assetId;
        if (txHash)
            where.txHash = { contains: txHash };
        if (depositId)
            where.depositId = depositId;
        const [items, total] = await Promise.all([
            this.prisma.payin.findMany({
                skip: skip ? Number(skip) : 0,
                take: take ? Number(take) : 20,
                where,
                orderBy: { receivedAt: 'desc' },
                include: {
                    deposit: {
                        select: {
                            kytStatus: true,
                            travelRuleStatus: true,
                            depositNo: true,
                        },
                    },
                    asset: {
                        select: {
                            code: true,
                            type: true,
                            network: true,
                        },
                    },
                    toWallet: {
                        select: {
                            ownerType: true,
                            ownerId: true,
                            address: true,
                            accountName: true,
                        },
                    },
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
            this.prisma.payin.count({ where }),
        ]);
        return { items, total };
    }
    async findOne(id) {
        const item = await this.prisma.payin.findUnique({
            where: { id },
            include: {
                asset: true,
                toWallet: true,
                fromWallet: true,
                deposit: true,
                customer: { select: { customerNo: true, firstName: true, lastName: true, email: true } },
            },
        });
        if (!item)
            throw new common_1.NotFoundException('Payin not found');
        const payinWithCustomer = item;
        let ownerNo = payinWithCustomer.ownerNo;
        if (!ownerNo && payinWithCustomer.customer) {
            ownerNo = payinWithCustomer.customer.customerNo;
        }
        const response = {
            ...item,
            ownerNo,
            ownerType: payinWithCustomer.toWallet?.ownerType || 'CUSTOMER',
            transactionType: 'DEPOSIT',
            transactionId: item.depositId,
            transactionNo: payinWithCustomer.deposit?.depositNo,
            toWalletNo: payinWithCustomer.toWallet?.walletNo,
            fromWalletNo: payinWithCustomer.fromWallet?.walletNo,
        };
        return response;
    }
    async updateStatus(id, action) {
        const payin = await this.findOne(id);
        const currentStatus = payin.status;
        const type = payin.type;
        let nextStatus = null;
        if (type === payin_dto_1.PayinType.FIAT) {
            switch (currentStatus) {
                case payin_dto_1.PayinStatus.DETECTED:
                    if (action === payin_dto_1.PayinAction.CONFIRM)
                        nextStatus = payin_dto_1.PayinStatus.CONFIRMED;
                    if (action === payin_dto_1.PayinAction.FAIL)
                        nextStatus = payin_dto_1.PayinStatus.FAILED;
                    break;
                case payin_dto_1.PayinStatus.CONFIRMED:
                    if (action === payin_dto_1.PayinAction.CLEAR)
                        nextStatus = payin_dto_1.PayinStatus.CLEARED;
                    break;
            }
        }
        else {
            switch (currentStatus) {
                case payin_dto_1.PayinStatus.DETECTED:
                    if (action === payin_dto_1.PayinAction.BLOCK)
                        nextStatus = payin_dto_1.PayinStatus.CONFIRMING;
                    break;
                case payin_dto_1.PayinStatus.CONFIRMING:
                    if (action === payin_dto_1.PayinAction.CONFIRM)
                        nextStatus = payin_dto_1.PayinStatus.CONFIRMED;
                    if (action === payin_dto_1.PayinAction.FAIL)
                        nextStatus = payin_dto_1.PayinStatus.FAILED;
                    break;
                case payin_dto_1.PayinStatus.CONFIRMED:
                    if (action === payin_dto_1.PayinAction.CLEAR)
                        nextStatus = payin_dto_1.PayinStatus.CLEARED;
                    break;
            }
        }
        if (!nextStatus) {
            throw new common_1.BadRequestException(`Invalid transition: Cannot perform action '${action}' on payin ${id} with status '${currentStatus}' (Type: ${type})`);
        }
        this.logger.log(`Transitioning payin ${id} from ${currentStatus} to ${nextStatus} via action ${action}`);
        const historyEntry = {
            status: nextStatus,
            changedAt: new Date(),
            reason: `Action: ${action}`,
            operatorId: 'SYSTEM'
        };
        let newHistoryString;
        try {
            const history = payin.statusHistory ? JSON.parse(payin.statusHistory) : [];
            if (Array.isArray(history)) {
                history.push(historyEntry);
                newHistoryString = JSON.stringify(history);
            }
            else {
                newHistoryString = JSON.stringify([historyEntry]);
            }
        }
        catch (e) {
            newHistoryString = JSON.stringify([historyEntry]);
        }
        const updatedPayin = await this.prisma.payin.update({
            where: { id },
            data: {
                status: nextStatus,
                statusHistory: newHistoryString,
            },
        });
        await this.prisma.payinAuditLog.create({
            data: {
                payinId: id,
                operatorId: 'SYSTEM',
                oldStatus: currentStatus,
                newStatus: nextStatus,
                reason: `Action: ${action}`,
            },
        });
        this.eventEmitter.emit('payin.status.changed', new payin_events_1.PayinStatusChangedEvent(updatedPayin.id, currentStatus, nextStatus, type, updatedPayin.depositId, updatedPayin.assetId, updatedPayin.amount.toString()));
        return updatedPayin;
    }
    async linkDeposit(id, depositId) {
        return this.prisma.payin.update({
            where: { id },
            data: { depositId },
        });
    }
};
exports.PayinsService = PayinsService;
exports.PayinsService = PayinsService = PayinsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        event_emitter_1.EventEmitter2])
], PayinsService);
//# sourceMappingURL=payins.service.js.map