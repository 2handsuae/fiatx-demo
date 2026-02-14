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
var WithdrawWorkflowOrchestrator_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WithdrawWorkflowOrchestrator = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const prisma_service_1 = require("../core/prisma/prisma.service");
const withdraw_transactions_service_1 = require("../modules/trading/withdraw-transactions/withdraw-transactions.service");
const payouts_service_1 = require("../modules/asset-treasury/payouts/payouts.service");
const journals_service_1 = require("../modules/accounting/journals/journals.service");
const clearings_service_1 = require("../modules/clearing-settle/clearing/clearings.service");
const withdraw_events_constant_1 = require("../modules/trading/withdraw-transactions/constants/withdraw-events.constant");
const payout_events_constant_1 = require("../modules/asset-treasury/payouts/constants/payout-events.constant");
const withdraw_transaction_dto_1 = require("../modules/trading/withdraw-transactions/dto/withdraw-transaction.dto");
const payout_dto_1 = require("../modules/asset-treasury/payouts/dto/payout.dto");
let WithdrawWorkflowOrchestrator = WithdrawWorkflowOrchestrator_1 = class WithdrawWorkflowOrchestrator {
    constructor(prisma, eventEmitter, withdrawalService, payoutsService, journalsService, clearingsService) {
        this.prisma = prisma;
        this.eventEmitter = eventEmitter;
        this.withdrawalService = withdrawalService;
        this.payoutsService = payoutsService;
        this.journalsService = journalsService;
        this.clearingsService = clearingsService;
        this.logger = new common_1.Logger(WithdrawWorkflowOrchestrator_1.name);
    }
    async onWithdrawalCreated(payload) {
        return this.orchestrateWithdrawalEvent(payload.withdrawId, withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_CREATED);
    }
    async onWithdrawalCancelled(payload) {
        return this.orchestrateWithdrawalEvent(payload.withdrawId, withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_CANCELLED);
    }
    async onWithdrawalRejected(payload) {
        return this.orchestrateWithdrawalEvent(payload.withdrawId, withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_REJECTED);
    }
    async onWithdrawalApprovedCrypto(payload) {
        return this.orchestrateWithdrawalEvent(payload.withdrawId, withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_APPROVED__CRYPTO);
    }
    async onWithdrawalApprovedFiat(payload) {
        return this.orchestrateWithdrawalEvent(payload.withdrawId, withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_APPROVED__FIAT);
    }
    async onPayoutConfirmed(payload) {
        return this.orchestrateSuccessPath(payload.withdrawId, payload.payoutId);
    }
    async onWithdrawalFailedCrypto(payload) {
        return this.orchestratePayoutEvent(payload.withdrawId, payload.payoutId, payload.status);
    }
    async onWithdrawalFailedFiat(payload) {
        return this.orchestratePayoutEvent(payload.withdrawId, payload.payoutId, payload.status);
    }
    async onPayoutReturned(payload) {
        return this.orchestratePayoutEvent(payload.withdrawId, payload.payoutId, payout_dto_1.PayoutStatus.RETURNED);
    }
    async orchestrateWithdrawalEvent(withdrawId, eventType) {
        this.logger.log(`Orchestrating Withdrawal Event: ${eventType} for ${withdrawId}`);
        if (await this.checkIdempotency(withdrawId, eventType)) {
            this.logger.warn(`Event ${eventType} for withdrawal ${withdrawId} already processed.`);
            return null;
        }
        const withdrawal = await this.withdrawalService.findOne(withdrawId);
        const suffix = this.getSuffix(withdrawal);
        const isCustomer = withdrawal.ownerType === 'CUSTOMER';
        const result = {
            payout_binding_status: 'unchanged',
            emitted_events: [eventType],
            created_or_reversed_journal_entry_ids: [],
            audit_log_id: '',
        };
        if (eventType === withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_CREATED) {
            if (isCustomer) {
                const je = await this.journalsService.triggerEvent({
                    entityType: 'WITHDRAW',
                    triggerKey: 'status',
                    toStatus: withdraw_transaction_dto_1.WithdrawTransactionStatus.CREATED,
                    assetType: suffix,
                    context: this.createAccountingContext(withdrawal),
                    sourceId: withdrawal.id,
                });
                if (je)
                    result.created_or_reversed_journal_entry_ids.push(je.id);
            }
            await this.prisma.withdrawAuditLog.create({
                data: {
                    withdrawTransactionId: withdrawId,
                    operatorId: 'SYSTEM',
                    oldStatus: withdrawal.status,
                    newStatus: withdrawal.status,
                    reason: `[${eventType}] Initial accounting processed`,
                },
            });
        }
        else if (eventType === withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_CANCELLED || eventType === withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_REJECTED) {
            if (isCustomer) {
                const je = await this.journalsService.triggerEvent({
                    entityType: 'WITHDRAW',
                    triggerKey: 'status',
                    toStatus: withdrawal.status,
                    assetType: suffix,
                    context: this.createAccountingContext(withdrawal),
                    sourceId: withdrawal.id,
                });
                if (je)
                    result.created_or_reversed_journal_entry_ids.push(je.id);
            }
            await this.prisma.withdrawAuditLog.create({
                data: {
                    withdrawTransactionId: withdrawId,
                    operatorId: 'SYSTEM',
                    oldStatus: withdrawal.status,
                    newStatus: withdrawal.status,
                    reason: `[${eventType}] Cancellation accounting processed`,
                },
            });
        }
        else if (eventType === withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_APPROVED__CRYPTO || eventType === withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_APPROVED__FIAT) {
            await this.prisma.$transaction(async (tx) => {
                await this.clearingsService.triggerClearing({
                    sourceType: 'WITHDRAWAL',
                    sourceId: withdrawal.id,
                    eventCode: eventType,
                    context: this.createAccountingContext(withdrawal),
                }, tx);
                const updatedAfterClearing = await tx.withdrawTransaction.findUnique({
                    where: { id: withdrawId },
                });
                if (!updatedAfterClearing) {
                    throw new Error(`Withdrawal ${withdrawId} not found after clearing`);
                }
                if (isCustomer) {
                    const je = await this.journalsService.triggerEvent({
                        entityType: 'WITHDRAW',
                        triggerKey: 'status',
                        toStatus: withdraw_transaction_dto_1.WithdrawTransactionStatus.PAYOUT_PENDING,
                        assetType: suffix,
                        context: this.createAccountingContext(updatedAfterClearing),
                        sourceId: updatedAfterClearing.id,
                    }, tx);
                    if (je)
                        result.created_or_reversed_journal_entry_ids.push(je.id);
                }
                const payout = await this.payoutsService.create({
                    withdrawId: updatedAfterClearing.id,
                    type: suffix === 'CRYPTO' ? payout_dto_1.PayoutType.CRYPTO : payout_dto_1.PayoutType.FIAT,
                    amount: updatedAfterClearing.netAmount.toString(),
                    assetId: updatedAfterClearing.assetId,
                    toAddress: updatedAfterClearing.toAddress || undefined,
                    toIban: updatedAfterClearing.toIban || undefined,
                    toWalletId: updatedAfterClearing.toWalletId || undefined,
                }, 'SYSTEM', tx);
                result.payout_binding_status = 'created';
                const updatedStatus = await this.withdrawalService.updateStatus(withdrawId, {
                    action: withdraw_transaction_dto_1.WithdrawTransactionAction.APPROVE,
                    reason: `[${eventType}] Payout initiated: ${payout.id}`,
                }, tx);
                result.updated_withdrawal_status = updatedStatus.status;
            });
        }
        const latestLog = await this.getLatestAuditLog(withdrawId);
        result.audit_log_id = latestLog?.id || '';
        this.logger.log(`Orchestration Result: ${JSON.stringify(result)}`);
        return result;
    }
    async orchestrateSuccessPath(withdrawId, payoutId) {
        this.logger.log(`Orchestrating Atomic Success Path for Withdrawal ${withdrawId} and Payout ${payoutId}`);
        const eventType = 'SUCCESS_PATH_ATOMIC';
        if (await this.checkIdempotency(withdrawId, eventType)) {
            this.logger.warn(`Success path for withdrawal ${withdrawId} already processed.`);
            return null;
        }
        const withdrawal = await this.withdrawalService.findOne(withdrawId);
        if (withdrawal.status !== withdraw_transaction_dto_1.WithdrawTransactionStatus.PAYOUT_PENDING) {
            this.logger.warn(`Withdrawal ${withdrawId} is not in PAYOUT_PENDING. Skipping success path.`);
            return null;
        }
        const isCustomer = withdrawal.ownerType === 'CUSTOMER';
        const suffix = this.getSuffix(withdrawal);
        const result = {
            payout_binding_status: 'unchanged',
            emitted_events: [],
            created_or_reversed_journal_entry_ids: [],
            audit_log_id: '',
        };
        return await this.prisma.$transaction(async (tx) => {
            const updatedWithdrawal = await this.withdrawalService.updateStatus(withdrawId, {
                action: withdraw_transaction_dto_1.WithdrawTransactionAction.SUCCESS,
                reason: `[${eventType}] Payout confirmed. Setting withdrawal to SUCCESS.`,
            }, tx);
            result.updated_withdrawal_status = updatedWithdrawal.status;
            if (isCustomer) {
                const je = await this.journalsService.triggerEvent({
                    entityType: 'WITHDRAW',
                    triggerKey: 'status',
                    toStatus: withdraw_transaction_dto_1.WithdrawTransactionStatus.SUCCESS,
                    assetType: suffix,
                    context: this.createAccountingContext(updatedWithdrawal),
                    sourceId: updatedWithdrawal.id,
                }, tx);
                if (je)
                    result.created_or_reversed_journal_entry_ids.push(je.id);
            }
            const updatedPayout = await this.payoutsService.updateStatus(payoutId, {
                action: payout_dto_1.PayoutAction.CLEAR,
                reason: `[${eventType}] Internal accounting completed successfully.`,
            }, 'SYSTEM', tx);
            result.updated_payout_status = updatedPayout.status;
            const log = await tx.withdrawAuditLog.create({
                data: {
                    withdrawTransactionId: withdrawId,
                    operatorId: 'SYSTEM',
                    oldStatus: withdrawal.status,
                    newStatus: updatedWithdrawal.status,
                    reason: `[${eventType}] Atomic success path completed.`,
                },
            });
            result.audit_log_id = log.id;
            this.logger.log(`Atomic Success Path Result: ${JSON.stringify(result)}`);
            return result;
        });
    }
    async orchestratePayoutEvent(withdrawId, payoutId, status) {
        this.logger.log(`Orchestrating Payout Result: ${status} for Withdrawal ${withdrawId}`);
        const withdrawal = await this.withdrawalService.findOne(withdrawId);
        if (withdrawal.status !== withdraw_transaction_dto_1.WithdrawTransactionStatus.PAYOUT_PENDING && status !== payout_dto_1.PayoutStatus.RETURNED) {
            this.logger.warn(`Withdrawal ${withdrawId} is not in PAYOUT_PENDING. Skipping back-propagation.`);
            return null;
        }
        const isCustomer = withdrawal.ownerType === 'CUSTOMER';
        const suffix = this.getSuffix(withdrawal);
        const result = {
            payout_binding_status: 'unchanged',
            emitted_events: [],
            created_or_reversed_journal_entry_ids: [],
            audit_log_id: '',
        };
        if (status === payout_dto_1.PayoutStatus.FAILED || status === payout_dto_1.PayoutStatus.TIMEOUT || status === payout_dto_1.PayoutStatus.RETURNED) {
            const isReturn = status === payout_dto_1.PayoutStatus.RETURNED;
            const feedbackEvent = isReturn ? withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_RETURNED__FIAT : `EVT_WITHDRAWAL_FAILED__${suffix}`;
            await this.prisma.$transaction(async (tx) => {
                const updatedWithdrawal = await this.withdrawalService.updateStatus(withdrawId, {
                    action: isReturn
                        ? withdraw_transaction_dto_1.WithdrawTransactionAction.RETURN
                        : withdraw_transaction_dto_1.WithdrawTransactionAction.FAIL,
                    reason: `[${feedbackEvent}] Payout ${payoutId} ${status.toLowerCase()}. Performing full reversal.`,
                }, tx);
                result.updated_withdrawal_status = updatedWithdrawal.status;
                if (isCustomer) {
                    const journals = await tx.journal.findMany({
                        where: { sourceId: withdrawId, sourceType: 'WITHDRAW' },
                    });
                    for (const journal of journals) {
                        if (journal.reversalOfJournalId)
                            continue;
                        const reversal = await this.journalsService.reverseJournal({
                            sourceType: 'WITHDRAW',
                            sourceId: withdrawId,
                            reversalEventCode: `REV_${journal.eventCode}`,
                            targetEventCode: journal.eventCode,
                            context: this.createAccountingContext(updatedWithdrawal),
                        }, tx);
                        if (reversal)
                            result.created_or_reversed_journal_entry_ids.push(reversal.id);
                    }
                }
                await this.clearingsService.updateStatusBySource(withdrawId, 'CANCELLED', tx);
            });
            this.eventEmitter.emit(feedbackEvent, { withdrawId, payoutId, status });
            result.emitted_events.push(feedbackEvent);
        }
        const latestLog = await this.getLatestAuditLog(withdrawId);
        result.audit_log_id = latestLog?.id || '';
        this.logger.log(`Orchestration Result: ${JSON.stringify(result)}`);
        return result;
    }
    getSuffix(withdrawal) {
        return withdrawal.type.toUpperCase();
    }
    async checkIdempotency(withdrawId, eventType) {
        const existingLog = await this.prisma.withdrawAuditLog.findFirst({
            where: {
                withdrawTransactionId: withdrawId,
                reason: { contains: eventType },
            },
        });
        return !!existingLog;
    }
    async getLatestAuditLog(withdrawId) {
        return this.prisma.withdrawAuditLog.findFirst({
            where: { withdrawTransactionId: withdrawId },
            orderBy: { createdAt: 'desc' },
        });
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
};
exports.WithdrawWorkflowOrchestrator = WithdrawWorkflowOrchestrator;
__decorate([
    (0, event_emitter_1.OnEvent)(withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_CREATED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WithdrawWorkflowOrchestrator.prototype, "onWithdrawalCreated", null);
__decorate([
    (0, event_emitter_1.OnEvent)(withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_CANCELLED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WithdrawWorkflowOrchestrator.prototype, "onWithdrawalCancelled", null);
__decorate([
    (0, event_emitter_1.OnEvent)(withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_REJECTED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WithdrawWorkflowOrchestrator.prototype, "onWithdrawalRejected", null);
__decorate([
    (0, event_emitter_1.OnEvent)(withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_APPROVED__CRYPTO),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WithdrawWorkflowOrchestrator.prototype, "onWithdrawalApprovedCrypto", null);
__decorate([
    (0, event_emitter_1.OnEvent)(withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_APPROVED__FIAT),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WithdrawWorkflowOrchestrator.prototype, "onWithdrawalApprovedFiat", null);
__decorate([
    (0, event_emitter_1.OnEvent)(payout_events_constant_1.PayoutEvents.EVT_PAYOUT_CONFIRMED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WithdrawWorkflowOrchestrator.prototype, "onPayoutConfirmed", null);
__decorate([
    (0, event_emitter_1.OnEvent)(withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_FAILED__CRYPTO),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WithdrawWorkflowOrchestrator.prototype, "onWithdrawalFailedCrypto", null);
__decorate([
    (0, event_emitter_1.OnEvent)(withdraw_events_constant_1.WithdrawEvents.EVT_WITHDRAWAL_FAILED__FIAT),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WithdrawWorkflowOrchestrator.prototype, "onWithdrawalFailedFiat", null);
__decorate([
    (0, event_emitter_1.OnEvent)(payout_events_constant_1.PayoutEvents.EVT_PAYOUT_RETURNED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WithdrawWorkflowOrchestrator.prototype, "onPayoutReturned", null);
exports.WithdrawWorkflowOrchestrator = WithdrawWorkflowOrchestrator = WithdrawWorkflowOrchestrator_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        event_emitter_1.EventEmitter2,
        withdraw_transactions_service_1.WithdrawTransactionsService,
        payouts_service_1.PayoutsService,
        journals_service_1.JournalsService,
        clearings_service_1.ClearingsService])
], WithdrawWorkflowOrchestrator);
//# sourceMappingURL=withdraw-workflow.orchestrator.js.map