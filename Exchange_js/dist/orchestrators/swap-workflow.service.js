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
var SwapWorkflowService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapWorkflowService = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const swap_events_constant_1 = require("../modules/trading/swap-transactions/constants/swap-events.constant");
const swap_transactions_service_1 = require("../modules/trading/swap-transactions/swap-transactions.service");
const journals_service_1 = require("../modules/accounting/journals/journals.service");
const swap_transaction_dto_1 = require("../modules/trading/swap-transactions/dto/swap-transaction.dto");
let SwapWorkflowService = SwapWorkflowService_1 = class SwapWorkflowService {
    constructor(swapService, journalService) {
        this.swapService = swapService;
        this.journalService = journalService;
        this.logger = new common_1.Logger(SwapWorkflowService_1.name);
    }
    onModuleInit() {
        this.logger.log('SwapWorkflowService initialized and listening for Swap events.');
    }
    async handleSwapCreated(payload) {
        this.logger.log(`Event received: ${swap_events_constant_1.SwapEvents.EVT_SWAP_CREATED} for ${payload.swapId}`);
        await this.triggerAccounting(payload.swapId, null, swap_transaction_dto_1.SwapTransactionStatus.PENDING_COMPLIANCE);
    }
    async handleSwapSuccess(payload) {
        this.logger.log(`Event received: ${swap_events_constant_1.SwapEvents.EVT_SWAP_SUCCESS} for ${payload.swapId}`);
        await this.triggerAccounting(payload.swapId, payload.oldStatus, swap_transaction_dto_1.SwapTransactionStatus.SUCCESS);
    }
    async handleSwapRejected(payload) {
        this.logger.log(`Event received: ${swap_events_constant_1.SwapEvents.EVT_SWAP_REJECTED} for ${payload.swapId}, reason: ${payload.reason}`);
        await this.triggerAccounting(payload.swapId, payload.oldStatus, swap_transaction_dto_1.SwapTransactionStatus.REJECTED);
    }
    async triggerAccounting(swapId, fromStatus, toStatus) {
        const swap = await this.swapService.findOne(swapId);
        const context = {
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
        const journal = await this.journalService.triggerEvent({
            entityType: 'SWAP',
            triggerKey: 'status',
            fromStatus: fromStatus,
            toStatus: toStatus,
            assetType: 'ALL',
            context,
            sourceId: swapId,
        });
        if (journal) {
            this.logger.log(`Accounting triggered for Swap ${swapId}: ${fromStatus} -> ${toStatus}, Journal ID: ${journal.id}`);
        }
        else {
            this.logger.warn(`No accounting event matched for Swap ${swapId}: ${fromStatus} -> ${toStatus}`);
        }
    }
};
exports.SwapWorkflowService = SwapWorkflowService;
__decorate([
    (0, event_emitter_1.OnEvent)(swap_events_constant_1.SwapEvents.EVT_SWAP_CREATED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SwapWorkflowService.prototype, "handleSwapCreated", null);
__decorate([
    (0, event_emitter_1.OnEvent)(swap_events_constant_1.SwapEvents.EVT_SWAP_SUCCESS),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SwapWorkflowService.prototype, "handleSwapSuccess", null);
__decorate([
    (0, event_emitter_1.OnEvent)(swap_events_constant_1.SwapEvents.EVT_SWAP_REJECTED),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SwapWorkflowService.prototype, "handleSwapRejected", null);
exports.SwapWorkflowService = SwapWorkflowService = SwapWorkflowService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [swap_transactions_service_1.SwapTransactionsService,
        journals_service_1.JournalsService])
], SwapWorkflowService);
//# sourceMappingURL=swap-workflow.service.js.map