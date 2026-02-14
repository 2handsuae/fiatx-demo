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
exports.WithdrawTransactionsController = void 0;
const common_1 = require("@nestjs/common");
const withdraw_transactions_service_1 = require("./withdraw-transactions.service");
const onboarding_service_1 = require("../../identity/onboarding/onboarding.service");
const withdraw_transaction_dto_1 = require("./dto/withdraw-transaction.dto");
const swagger_1 = require("@nestjs/swagger");
const passport_1 = require("@nestjs/passport");
let WithdrawTransactionsController = class WithdrawTransactionsController {
    constructor(service, onboardingService) {
        this.service = service;
        this.onboardingService = onboardingService;
    }
    findMy(req, query) {
        const userId = req.user.userId;
        return this.service.findAll({ ...query, ownerId: userId });
    }
    findAll(query) {
        return this.service.findAll(query);
    }
    async create(req, dto) {
        const userId = req.user.userId;
        await this.onboardingService.assertTradingEligibility(userId, 'WITHDRAW');
        return this.service.create(dto, userId);
    }
    createMock() {
        return this.service.createMockData();
    }
    findOne(id) {
        return this.service.findOne(id);
    }
    updateStatus(id, dto) {
        return this.service.updateStatus(id, dto);
    }
};
exports.WithdrawTransactionsController = WithdrawTransactionsController;
__decorate([
    (0, common_1.Get)('my'),
    (0, swagger_1.ApiOperation)({ summary: 'List my withdraw transactions' }),
    (0, common_1.UsePipes)(new common_1.ValidationPipe({ transform: true })),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, withdraw_transaction_dto_1.WithdrawTransactionQueryDto]),
    __metadata("design:returntype", void 0)
], WithdrawTransactionsController.prototype, "findMy", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'List withdraw transactions' }),
    (0, common_1.UsePipes)(new common_1.ValidationPipe({ transform: true })),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [withdraw_transaction_dto_1.WithdrawTransactionQueryDto]),
    __metadata("design:returntype", void 0)
], WithdrawTransactionsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Create a withdrawal request' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, withdraw_transaction_dto_1.CreateWithdrawTransactionDto]),
    __metadata("design:returntype", Promise)
], WithdrawTransactionsController.prototype, "create", null);
__decorate([
    (0, common_1.Post)('mock'),
    (0, swagger_1.ApiOperation)({ summary: 'Create 10 mock withdraw transactions' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], WithdrawTransactionsController.prototype, "createMock", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get withdraw transaction details' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], WithdrawTransactionsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id/status'),
    (0, swagger_1.ApiOperation)({ summary: 'Update withdraw transaction status' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, withdraw_transaction_dto_1.UpdateWithdrawTransactionStatusDto]),
    __metadata("design:returntype", void 0)
], WithdrawTransactionsController.prototype, "updateStatus", null);
exports.WithdrawTransactionsController = WithdrawTransactionsController = __decorate([
    (0, swagger_1.ApiTags)('Withdraw Transactions'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)('withdraw-transactions'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    __metadata("design:paramtypes", [withdraw_transactions_service_1.WithdrawTransactionsService,
        onboarding_service_1.OnboardingService])
], WithdrawTransactionsController);
//# sourceMappingURL=withdraw-transactions.controller.js.map