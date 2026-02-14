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
var DepositWorkflowService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DepositWorkflowService = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const payin_events_1 = require("../modules/asset-treasury/payins/events/payin.events");
const payin_dto_1 = require("../modules/asset-treasury/payins/dto/payin.dto");
const deposit_transactions_service_1 = require("../modules/trading/deposit-transactions/deposit-transactions.service");
const journals_service_1 = require("../modules/accounting/journals/journals.service");
const deposit_transaction_dto_1 = require("../modules/trading/deposit-transactions/dto/deposit-transaction.dto");
const payins_service_1 = require("../modules/asset-treasury/payins/payins.service");
const deposit_transaction_events_1 = require("../modules/trading/deposit-transactions/events/deposit-transaction.events");
const prisma_service_1 = require("../core/prisma/prisma.service");
let DepositWorkflowService = DepositWorkflowService_1 = class DepositWorkflowService {
    constructor(depositService, journalService, payinsService, eventEmitter, prisma) {
        this.depositService = depositService;
        this.journalService = journalService;
        this.payinsService = payinsService;
        this.eventEmitter = eventEmitter;
        this.prisma = prisma;
        this.logger = new common_1.Logger(DepositWorkflowService_1.name);
    }
    onModuleInit() {
        this.logger.log('DepositWorkflowOrchestrator initialized and listening for events.');
    }
    async handlePayinCreated(event) {
        const { payinId, status } = event;
        this.logger.log(`Orchestrating new PayIn ${payinId} with status ${status}`);
        if (status === payin_dto_1.PayinStatus.DETECTED) {
            const result = await this.orchestratePayinDetected(payinId);
            this.logger.log(`Initial orchestration complete for PayIn ${payinId}: ${JSON.stringify(result)}`);
            return result;
        }
        return null;
    }
    async handlePayinStatusChanged(event) {
        const { payinId, newStatus } = event;
        this.logger.log(`Orchestrating PayIn ${payinId} transition to ${newStatus}`);
        let result = null;
        switch (newStatus) {
            case payin_dto_1.PayinStatus.DETECTED:
                result = await this.orchestratePayinDetected(payinId);
                break;
            case payin_dto_1.PayinStatus.FAILED:
                result = await this.orchestratePayinFailed(payinId);
                break;
            case payin_dto_1.PayinStatus.CONFIRMED:
                result = await this.orchestratePayinConfirmed(payinId);
                break;
        }
        if (result) {
            this.logger.log(`Orchestration complete for PayIn ${payinId}: ${JSON.stringify(result)}`);
        }
        return result;
    }
    async handleDepositStatusChanged(event) {
        const { depositId, newStatus, payinId } = event;
        this.logger.log(`Orchestrating Deposit ${depositId} transition to ${newStatus}`);
        let result = null;
        switch (newStatus) {
            case deposit_transaction_dto_1.DepositTransactionStatus.SUCCESS:
                result = await this.orchestrateDepositSuccess(depositId);
                break;
            case deposit_transaction_dto_1.DepositTransactionStatus.REJECTED:
                result = await this.orchestrateDepositRejected(depositId, payinId);
                break;
        }
        if (result) {
            this.logger.log(`Orchestration complete for Deposit ${depositId}: ${JSON.stringify(result)}`);
        }
        return result;
    }
    async orchestratePayinDetected(payinId) {
        const result = { emitted_events: [], created_or_reversed_journal_entry_ids: [] };
        let deposit = await this.findDepositByPayinId(payinId);
        if (!deposit) {
            const payin = await this.payinsService.findOne(payinId);
            deposit = await this.depositService.createFromPayin(payin.amount.toString(), payin.assetId, payin.toWalletId, payin.txHash || undefined, payin.fromAddress || undefined, payin.id);
            await this.payinsService.linkDeposit(payinId, deposit.id);
            result.updated_deposit_status = deposit.status;
        }
        else {
            if (deposit.status !== deposit_transaction_dto_1.DepositTransactionStatus.PAYIN_PENDING &&
                deposit.status !== deposit_transaction_dto_1.DepositTransactionStatus.SUCCESS &&
                deposit.status !== deposit_transaction_dto_1.DepositTransactionStatus.FAILED &&
                deposit.status !== deposit_transaction_dto_1.DepositTransactionStatus.REJECTED) {
                this.logger.debug(`Deposit ${deposit.id} already in status ${deposit.status}. Skipping reset to PAYIN_PENDING.`);
            }
        }
        return result;
    }
    async orchestratePayinFailed(payinId) {
        const result = { emitted_events: [], created_or_reversed_journal_entry_ids: [] };
        const deposit = await this.findDepositByPayinId(payinId);
        if (deposit && deposit.status !== deposit_transaction_dto_1.DepositTransactionStatus.FAILED && deposit.status !== deposit_transaction_dto_1.DepositTransactionStatus.REJECTED) {
            const updated = await this.depositService.updateStatus(deposit.id, {
                action: deposit_transaction_dto_1.DepositTransactionAction.FAIL,
                reason: 'PayIn failed',
            });
            result.updated_deposit_status = updated.status;
        }
        return result;
    }
    async orchestratePayinConfirmed(payinId) {
        const result = { emitted_events: [], created_or_reversed_journal_entry_ids: [] };
        const deposit = await this.findDepositByPayinId(payinId);
        if (!deposit)
            return result;
        const payin = await this.payinsService.findOne(payinId);
        if (payin.status === payin_dto_1.PayinStatus.CLEARED) {
            this.logger.debug(`PayIn ${payinId} already CLEARED. Skipping confirmed orchestration.`);
            return result;
        }
        if (deposit.status === deposit_transaction_dto_1.DepositTransactionStatus.PAYIN_PENDING) {
            const updated = await this.depositService.updateStatus(deposit.id, {
                action: deposit_transaction_dto_1.DepositTransactionAction.PAYIN_CONFIRMED,
            });
            result.updated_deposit_status = updated.status;
        }
        const suffix = this.getSuffix(payin);
        const eventCode = `EVT_DEPOSIT_CONFIRMED__${suffix}`;
        this.eventEmitter.emit(eventCode, { depositId: deposit.id, payinId });
        result.emitted_events.push(eventCode);
        if (deposit.ownerType === deposit_transaction_dto_1.DepositOwnerType.CUSTOMER) {
            const journal = await this.triggerAccounting(deposit, eventCode);
            if (journal) {
                result.created_or_reversed_journal_entry_ids.push(journal.id);
            }
        }
        const updatedPayin = await this.payinsService.updateStatus(payinId, payin_dto_1.PayinAction.CLEAR);
        result.updated_payin_status = updatedPayin.status;
        return result;
    }
    async orchestrateDepositSuccess(depositId) {
        const result = { emitted_events: [], created_or_reversed_journal_entry_ids: [] };
        const deposit = await this.depositService.findOne(depositId);
        const payin = deposit.payinId ? await this.payinsService.findOne(deposit.payinId) : null;
        const suffix = payin ? this.getSuffix(payin) : 'FIAT';
        const eventCode = `EVT_DEPOSIT_SUCCESS__${suffix}`;
        this.eventEmitter.emit(eventCode, { depositId });
        result.emitted_events.push(eventCode);
        if (deposit.ownerType === deposit_transaction_dto_1.DepositOwnerType.CUSTOMER) {
            const journal = await this.triggerAccounting(deposit, eventCode);
            if (journal) {
                result.created_or_reversed_journal_entry_ids.push(journal.id);
            }
        }
        result.updated_deposit_status = deposit.status;
        return result;
    }
    async orchestrateDepositRejected(depositId, payinId) {
        const result = {
            emitted_events: [],
            created_or_reversed_journal_entry_ids: [],
        };
        return this.prisma.$transaction(async (tx) => {
            const deposit = await tx.depositTransaction.findUnique({
                where: { id: depositId },
            });
            if (!deposit) {
                return result;
            }
            const targetPayinId = payinId || deposit.payinId;
            const payin = targetPayinId
                ? await tx.payin.findUnique({ where: { id: targetPayinId } })
                : null;
            const suffix = payin ? this.getSuffix(payin) : 'FIAT';
            const confirmedEventCode = `EVT_DEPOSIT_CONFIRMED__${suffix}`;
            const reversalEventCode = `REV_${confirmedEventCode}`;
            const confirmedJournal = await tx.journal.findFirst({
                where: {
                    sourceType: 'DEPOSIT',
                    sourceId: depositId,
                    eventCode: confirmedEventCode,
                },
            });
            if (confirmedJournal) {
                const existingReversal = await tx.journal.findFirst({
                    where: {
                        sourceType: 'DEPOSIT',
                        sourceId: depositId,
                        eventCode: reversalEventCode,
                    },
                });
                if (!existingReversal) {
                    const reversal = await this.journalService.reverseJournal({
                        sourceType: 'DEPOSIT',
                        sourceId: depositId,
                        reversalEventCode,
                        targetEventCode: confirmedEventCode,
                        context: {
                            src: {
                                ownerId: deposit.ownerId,
                                ownerType: deposit.ownerType,
                                assetId: deposit.assetId,
                                depositId: deposit.id,
                                amount: deposit.amount.toString(),
                                depositNo: deposit.depositNo,
                                walletId: deposit.toWalletId,
                            },
                        },
                    }, tx);
                    if (reversal) {
                        result.created_or_reversed_journal_entry_ids.push(reversal.id);
                    }
                }
            }
            if (payin && payin.status !== payin_dto_1.PayinStatus.CLEARED) {
                let history = [];
                try {
                    history = payin.statusHistory ? JSON.parse(payin.statusHistory) : [];
                    if (!Array.isArray(history))
                        history = [];
                }
                catch {
                    history = [];
                }
                history.push({
                    status: payin_dto_1.PayinStatus.CLEARED,
                    changedAt: new Date(),
                    reason: 'Deposit rejected: clearing payin',
                    operatorId: 'SYSTEM',
                });
                const updatedPayin = await tx.payin.update({
                    where: { id: payin.id },
                    data: {
                        status: payin_dto_1.PayinStatus.CLEARED,
                        statusHistory: JSON.stringify(history),
                    },
                });
                await tx.payinAuditLog.create({
                    data: {
                        payinId: payin.id,
                        operatorId: 'SYSTEM',
                        oldStatus: payin.status,
                        newStatus: payin_dto_1.PayinStatus.CLEARED,
                        reason: 'Deposit rejected orchestration',
                    },
                });
                result.updated_payin_status = updatedPayin.status;
            }
            else if (payin) {
                result.updated_payin_status = payin.status;
            }
            result.updated_deposit_status = deposit_transaction_dto_1.DepositTransactionStatus.REJECTED;
            return result;
        });
    }
    async triggerAccounting(deposit, eventCode) {
        const existingJournal = await this.prisma.journal.findFirst({
            where: {
                sourceId: deposit.id,
                eventCode: eventCode,
            },
        });
        if (existingJournal) {
            this.logger.debug(`Accounting already processed for ${deposit.id} and ${eventCode}`);
            return existingJournal;
        }
        const context = {
            src: {
                ownerId: deposit.ownerId,
                ownerType: deposit.ownerType,
                assetId: deposit.assetId,
                depositId: deposit.id,
                amount: deposit.amount.toString(),
                depositNo: deposit.depositNo,
                walletId: deposit.toWalletId,
            },
        };
        return this.journalService.createJournal({
            sourceType: 'DEPOSIT',
            sourceId: deposit.id,
            eventCode: eventCode,
            context,
        });
    }
    getSuffix(payin) {
        return payin.type.toUpperCase();
    }
    async findDepositByPayinId(payinId) {
        return this.prisma.depositTransaction.findUnique({
            where: { payinId },
        });
    }
};
exports.DepositWorkflowService = DepositWorkflowService;
__decorate([
    (0, event_emitter_1.OnEvent)('payin.created'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [payin_events_1.PayinCreatedEvent]),
    __metadata("design:returntype", Promise)
], DepositWorkflowService.prototype, "handlePayinCreated", null);
__decorate([
    (0, event_emitter_1.OnEvent)('payin.status.changed'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [payin_events_1.PayinStatusChangedEvent]),
    __metadata("design:returntype", Promise)
], DepositWorkflowService.prototype, "handlePayinStatusChanged", null);
__decorate([
    (0, event_emitter_1.OnEvent)('deposit.status.changed'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [deposit_transaction_events_1.DepositStatusChangedEvent]),
    __metadata("design:returntype", Promise)
], DepositWorkflowService.prototype, "handleDepositStatusChanged", null);
exports.DepositWorkflowService = DepositWorkflowService = DepositWorkflowService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [deposit_transactions_service_1.DepositTransactionsService,
        journals_service_1.JournalsService,
        payins_service_1.PayinsService,
        event_emitter_1.EventEmitter2,
        prisma_service_1.PrismaService])
], DepositWorkflowService);
//# sourceMappingURL=deposit-workflow.service.js.map