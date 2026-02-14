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
exports.LiquidityConfigController = void 0;
const common_1 = require("@nestjs/common");
const liquidity_config_service_1 = require("./liquidity-config.service");
const liquidity_config_dto_1 = require("./dto/liquidity-config.dto");
const passport_1 = require("@nestjs/passport");
const swagger_1 = require("@nestjs/swagger");
let LiquidityConfigController = class LiquidityConfigController {
    constructor(service) {
        this.service = service;
    }
    create(dto) {
        return this.service.create(dto);
    }
    findAll(skip, take, lpId, status) {
        const where = {};
        if (lpId)
            where.lpId = lpId;
        if (status)
            where.status = status;
        return this.service.findAll({
            skip: skip ? Number(skip) : 0,
            take: take ? Number(take) : 20,
            where,
            orderBy: { createdAt: 'desc' },
        });
    }
    getAvailable(fromAssetId, toAssetId) {
        return this.service.getAvailableConfigs(fromAssetId, toAssetId);
    }
    getByLpId(lpId) {
        return this.service.getByLpId(lpId);
    }
    findOne(id) {
        return this.service.findOne(id);
    }
    update(id, dto) {
        return this.service.update(id, dto);
    }
    remove(id) {
        return this.service.remove(id);
    }
    changeStatus(id, dto) {
        return this.service.changeStatus(id, dto.status);
    }
};
exports.LiquidityConfigController = LiquidityConfigController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new liquidity configuration' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [liquidity_config_dto_1.CreateLiquidityConfigDto]),
    __metadata("design:returntype", void 0)
], LiquidityConfigController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'List all liquidity configurations' }),
    (0, swagger_1.ApiQuery)({ name: 'skip', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'take', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'lpId', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'status', required: false, enum: liquidity_config_dto_1.LiquidityConfigStatus }),
    __param(0, (0, common_1.Query)('skip')),
    __param(1, (0, common_1.Query)('take')),
    __param(2, (0, common_1.Query)('lpId')),
    __param(3, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], LiquidityConfigController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('available'),
    (0, swagger_1.ApiOperation)({ summary: 'Get available configurations for a pair' }),
    __param(0, (0, common_1.Query)('fromAssetId')),
    __param(1, (0, common_1.Query)('toAssetId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], LiquidityConfigController.prototype, "getAvailable", null);
__decorate([
    (0, common_1.Get)('lp/:lpId'),
    (0, swagger_1.ApiOperation)({ summary: 'Get configurations by LP ID' }),
    __param(0, (0, common_1.Param)('lpId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], LiquidityConfigController.prototype, "getByLpId", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get a configuration by ID' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], LiquidityConfigController.prototype, "findOne", null);
__decorate([
    (0, common_1.Put)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Update a configuration' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, liquidity_config_dto_1.UpdateLiquidityConfigDto]),
    __metadata("design:returntype", void 0)
], LiquidityConfigController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Delete a configuration' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], LiquidityConfigController.prototype, "remove", null);
__decorate([
    (0, common_1.Patch)(':id/status'),
    (0, swagger_1.ApiOperation)({ summary: 'Change configuration status' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, liquidity_config_dto_1.UpdateLiquidityConfigStatusDto]),
    __metadata("design:returntype", void 0)
], LiquidityConfigController.prototype, "changeStatus", null);
exports.LiquidityConfigController = LiquidityConfigController = __decorate([
    (0, swagger_1.ApiTags)('liquidity-configurations'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)('liquidity-configurations'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    __metadata("design:paramtypes", [liquidity_config_service_1.LiquidityConfigService])
], LiquidityConfigController);
//# sourceMappingURL=liquidity-config.controller.js.map