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
exports.LiquidityProvidersController = void 0;
const common_1 = require("@nestjs/common");
const liquidity_providers_service_1 = require("./liquidity-providers.service");
const liquidity_provider_dto_1 = require("./dto/liquidity-provider.dto");
const passport_1 = require("@nestjs/passport");
const swagger_1 = require("@nestjs/swagger");
let LiquidityProvidersController = class LiquidityProvidersController {
    constructor(service) {
        this.service = service;
    }
    create(dto) {
        return this.service.create(dto);
    }
    findAll(skip, take, search, status) {
        const where = {};
        if (search) {
            where.name = { contains: search };
        }
        if (status) {
            where.status = status;
        }
        return this.service.findAll({
            skip: skip ? Number(skip) : 0,
            take: take ? Number(take) : 20,
            where,
            orderBy: { createdAt: 'desc' },
        });
    }
    findOne(id) {
        return this.service.findOne(id);
    }
    changeStatus(id, dto) {
        return this.service.changeStatus(id, dto.status);
    }
};
exports.LiquidityProvidersController = LiquidityProvidersController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new liquidity provider' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [liquidity_provider_dto_1.CreateLiquidityProviderDto]),
    __metadata("design:returntype", void 0)
], LiquidityProvidersController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'List all liquidity providers' }),
    (0, swagger_1.ApiQuery)({ name: 'skip', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'take', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'search', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'status', required: false, enum: liquidity_provider_dto_1.LiquidityProviderStatus }),
    __param(0, (0, common_1.Query)('skip')),
    __param(1, (0, common_1.Query)('take')),
    __param(2, (0, common_1.Query)('search')),
    __param(3, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], LiquidityProvidersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get a liquidity provider by ID' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], LiquidityProvidersController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id/status'),
    (0, swagger_1.ApiOperation)({ summary: 'Change liquidity provider status' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, liquidity_provider_dto_1.UpdateLiquidityProviderStatusDto]),
    __metadata("design:returntype", void 0)
], LiquidityProvidersController.prototype, "changeStatus", null);
exports.LiquidityProvidersController = LiquidityProvidersController = __decorate([
    (0, swagger_1.ApiTags)('liquidity-providers'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)('liquidity-providers'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    __metadata("design:paramtypes", [liquidity_providers_service_1.LiquidityProvidersService])
], LiquidityProvidersController);
//# sourceMappingURL=liquidity-providers.controller.js.map