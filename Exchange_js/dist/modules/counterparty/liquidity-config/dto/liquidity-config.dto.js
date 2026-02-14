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
exports.UpdateLiquidityConfigStatusDto = exports.UpdateLiquidityConfigDto = exports.CreateLiquidityConfigDto = exports.LiquidityConfigStatus = exports.RateSourceType = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
var RateSourceType;
(function (RateSourceType) {
    RateSourceType["API"] = "API";
    RateSourceType["MANUAL"] = "MANUAL";
})(RateSourceType || (exports.RateSourceType = RateSourceType = {}));
var LiquidityConfigStatus;
(function (LiquidityConfigStatus) {
    LiquidityConfigStatus["ACTIVE"] = "ACTIVE";
    LiquidityConfigStatus["INACTIVE"] = "INACTIVE";
})(LiquidityConfigStatus || (exports.LiquidityConfigStatus = LiquidityConfigStatus = {}));
class CreateLiquidityConfigDto {
}
exports.CreateLiquidityConfigDto = CreateLiquidityConfigDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Liquidity Provider ID' }),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateLiquidityConfigDto.prototype, "lpId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'From Asset ID' }),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateLiquidityConfigDto.prototype, "fromAssetId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'To Asset ID' }),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateLiquidityConfigDto.prototype, "toAssetId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: RateSourceType }),
    (0, class_validator_1.IsEnum)(RateSourceType),
    __metadata("design:type", String)
], CreateLiquidityConfigDto.prototype, "rateSourceType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        default: 0,
        description: 'Fee percentage (e.g., 0.5 for 0.5%)',
    }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], CreateLiquidityConfigDto.prototype, "feePercent", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ default: 0, description: 'Fixed fee amount' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], CreateLiquidityConfigDto.prototype, "feeFixedAmount", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, description: 'Fee Asset ID' }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateLiquidityConfigDto.prototype, "feeAssetId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, description: 'Minimum exchange amount' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CreateLiquidityConfigDto.prototype, "minFromAmount", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, description: 'Maximum exchange amount' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CreateLiquidityConfigDto.prototype, "maxFromAmount", void 0);
class UpdateLiquidityConfigDto {
}
exports.UpdateLiquidityConfigDto = UpdateLiquidityConfigDto;
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, enum: RateSourceType }),
    (0, class_validator_1.IsEnum)(RateSourceType),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdateLiquidityConfigDto.prototype, "rateSourceType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], UpdateLiquidityConfigDto.prototype, "feePercent", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], UpdateLiquidityConfigDto.prototype, "feeFixedAmount", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdateLiquidityConfigDto.prototype, "feeAssetId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], UpdateLiquidityConfigDto.prototype, "minFromAmount", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], UpdateLiquidityConfigDto.prototype, "maxFromAmount", void 0);
class UpdateLiquidityConfigStatusDto {
}
exports.UpdateLiquidityConfigStatusDto = UpdateLiquidityConfigStatusDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: LiquidityConfigStatus }),
    (0, class_validator_1.IsEnum)(LiquidityConfigStatus),
    __metadata("design:type", String)
], UpdateLiquidityConfigStatusDto.prototype, "status", void 0);
//# sourceMappingURL=liquidity-config.dto.js.map