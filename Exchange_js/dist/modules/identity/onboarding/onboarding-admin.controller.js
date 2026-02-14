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
exports.OnboardingAdminController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const swagger_1 = require("@nestjs/swagger");
const onboarding_service_1 = require("./onboarding.service");
const onboarding_dto_1 = require("./dto/onboarding.dto");
let OnboardingAdminController = class OnboardingAdminController {
    constructor(onboardingService) {
        this.onboardingService = onboardingService;
    }
    getAdminActor(req) {
        if (req.user?.type === 'CUSTOMER') {
            throw new common_1.ForbiddenException('Admin token required');
        }
        return {
            actorId: req.user?.userId || 'ADMIN_SYSTEM',
            actorRole: req.user?.role || 'ADMIN',
        };
    }
    parseCustomerIds(raw) {
        if (!raw)
            return undefined;
        const values = raw
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
        return values.length > 0 ? values : undefined;
    }
    listCddCases(req, status, customerType, customerIds, skip, take) {
        this.getAdminActor(req);
        return this.onboardingService.listCddCases({
            status,
            customerType,
            customerIds: this.parseCustomerIds(customerIds),
            skip: skip ? Number(skip) : undefined,
            take: take ? Number(take) : undefined,
        });
    }
    reviewCddCase(req, id, body) {
        const actor = this.getAdminActor(req);
        return this.onboardingService.reviewCddCase(id, actor.actorId, actor.actorRole, body);
    }
    getCddCaseDetail(req, id) {
        this.getAdminActor(req);
        return this.onboardingService.getCddCaseDetail(id);
    }
    listEddCases(req, status, customerIds, skip, take) {
        this.getAdminActor(req);
        return this.onboardingService.listEddCases({
            status,
            customerIds: this.parseCustomerIds(customerIds),
            skip: skip ? Number(skip) : undefined,
            take: take ? Number(take) : undefined,
        });
    }
    mlroReview(req, id, body) {
        const actor = this.getAdminActor(req);
        return this.onboardingService.mlroReviewEddCase(id, actor.actorId, actor.actorRole, body);
    }
    getEddCaseDetail(req, id) {
        this.getAdminActor(req);
        return this.onboardingService.getEddCaseDetail(id);
    }
    finalReviewCustomer(req, id, body) {
        const actor = this.getAdminActor(req);
        return this.onboardingService.reviewCustomerFinalDecision(id, actor.actorId, actor.actorRole, body);
    }
    simulateExpired(req, id) {
        const actor = this.getAdminActor(req);
        return this.onboardingService.simulateCustomerExpired(id, actor.actorId, actor.actorRole);
    }
    updateInvestorClassification(req, id, body) {
        const actor = this.getAdminActor(req);
        return this.onboardingService.updateInvestorClassification(id, actor.actorId, actor.actorRole, body);
    }
};
exports.OnboardingAdminController = OnboardingAdminController;
__decorate([
    (0, common_1.Get)('cdd-cases'),
    (0, swagger_1.ApiOperation)({ summary: 'List CDD cases for compliance review' }),
    (0, swagger_1.ApiQuery)({ name: 'status', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'customerType', required: false, type: String }),
    (0, swagger_1.ApiQuery)({
        name: 'customerIds',
        required: false,
        type: String,
        description: 'Comma separated customer ids for scoped lookup',
    }),
    (0, swagger_1.ApiQuery)({ name: 'skip', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'take', required: false, type: Number }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('status')),
    __param(2, (0, common_1.Query)('customerType')),
    __param(3, (0, common_1.Query)('customerIds')),
    __param(4, (0, common_1.Query)('skip')),
    __param(5, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], OnboardingAdminController.prototype, "listCddCases", null);
__decorate([
    (0, common_1.Post)('cdd-cases/:id/review'),
    (0, swagger_1.ApiOperation)({ summary: 'Review CDD case (approve/reject/upgrade-edd)' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)(new common_1.ValidationPipe({ transform: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, onboarding_dto_1.ReviewCddCaseDto]),
    __metadata("design:returntype", void 0)
], OnboardingAdminController.prototype, "reviewCddCase", null);
__decorate([
    (0, common_1.Get)('cdd-cases/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get CDD case detail with customer snapshot and mock detail payload' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnboardingAdminController.prototype, "getCddCaseDetail", null);
__decorate([
    (0, common_1.Get)('edd-cases'),
    (0, swagger_1.ApiOperation)({ summary: 'List EDD cases for MLRO review' }),
    (0, swagger_1.ApiQuery)({ name: 'status', required: false, type: String }),
    (0, swagger_1.ApiQuery)({
        name: 'customerIds',
        required: false,
        type: String,
        description: 'Comma separated customer ids for scoped lookup',
    }),
    (0, swagger_1.ApiQuery)({ name: 'skip', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'take', required: false, type: Number }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('status')),
    __param(2, (0, common_1.Query)('customerIds')),
    __param(3, (0, common_1.Query)('skip')),
    __param(4, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", void 0)
], OnboardingAdminController.prototype, "listEddCases", null);
__decorate([
    (0, common_1.Post)('edd-cases/:id/mlro-review'),
    (0, swagger_1.ApiOperation)({ summary: 'MLRO review EDD case' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)(new common_1.ValidationPipe({ transform: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, onboarding_dto_1.ReviewEddCaseDto]),
    __metadata("design:returntype", void 0)
], OnboardingAdminController.prototype, "mlroReview", null);
__decorate([
    (0, common_1.Get)('edd-cases/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get EDD case detail with customer snapshot and mock detail payload' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnboardingAdminController.prototype, "getEddCaseDetail", null);
__decorate([
    (0, common_1.Post)('customers/:id/final-review'),
    (0, swagger_1.ApiOperation)({ summary: 'Customer-level final management decision for EDD-triggered onboarding' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)(new common_1.ValidationPipe({ transform: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, onboarding_dto_1.FinalReviewCustomerDto]),
    __metadata("design:returntype", void 0)
], OnboardingAdminController.prototype, "finalReviewCustomer", null);
__decorate([
    (0, common_1.Post)('customers/:id/simulate-expired'),
    (0, swagger_1.ApiOperation)({ summary: 'Simulate CDD document expiry and recompute compliance snapshot' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnboardingAdminController.prototype, "simulateExpired", null);
__decorate([
    (0, common_1.Patch)('customers/:id/investor-classification'),
    (0, swagger_1.ApiOperation)({ summary: 'Override investor classification with audit reason' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)(new common_1.ValidationPipe({ transform: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, onboarding_dto_1.UpdateInvestorClassificationDto]),
    __metadata("design:returntype", void 0)
], OnboardingAdminController.prototype, "updateInvestorClassification", null);
exports.OnboardingAdminController = OnboardingAdminController = __decorate([
    (0, swagger_1.ApiTags)('Admin - Onboarding'),
    (0, common_1.Controller)('admin/compliance'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [onboarding_service_1.OnboardingService])
], OnboardingAdminController);
//# sourceMappingURL=onboarding-admin.controller.js.map