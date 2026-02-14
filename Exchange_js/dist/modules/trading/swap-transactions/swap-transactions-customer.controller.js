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
exports.SwapTransactionsCustomerController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const swagger_1 = require("@nestjs/swagger");
const swap_transactions_service_1 = require("./swap-transactions.service");
const swap_workflow_orchestrator_1 = require("./swap-workflow.orchestrator");
const onboarding_service_1 = require("../../identity/onboarding/onboarding.service");
const swap_transaction_dto_1 = require("./dto/swap-transaction.dto");
let SwapTransactionsCustomerController = class SwapTransactionsCustomerController {
    constructor(swapTransactionsService, orchestrator, onboardingService) {
        this.swapTransactionsService = swapTransactionsService;
        this.orchestrator = orchestrator;
        this.onboardingService = onboardingService;
    }
    preview(dto) {
        return this.swapTransactionsService.preview(dto);
    }
    async create(req, dto) {
        dto.ownerId = req.user.userId;
        dto.ownerType = 'CUSTOMER';
        await this.onboardingService.assertTradingEligibility(dto.ownerId, 'SWAP');
        return this.orchestrator.createSwap(dto);
    }
    findMy(req, query) {
        query.ownerId = req.user.userId;
        query.ownerType = 'CUSTOMER';
        return this.swapTransactionsService.findAll(query);
    }
    async findOne(req, id) {
        const item = await this.swapTransactionsService.findOne(id);
        if (item.ownerId !== req.user.userId) {
            throw new Error('Unauthorized');
        }
        return item;
    }
};
exports.SwapTransactionsCustomerController = SwapTransactionsCustomerController;
__decorate([
    (0, common_1.Post)('preview'),
    (0, swagger_1.ApiOperation)({ summary: 'Preview swap rate and amount' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SwapTransactionsCustomerController.prototype, "preview", null);
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({
        summary: 'Create a new swap transaction for current customer',
    }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, swap_transaction_dto_1.CreateSwapTransactionDto]),
    __metadata("design:returntype", Promise)
], SwapTransactionsCustomerController.prototype, "create", null);
__decorate([
    (0, common_1.Get)('my'),
    (0, swagger_1.ApiOperation)({ summary: 'Get all swap transactions for current customer' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, swap_transaction_dto_1.SwapTransactionQueryDto]),
    __metadata("design:returntype", void 0)
], SwapTransactionsCustomerController.prototype, "findMy", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get swap transaction by ID' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], SwapTransactionsCustomerController.prototype, "findOne", null);
exports.SwapTransactionsCustomerController = SwapTransactionsCustomerController = __decorate([
    (0, swagger_1.ApiTags)('Customer - Swap Transactions'),
    (0, common_1.Controller)('swap-transactions'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [swap_transactions_service_1.SwapTransactionsService,
        swap_workflow_orchestrator_1.SwapWorkflowOrchestrator,
        onboarding_service_1.OnboardingService])
], SwapTransactionsCustomerController);
//# sourceMappingURL=swap-transactions-customer.controller.js.map