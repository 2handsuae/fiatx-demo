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
exports.SwapTransactionQueryDto = exports.UpdateSwapTransactionStatusDto = exports.CreateSwapTransactionDto = exports.SwapTransactionAction = exports.SwapTransactionStatus = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
var SwapTransactionStatus;
(function (SwapTransactionStatus) {
    SwapTransactionStatus["PENDING_COMPLIANCE"] = "PENDING_COMPLIANCE";
    SwapTransactionStatus["UNDER_REVIEW"] = "UNDER_REVIEW";
    SwapTransactionStatus["SUCCESS"] = "SUCCESS";
    SwapTransactionStatus["REJECTED"] = "REJECTED";
})(SwapTransactionStatus || (exports.SwapTransactionStatus = SwapTransactionStatus = {}));
var SwapTransactionAction;
(function (SwapTransactionAction) {
    SwapTransactionAction["SUCCESS"] = "success";
    SwapTransactionAction["REJECT"] = "reject";
    SwapTransactionAction["FLAG"] = "flag";
})(SwapTransactionAction || (exports.SwapTransactionAction = SwapTransactionAction = {}));
class CreateSwapTransactionDto {
}
exports.CreateSwapTransactionDto = CreateSwapTransactionDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Business transaction number' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateSwapTransactionDto.prototype, "swapNo", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['CUSTOMER', 'LP'], description: 'Owner type' }),
    (0, class_validator_1.IsEnum)(['CUSTOMER', 'LP']),
    __metadata("design:type", String)
], CreateSwapTransactionDto.prototype, "ownerType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Owner ID' }),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateSwapTransactionDto.prototype, "ownerId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Source asset ID' }),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateSwapTransactionDto.prototype, "fromAssetId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Source amount' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateSwapTransactionDto.prototype, "fromAmount", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Target asset ID' }),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateSwapTransactionDto.prototype, "toAssetId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Target amount' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateSwapTransactionDto.prototype, "toAmount", void 0);
class UpdateSwapTransactionStatusDto {
}
exports.UpdateSwapTransactionStatusDto = UpdateSwapTransactionStatusDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        enum: SwapTransactionAction,
        description: 'Action to perform',
    }),
    (0, class_validator_1.IsEnum)(SwapTransactionAction),
    __metadata("design:type", String)
], UpdateSwapTransactionStatusDto.prototype, "action", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Reason for status change' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateSwapTransactionStatusDto.prototype, "reason", void 0);
class SwapTransactionQueryDto {
}
exports.SwapTransactionQueryDto = SwapTransactionQueryDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Number of records to skip' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], SwapTransactionQueryDto.prototype, "skip", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Number of records to take' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], SwapTransactionQueryDto.prototype, "take", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Business transaction number' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SwapTransactionQueryDto.prototype, "swapNo", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Owner ID' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SwapTransactionQueryDto.prototype, "ownerId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: ['CUSTOMER', 'LP'], description: 'Owner type' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(['CUSTOMER', 'LP']),
    __metadata("design:type", String)
], SwapTransactionQueryDto.prototype, "ownerType", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Status' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(SwapTransactionStatus),
    __metadata("design:type", String)
], SwapTransactionQueryDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Start date' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SwapTransactionQueryDto.prototype, "startDate", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'End date' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SwapTransactionQueryDto.prototype, "endDate", void 0);
//# sourceMappingURL=swap-transaction.dto.js.map