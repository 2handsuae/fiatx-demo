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
var SwapWorkflowOrchestrator_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapWorkflowOrchestrator = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const event_emitter_1 = require("@nestjs/event-emitter");
const swap_events_constant_1 = require("./constants/swap-events.constant");
const no_generator_util_1 = require("../../../common/utils/no-generator.util");
const swap_transaction_dto_1 = require("./dto/swap-transaction.dto");
const swap_transactions_service_1 = require("./swap-transactions.service");
const client_1 = require("@prisma/client");
const journals_service_1 = require("../../accounting/journals/journals.service");
let SwapWorkflowOrchestrator = SwapWorkflowOrchestrator_1 = class SwapWorkflowOrchestrator {
    constructor(prisma, eventEmitter, swapService, journalsService) {
        this.prisma = prisma;
        this.eventEmitter = eventEmitter;
        this.swapService = swapService;
        this.journalsService = journalsService;
        this.logger = new common_1.Logger(SwapWorkflowOrchestrator_1.name);
    }
    createAccountingContext(swap) {
        return {
            src: {
                id: swap.id,
                swapNo: swap.swapNo,
                ownerId: swap.ownerId,
                ownerType: swap.ownerType,
                fromAssetId: swap.fromAssetId,
                toAssetId: swap.toAssetId,
                amount: swap.fromAmount.toString(),
                fromAmount: swap.fromAmount.toString(),
                toAmount: swap.toAmount.toString(),
                exchangeRate: swap.exchangeRate.toString(),
            },
        };
    }
    async createSwap(dto) {
        const result = await this.prisma.$transaction(async (tx) => {
            const swapNo = dto.swapNo || (0, no_generator_util_1.generateReferenceNo)('SWP');
            const fromAsset = await tx.asset.findUnique({
                where: { id: dto.fromAssetId },
            });
            const toAsset = await tx.asset.findUnique({
                where: { id: dto.toAssetId },
            });
            if (!fromAsset || !toAsset)
                throw new common_1.NotFoundException('Asset not found');
            if (fromAsset.type === 'FIAT' && toAsset.type === 'FIAT') {
                throw new common_1.BadRequestException('Fiat to Fiat swap is not supported');
            }
            const rate = await this.swapService.fetchMarketRate(fromAsset.code, toAsset.code);
            const fromAmount = new client_1.Prisma.Decimal(dto.fromAmount);
            const toAmount = fromAmount.mul(rate);
            const balances = await this.journalsService.getCustomerLiabilityBalance({
                ownerId: dto.ownerId,
                ownerType: dto.ownerType,
                assetId: dto.fromAssetId,
            }, tx);
            if (balances.availableBalance.lt(fromAmount)) {
                throw new common_1.BadRequestException({
                    code: 'INSUFFICIENT_AVAILABLE_BALANCE',
                    message: `Insufficient available balance for swap asset ${dto.fromAssetId}`,
                });
            }
            const transaction = await tx.swapTransaction.create({
                data: {
                    swapNo,
                    ownerType: dto.ownerType,
                    ownerId: dto.ownerId,
                    status: swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE,
                    fromAssetId: dto.fromAssetId,
                    fromAmount,
                    toAssetId: dto.toAssetId,
                    toAmount,
                    exchangeRate: rate,
                },
                include: {
                    fromAsset: true,
                    toAsset: true,
                },
            });
            const auditLog = await tx.swapTransactionAuditLog.create({
                data: {
                    swapTransactionId: transaction.id,
                    operatorId: dto.ownerId,
                    oldStatus: 'NONE',
                    newStatus: swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE,
                    reason: 'Initial creation',
                },
            });
            await this.journalsService.createJournal({
                sourceType: 'SWAP',
                sourceId: transaction.id,
                eventCode: swap_events_constant_1.SwapEvents.EVT_SWAP_CREATED,
                context: this.createAccountingContext(transaction),
            }, tx);
            return {
                swap_status_after: swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE,
                emitted_events: [swap_events_constant_1.SwapEvents.EVT_SWAP_CREATED],
                audit_log_id: auditLog.id,
                transaction,
            };
        });
        if (result.emitted_events.includes(swap_events_constant_1.SwapEvents.EVT_SWAP_CREATED)) {
            this.logger.log(`Emitting ${swap_events_constant_1.SwapEvents.EVT_SWAP_CREATED} for ${result.transaction.id}`);
            this.eventEmitter.emit(swap_events_constant_1.SwapEvents.EVT_SWAP_CREATED, {
                swapId: result.transaction.id,
            });
        }
        return result;
    }
    async handleStatusTransition(id, dto, operatorId) {
        const { currentStatus, result } = await this.prisma.$transaction(async (tx) => {
            const transaction = await tx.swapTransaction.findUnique({
                where: { id },
            });
            if (!transaction)
                throw new common_1.NotFoundException('Swap transaction not found');
            const currentStatus = transaction.status;
            const action = dto.action;
            const nextStatus = this.getNextStatus(currentStatus, action);
            const updateData = {
                status: nextStatus,
            };
            if (nextStatus === swap_transaction_dto_1.SwapTransactionStatus.SUCCESS ||
                nextStatus === swap_transaction_dto_1.SwapTransactionStatus.REJECTED) {
                updateData.completedAt = new Date();
            }
            const updated = await tx.swapTransaction.update({
                where: { id },
                data: updateData,
                include: {
                    fromAsset: true,
                    toAsset: true,
                },
            });
            const auditLog = await tx.swapTransactionAuditLog.create({
                data: {
                    swapTransactionId: id,
                    operatorId,
                    oldStatus: currentStatus,
                    newStatus: nextStatus,
                    reason: dto.reason || `Action: ${action}`,
                },
            });
            if (action === swap_transaction_dto_1.SwapTransactionAction.SUCCESS ||
                action === swap_transaction_dto_1.SwapTransactionAction.REJECT) {
                await this.journalsService.triggerEvent({
                    entityType: 'SWAP',
                    triggerKey: 'status',
                    fromStatus: currentStatus,
                    toStatus: nextStatus,
                    assetType: 'ALL',
                    context: this.createAccountingContext(updated),
                    sourceId: id,
                }, tx);
            }
            const emitted_events = [];
            const checkAndEmit = async (event, swapId, payload) => {
                const existingLog = await tx.swapTransactionAuditLog.findFirst({
                    where: {
                        swapTransactionId: swapId,
                        newStatus: nextStatus,
                        id: { not: auditLog.id },
                    },
                });
                if (!existingLog) {
                    emitted_events.push(event);
                }
                else {
                    this.logger.warn(`[Idempotency] Event ${event} for swap ${swapId} already emitted previously. Skipping.`);
                }
            };
            if (action === swap_transaction_dto_1.SwapTransactionAction.SUCCESS) {
                await checkAndEmit(swap_events_constant_1.SwapEvents.EVT_SWAP_SUCCESS, id, { swapId: id });
            }
            else if (action === swap_transaction_dto_1.SwapTransactionAction.REJECT) {
                await checkAndEmit(swap_events_constant_1.SwapEvents.EVT_SWAP_REJECTED, id, {
                    swapId: id,
                    reason: dto.reason,
                });
            }
            return {
                currentStatus,
                result: {
                    swap_status_after: nextStatus,
                    emitted_events,
                    audit_log_id: auditLog.id,
                    transaction: updated,
                }
            };
        });
        for (const event of result.emitted_events) {
            const payload = event === swap_events_constant_1.SwapEvents.EVT_SWAP_REJECTED
                ? { swapId: id, oldStatus: currentStatus, reason: dto.reason }
                : { swapId: id, oldStatus: currentStatus };
            this.logger.log(`Emitting ${event} for ${id}`);
            this.eventEmitter.emit(event, payload);
        }
        return result;
    }
    getNextStatus(current, action) {
        const transitions = {
            [swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE]: {
                [swap_transaction_dto_1.SwapTransactionAction.SUCCESS]: swap_transaction_dto_1.SwapTransactionStatus.SUCCESS,
                [swap_transaction_dto_1.SwapTransactionAction.REJECT]: swap_transaction_dto_1.SwapTransactionStatus.REJECTED,
                [swap_transaction_dto_1.SwapTransactionAction.FLAG]: swap_transaction_dto_1.SwapTransactionStatus.UNDER_REVIEW,
            },
            [swap_transaction_dto_1.SwapTransactionStatus.UNDER_REVIEW]: {
                [swap_transaction_dto_1.SwapTransactionAction.SUCCESS]: swap_transaction_dto_1.SwapTransactionStatus.SUCCESS,
                [swap_transaction_dto_1.SwapTransactionAction.REJECT]: swap_transaction_dto_1.SwapTransactionStatus.REJECTED,
            },
        };
        const nextStatus = transitions[current]?.[action];
        if (!nextStatus) {
            throw new common_1.BadRequestException(`Invalid action '${action}' for status '${current}'`);
        }
        return nextStatus;
    }
};
exports.SwapWorkflowOrchestrator = SwapWorkflowOrchestrator;
exports.SwapWorkflowOrchestrator = SwapWorkflowOrchestrator = SwapWorkflowOrchestrator_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        event_emitter_1.EventEmitter2,
        swap_transactions_service_1.SwapTransactionsService,
        journals_service_1.JournalsService])
], SwapWorkflowOrchestrator);
//# sourceMappingURL=swap-workflow.orchestrator.js.map