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
exports.OnboardingCustomerController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const swagger_1 = require("@nestjs/swagger");
const onboarding_service_1 = require("./onboarding.service");
const onboarding_dto_1 = require("./dto/onboarding.dto");
let OnboardingCustomerController = class OnboardingCustomerController {
    constructor(onboardingService) {
        this.onboardingService = onboardingService;
    }
    ensureCustomer(req) {
        if (req.user?.type !== 'CUSTOMER') {
            throw new common_1.ForbiddenException('Customer token required');
        }
        return req.user.userId;
    }
    getMyOnboarding(req) {
        const customerId = this.ensureCustomer(req);
        return this.onboardingService.getMyOnboarding(customerId);
    }
    listMyCases(req) {
        const customerId = this.ensureCustomer(req);
        return this.onboardingService.listMyCases(customerId);
    }
    getNextStep(req) {
        const customerId = this.ensureCustomer(req);
        return this.onboardingService.getNextStep(customerId);
    }
    upsertEntity(req, body) {
        const customerId = this.ensureCustomer(req);
        return this.onboardingService.upsertEntity(customerId, customerId, body);
    }
    bootstrapCddCases(req, body) {
        const customerId = this.ensureCustomer(req);
        return this.onboardingService.startCddCases(customerId, customerId, body);
    }
    reinitiateCddCases(req) {
        const customerId = this.ensureCustomer(req);
        return this.onboardingService.reinitiateCddCases(customerId, customerId);
    }
    startEddCases(req) {
        const customerId = this.ensureCustomer(req);
        return this.onboardingService.startEddCases(customerId, customerId);
    }
    reinitiateEddCases(req, body) {
        const customerId = this.ensureCustomer(req);
        return this.onboardingService.reinitiateEddCases(customerId, customerId, body);
    }
    createCaseSession(req, id, body) {
        const customerId = this.ensureCustomer(req);
        return this.onboardingService.createCaseSession(customerId, customerId, id, body);
    }
    mockCompleteSession(req, sessionId, body) {
        const customerId = this.ensureCustomer(req);
        return this.onboardingService.mockCompleteSession(customerId, customerId, sessionId, body);
    }
};
exports.OnboardingCustomerController = OnboardingCustomerController;
__decorate([
    (0, common_1.Get)('me'),
    (0, swagger_1.ApiOperation)({ summary: 'Get my onboarding status and active cases' }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], OnboardingCustomerController.prototype, "getMyOnboarding", null);
__decorate([
    (0, common_1.Get)('cases'),
    (0, swagger_1.ApiOperation)({ summary: 'List my CDD/EDD cases with latest provider session status' }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], OnboardingCustomerController.prototype, "listMyCases", null);
__decorate([
    (0, common_1.Get)('next-step'),
    (0, swagger_1.ApiOperation)({ summary: 'Get single-path onboarding next step' }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OnboardingCustomerController.prototype, "getNextStep", null);
__decorate([
    (0, common_1.Post)('entity'),
    (0, swagger_1.ApiOperation)({ summary: 'Save entity profile without changing registered customer type' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)(new common_1.ValidationPipe({ transform: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, onboarding_dto_1.UpsertEntityDto]),
    __metadata("design:returntype", void 0)
], OnboardingCustomerController.prototype, "upsertEntity", null);
__decorate([
    (0, common_1.Post)('cdd-cases/bootstrap'),
    (0, swagger_1.ApiOperation)({ summary: 'Start CDD journey: bootstrap required CDD cases and auto-create QR session' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)(new common_1.ValidationPipe({ transform: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, onboarding_dto_1.BootstrapCasesDto]),
    __metadata("design:returntype", void 0)
], OnboardingCustomerController.prototype, "bootstrapCddCases", null);
__decorate([
    (0, common_1.Post)('cdd-cases/reinitiate'),
    (0, swagger_1.ApiOperation)({ summary: 'Re-initiate CDD and auto-create QR session for current CDD case' }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], OnboardingCustomerController.prototype, "reinitiateCddCases", null);
__decorate([
    (0, common_1.Post)('edd-cases/start'),
    (0, swagger_1.ApiOperation)({ summary: 'Start EDD current case and auto-create QR session' }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], OnboardingCustomerController.prototype, "startEddCases", null);
__decorate([
    (0, common_1.Post)('edd-cases/reinitiate'),
    (0, swagger_1.ApiOperation)({ summary: 'Re-initiate EDD cases after EDD rejection' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)(new common_1.ValidationPipe({ transform: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, onboarding_dto_1.ReinitiateEddDto]),
    __metadata("design:returntype", void 0)
], OnboardingCustomerController.prototype, "reinitiateEddCases", null);
__decorate([
    (0, common_1.Post)('cases/:id/sessions'),
    (0, swagger_1.ApiOperation)({ summary: 'Create third-party compliance session and return QR payload' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)(new common_1.ValidationPipe({ transform: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, onboarding_dto_1.CreateCaseSessionDto]),
    __metadata("design:returntype", void 0)
], OnboardingCustomerController.prototype, "createCaseSession", null);
__decorate([
    (0, common_1.Post)('sessions/:sessionId/mock-complete'),
    (0, swagger_1.ApiOperation)({ summary: 'Mock callback: complete compliance session and advance case status' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('sessionId')),
    __param(2, (0, common_1.Body)(new common_1.ValidationPipe({ transform: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, onboarding_dto_1.MockCompleteSessionDto]),
    __metadata("design:returntype", void 0)
], OnboardingCustomerController.prototype, "mockCompleteSession", null);
exports.OnboardingCustomerController = OnboardingCustomerController = __decorate([
    (0, swagger_1.ApiTags)('Customer - Onboarding'),
    (0, common_1.Controller)('onboarding'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [onboarding_service_1.OnboardingService])
], OnboardingCustomerController);
//# sourceMappingURL=onboarding-customer.controller.js.map