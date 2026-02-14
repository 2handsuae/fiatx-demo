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
exports.TransactionComplianceAdminController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const swagger_1 = require("@nestjs/swagger");
const tx_compliance_dto_1 = require("./dto/tx-compliance.dto");
const transaction_compliance_service_1 = require("./transaction-compliance.service");
let TransactionComplianceAdminController = class TransactionComplianceAdminController {
    constructor(transactionComplianceService) {
        this.transactionComplianceService = transactionComplianceService;
    }
    ensureAdmin(req) {
        if (req.user?.type !== 'ADMIN') {
            throw new common_1.ForbiddenException('Admin token required');
        }
    }
    mockCompleteKytCase(req, body) {
        this.ensureAdmin(req);
        return this.transactionComplianceService.mockCompleteKytCase(body);
    }
    mockCompleteTravelRuleCase(req, body) {
        this.ensureAdmin(req);
        return this.transactionComplianceService.mockCompleteTravelRuleCase(body);
    }
    mockBackfill(req, body) {
        this.ensureAdmin(req);
        return this.transactionComplianceService.mockBackfill(body);
    }
    listKytCases(req, query) {
        this.ensureAdmin(req);
        return this.transactionComplianceService.listKytCases(query);
    }
    listTravelRuleCases(req, query) {
        this.ensureAdmin(req);
        return this.transactionComplianceService.listTravelRuleCases(query);
    }
};
exports.TransactionComplianceAdminController = TransactionComplianceAdminController;
__decorate([
    (0, common_1.Post)('tx-kyt-cases/mock-complete'),
    (0, swagger_1.ApiOperation)({ summary: 'Mock complete a KYT transaction case' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)(new common_1.ValidationPipe({ transform: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, tx_compliance_dto_1.MockKytCaseCompleteDto]),
    __metadata("design:returntype", void 0)
], TransactionComplianceAdminController.prototype, "mockCompleteKytCase", null);
__decorate([
    (0, common_1.Post)('tx-travel-rule-cases/mock-complete'),
    (0, swagger_1.ApiOperation)({ summary: 'Mock complete a travel rule transaction case' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)(new common_1.ValidationPipe({ transform: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, tx_compliance_dto_1.MockTravelRuleCaseCompleteDto]),
    __metadata("design:returntype", void 0)
], TransactionComplianceAdminController.prototype, "mockCompleteTravelRuleCase", null);
__decorate([
    (0, common_1.Post)('tx-cases/mock-backfill'),
    (0, swagger_1.ApiOperation)({ summary: 'Mock backfill pending transaction compliance cases' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)(new common_1.ValidationPipe({ transform: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, tx_compliance_dto_1.MockBackfillDto]),
    __metadata("design:returntype", void 0)
], TransactionComplianceAdminController.prototype, "mockBackfill", null);
__decorate([
    (0, common_1.Get)('tx-kyt-cases'),
    (0, swagger_1.ApiOperation)({ summary: 'List transaction KYT cases' }),
    (0, swagger_1.ApiQuery)({ name: 'sourceType', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'sourceId', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'status', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'provider', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'screeningStage', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'skip', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'take', required: false, type: Number }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)(new common_1.ValidationPipe({ transform: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, tx_compliance_dto_1.TxCaseListQueryDto]),
    __metadata("design:returntype", void 0)
], TransactionComplianceAdminController.prototype, "listKytCases", null);
__decorate([
    (0, common_1.Get)('tx-travel-rule-cases'),
    (0, swagger_1.ApiOperation)({ summary: 'List transaction travel rule cases' }),
    (0, swagger_1.ApiQuery)({ name: 'sourceType', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'sourceId', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'status', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'provider', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'skip', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'take', required: false, type: Number }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)(new common_1.ValidationPipe({ transform: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, tx_compliance_dto_1.TxCaseListQueryDto]),
    __metadata("design:returntype", void 0)
], TransactionComplianceAdminController.prototype, "listTravelRuleCases", null);
exports.TransactionComplianceAdminController = TransactionComplianceAdminController = __decorate([
    (0, swagger_1.ApiTags)('Admin - Transaction Compliance'),
    (0, common_1.Controller)('admin/compliance'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [transaction_compliance_service_1.TransactionComplianceService])
], TransactionComplianceAdminController);
//# sourceMappingURL=transaction-compliance-admin.controller.js.map