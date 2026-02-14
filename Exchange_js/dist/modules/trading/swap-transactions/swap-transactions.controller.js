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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapTransactionsController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const swagger_1 = require("@nestjs/swagger");
const swap_transactions_service_1 = require("./swap-transactions.service");
const swap_workflow_orchestrator_1 = require("./swap-workflow.orchestrator");
const swap_transaction_dto_1 = require("./dto/swap-transaction.dto");
let SwapTransactionsController = class SwapTransactionsController {
    constructor(swapTransactionsService, orchestrator) {
        this.swapTransactionsService = swapTransactionsService;
        this.orchestrator = orchestrator;
    }
    async create(createSwapTransactionDto) {
        return this.orchestrator.createSwap(createSwapTransactionDto);
    }
    findAll(query) {
        return this.swapTransactionsService.findAll(query);
    }
    findOne(id) {
        return this.swapTransactionsService.findOne(id);
    }
    async updateStatus(id, updateStatusDto, req) {
        const operatorId = req.user.userId || 'ADMIN_SYSTEM';
        return this.orchestrator.handleStatusTransition(id, updateStatusDto, operatorId);
    }
};
exports.SwapTransactionsController = SwapTransactionsController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new swap transaction' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [swap_transaction_dto_1.CreateSwapTransactionDto]),
    __metadata("design:returntype", Promise)
], SwapTransactionsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Get all swap transactions' }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [swap_transaction_dto_1.SwapTransactionQueryDto]),
    __metadata("design:returntype", void 0)
], SwapTransactionsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get swap transaction by ID' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SwapTransactionsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id/status'),
    (0, swagger_1.ApiOperation)({ summary: 'Update swap transaction status' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, swap_transaction_dto_1.UpdateSwapTransactionStatusDto, Object]),
    __metadata("design:returntype", Promise)
], SwapTransactionsController.prototype, "updateStatus", null);
exports.SwapTransactionsController = SwapTransactionsController = __decorate([
    (0, swagger_1.ApiTags)('Admin - Swap Transactions'),
    (0, common_1.Controller)('admin/swap-transactions'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [swap_transactions_service_1.SwapTransactionsService,
        swap_workflow_orchestrator_1.SwapWorkflowOrchestrator])
], SwapTransactionsController);
//# sourceMappingURL=swap-transactions.controller.js.map