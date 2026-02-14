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
exports.UpdateLiquidityProviderStatusDto = exports.CreateLiquidityProviderDto = exports.LiquidityProviderStatus = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
var LiquidityProviderStatus;
(function (LiquidityProviderStatus) {
    LiquidityProviderStatus["ACTIVE"] = "ACTIVE";
    LiquidityProviderStatus["INACTIVE"] = "INACTIVE";
})(LiquidityProviderStatus || (exports.LiquidityProviderStatus = LiquidityProviderStatus = {}));
class CreateLiquidityProviderDto {
}
exports.CreateLiquidityProviderDto = CreateLiquidityProviderDto;
__decorate([
    (0, swagger_1.ApiProperty)({ maxLength: 128, description: 'Provider name (1-128 chars)' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(1, 128),
    __metadata("design:type", String)
], CreateLiquidityProviderDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Contact email' }),
    (0, class_validator_1.IsEmail)(),
    __metadata("design:type", String)
], CreateLiquidityProviderDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, description: 'Contact phone (E.164 format)' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(/^\+[1-9]\d{1,14}$/, {
        message: 'Phone must be in E.164 format (e.g. +8613812345678)',
    }),
    (0, class_validator_1.Length)(0, 32),
    __metadata("design:type", String)
], CreateLiquidityProviderDto.prototype, "phone", void 0);
class UpdateLiquidityProviderStatusDto {
}
exports.UpdateLiquidityProviderStatusDto = UpdateLiquidityProviderStatusDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: LiquidityProviderStatus }),
    (0, class_validator_1.IsEnum)(LiquidityProviderStatus),
    __metadata("design:type", String)
], UpdateLiquidityProviderStatusDto.prototype, "status", void 0);
//# sourceMappingURL=liquidity-provider.dto.js.map