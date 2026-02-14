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
exports.UpdateDepositTransactionStatusDto = exports.DepositTransactionAction = exports.DepositTransactionQueryDto = exports.DepositOwnerType = exports.DepositTransactionStatus = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
var DepositTransactionStatus;
(function (DepositTransactionStatus) {
    DepositTransactionStatus["PAYIN_PENDING"] = "PAYIN_PENDING";
    DepositTransactionStatus["COMPLIANCE_PENDING"] = "COMPLIANCE_PENDING";
    DepositTransactionStatus["SUCCESS"] = "SUCCESS";
    DepositTransactionStatus["UNDER_REVIEW"] = "UNDER_REVIEW";
    DepositTransactionStatus["REJECTED"] = "REJECTED";
    DepositTransactionStatus["FAILED"] = "FAILED";
})(DepositTransactionStatus || (exports.DepositTransactionStatus = DepositTransactionStatus = {}));
var DepositOwnerType;
(function (DepositOwnerType) {
    DepositOwnerType["CUSTOMER"] = "CUSTOMER";
    DepositOwnerType["LP"] = "LP";
})(DepositOwnerType || (exports.DepositOwnerType = DepositOwnerType = {}));
class DepositTransactionQueryDto {
}
exports.DepositTransactionQueryDto = DepositTransactionQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], DepositTransactionQueryDto.prototype, "skip", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], DepositTransactionQueryDto.prototype, "take", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DepositTransactionQueryDto.prototype, "depositNo", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DepositTransactionQueryDto.prototype, "ownerId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(DepositOwnerType),
    __metadata("design:type", String)
], DepositTransactionQueryDto.prototype, "ownerType", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DepositTransactionQueryDto.prototype, "assetId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DepositTransactionQueryDto.prototype, "toWalletId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(DepositTransactionStatus),
    __metadata("design:type", String)
], DepositTransactionQueryDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DepositTransactionQueryDto.prototype, "kytStatus", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DepositTransactionQueryDto.prototype, "travelRuleStatus", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DepositTransactionQueryDto.prototype, "startDate", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DepositTransactionQueryDto.prototype, "endDate", void 0);
var DepositTransactionAction;
(function (DepositTransactionAction) {
    DepositTransactionAction["PAYIN_CONFIRMED"] = "payin_confirmed";
    DepositTransactionAction["SUCCESS"] = "success";
    DepositTransactionAction["FLAG"] = "flag";
    DepositTransactionAction["REJECT"] = "reject";
    DepositTransactionAction["FAIL"] = "fail";
})(DepositTransactionAction || (exports.DepositTransactionAction = DepositTransactionAction = {}));
class UpdateDepositTransactionStatusDto {
}
exports.UpdateDepositTransactionStatusDto = UpdateDepositTransactionStatusDto;
__decorate([
    (0, class_validator_1.IsEnum)(DepositTransactionAction),
    __metadata("design:type", String)
], UpdateDepositTransactionStatusDto.prototype, "action", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateDepositTransactionStatusDto.prototype, "reason", void 0);
//# sourceMappingURL=deposit-transaction.dto.js.map