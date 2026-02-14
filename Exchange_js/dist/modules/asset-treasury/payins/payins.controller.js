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
exports.PayinsController = void 0;
const common_1 = require("@nestjs/common");
const payins_service_1 = require("./payins.service");
const payin_dto_1 = require("./dto/payin.dto");
const passport_1 = require("@nestjs/passport");
const swagger_1 = require("@nestjs/swagger");
let PayinsController = class PayinsController {
    constructor(service) {
        this.service = service;
    }
    simulate(dto) {
        return this.service.simulate(dto);
    }
    findAll(query) {
        return this.service.findAll(query);
    }
    findOne(id) {
        return this.service.findOne(id);
    }
    updateStatus(id, dto) {
        return this.service.updateStatus(id, dto.action);
    }
};
exports.PayinsController = PayinsController;
__decorate([
    (0, common_1.Post)('simulate'),
    (0, swagger_1.ApiOperation)({ summary: 'Simulate a new payin (For testing/demo)' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [payin_dto_1.SimulatePayinDto]),
    __metadata("design:returntype", void 0)
], PayinsController.prototype, "simulate", null);
__decorate([
    (0, common_1.Get)(),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, swagger_1.ApiOperation)({ summary: 'List all payins' }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [payin_dto_1.PayinQueryDto]),
    __metadata("design:returntype", void 0)
], PayinsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, swagger_1.ApiOperation)({ summary: 'Get payin details' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PayinsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id/status'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, swagger_1.ApiOperation)({ summary: 'Update payin status (State Machine)' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, payin_dto_1.UpdatePayinStatusDto]),
    __metadata("design:returntype", void 0)
], PayinsController.prototype, "updateStatus", null);
exports.PayinsController = PayinsController = __decorate([
    (0, swagger_1.ApiTags)('treasury/payins'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)('treasury/payins'),
    __metadata("design:paramtypes", [payins_service_1.PayinsService])
], PayinsController);
//# sourceMappingURL=payins.controller.js.map