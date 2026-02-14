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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayinQueryDto = exports.SimulatePayinDto = exports.UpdatePayinStatusDto = exports.PayinType = exports.PayinAction = exports.PayinStatus = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
var PayinStatus;
(function (PayinStatus) {
    PayinStatus["DETECTED"] = "DETECTED";
    PayinStatus["CONFIRMING"] = "CONFIRMING";
    PayinStatus["CONFIRMED"] = "CONFIRMED";
    PayinStatus["CLEARED"] = "CLEARED";
    PayinStatus["FAILED"] = "FAILED";
})(PayinStatus || (exports.PayinStatus = PayinStatus = {}));
var PayinAction;
(function (PayinAction) {
    PayinAction["CONFIRM"] = "confirm";
    PayinAction["FAIL"] = "fail";
    PayinAction["CLEAR"] = "clear";
    PayinAction["BLOCK"] = "block";
})(PayinAction || (exports.PayinAction = PayinAction = {}));
var PayinType;
(function (PayinType) {
    PayinType["CRYPTO"] = "crypto";
    PayinType["FIAT"] = "fiat";
})(PayinType || (exports.PayinType = PayinType = {}));
class UpdatePayinStatusDto {
}
exports.UpdatePayinStatusDto = UpdatePayinStatusDto;
__decorate([
    (0, class_validator_1.IsEnum)(PayinAction),
    __metadata("design:type", String)
], UpdatePayinStatusDto.prototype, "action", void 0);
class SimulatePayinDto {
}
exports.SimulatePayinDto = SimulatePayinDto;
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], SimulatePayinDto.prototype, "assetId", void 0);
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], SimulatePayinDto.prototype, "toWalletId", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(PayinType),
    __metadata("design:type", String)
], SimulatePayinDto.prototype, "type", void 0);
class PayinQueryDto {
}
exports.PayinQueryDto = PayinQueryDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumberString)(),
    __metadata("design:type", String)
], PayinQueryDto.prototype, "skip", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumberString)(),
    __metadata("design:type", String)
], PayinQueryDto.prototype, "take", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: PayinType }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(PayinType),
    __metadata("design:type", String)
], PayinQueryDto.prototype, "type", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: PayinStatus }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(PayinStatus),
    __metadata("design:type", String)
], PayinQueryDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], PayinQueryDto.prototype, "assetId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PayinQueryDto.prototype, "txHash", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PayinQueryDto.prototype, "depositId", void 0);
//# sourceMappingURL=payin.dto.js.map