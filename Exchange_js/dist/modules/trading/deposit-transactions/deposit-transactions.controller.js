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
exports.DepositTransactionsController = void 0;
const common_1 = require("@nestjs/common");
const deposit_transactions_service_1 = require("./deposit-transactions.service");
const deposit_transaction_dto_1 = require("./dto/deposit-transaction.dto");
const swagger_1 = require("@nestjs/swagger");
const passport_1 = require("@nestjs/passport");
let DepositTransactionsController = class DepositTransactionsController {
    constructor(service) {
        this.service = service;
    }
    findMy(req, query) {
        const userId = req.user.userId;
        return this.service.findAll({ ...query, ownerId: userId });
    }
    findAll(query) {
        return this.service.findAll(query);
    }
    findOne(id) {
        return this.service.findOne(id);
    }
    create() {
        return this.service.createRandom();
    }
    updateStatus(id, dto) {
        return this.service.updateStatus(id, dto);
    }
    async export(query) {
        const result = await this.service.findAll({ ...query, take: 10000 });
        return result.items;
    }
};
exports.DepositTransactionsController = DepositTransactionsController;
__decorate([
    (0, common_1.Get)('my'),
    (0, swagger_1.ApiOperation)({ summary: 'List my deposit transactions' }),
    (0, common_1.UsePipes)(new common_1.ValidationPipe({ transform: true })),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, deposit_transaction_dto_1.DepositTransactionQueryDto]),
    __metadata("design:returntype", void 0)
], DepositTransactionsController.prototype, "findMy", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'List deposit transactions' }),
    (0, common_1.UsePipes)(new common_1.ValidationPipe({ transform: true })),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [deposit_transaction_dto_1.DepositTransactionQueryDto]),
    __metadata("design:returntype", void 0)
], DepositTransactionsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get deposit transaction details' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], DepositTransactionsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Create a random deposit transaction (Demo)' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], DepositTransactionsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id/status'),
    (0, swagger_1.ApiOperation)({ summary: 'Update deposit transaction status' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, deposit_transaction_dto_1.UpdateDepositTransactionStatusDto]),
    __metadata("design:returntype", void 0)
], DepositTransactionsController.prototype, "updateStatus", null);
__decorate([
    (0, common_1.Get)('export'),
    (0, swagger_1.ApiOperation)({ summary: 'Export deposit transactions' }),
    (0, common_1.UsePipes)(new common_1.ValidationPipe({ transform: true })),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [deposit_transaction_dto_1.DepositTransactionQueryDto]),
    __metadata("design:returntype", Promise)
], DepositTransactionsController.prototype, "export", null);
exports.DepositTransactionsController = DepositTransactionsController = __decorate([
    (0, swagger_1.ApiTags)('Deposit Transactions'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)('deposit-transactions'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    __metadata("design:paramtypes", [deposit_transactions_service_1.DepositTransactionsService])
], DepositTransactionsController);
//# sourceMappingURL=deposit-transactions.controller.js.map