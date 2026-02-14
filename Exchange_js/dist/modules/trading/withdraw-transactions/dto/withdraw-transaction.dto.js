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
exports.WithdrawTransactionQueryDto = exports.TravelRuleStatus = exports.KytStatus = exports.ComplianceStatus = exports.WithdrawType = exports.WithdrawOwnerType = exports.CreateWithdrawTransactionDto = exports.UpdateWithdrawTransactionStatusDto = exports.WithdrawTransactionAction = exports.WithdrawTransactionStatus = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
var WithdrawTransactionStatus;
(function (WithdrawTransactionStatus) {
    WithdrawTransactionStatus["CREATED"] = "CREATED";
    WithdrawTransactionStatus["PENDING_COMPLIANCE"] = "PENDING_COMPLIANCE";
    WithdrawTransactionStatus["UNDER_REVIEW"] = "UNDER_REVIEW";
    WithdrawTransactionStatus["APPROVED"] = "APPROVED";
    WithdrawTransactionStatus["PAYOUT_PENDING"] = "PAYOUT_PENDING";
    WithdrawTransactionStatus["SUCCESS"] = "SUCCESS";
    WithdrawTransactionStatus["FAILED"] = "FAILED";
    WithdrawTransactionStatus["REJECTED"] = "REJECTED";
    WithdrawTransactionStatus["CANCELLED"] = "CANCELLED";
    WithdrawTransactionStatus["RETURNED"] = "RETURNED";
    WithdrawTransactionStatus["HELD"] = "HELD";
})(WithdrawTransactionStatus || (exports.WithdrawTransactionStatus = WithdrawTransactionStatus = {}));
var WithdrawTransactionAction;
(function (WithdrawTransactionAction) {
    WithdrawTransactionAction["CHECK"] = "check";
    WithdrawTransactionAction["FLAG"] = "flag";
    WithdrawTransactionAction["REJECT"] = "reject";
    WithdrawTransactionAction["APPROVE"] = "approve";
    WithdrawTransactionAction["CANCEL"] = "cancel";
    WithdrawTransactionAction["SUCCESS"] = "success";
    WithdrawTransactionAction["FAIL"] = "fail";
    WithdrawTransactionAction["RETURN"] = "return";
})(WithdrawTransactionAction || (exports.WithdrawTransactionAction = WithdrawTransactionAction = {}));
class UpdateWithdrawTransactionStatusDto {
}
exports.UpdateWithdrawTransactionStatusDto = UpdateWithdrawTransactionStatusDto;
__decorate([
    (0, class_validator_1.IsEnum)(WithdrawTransactionAction),
    __metadata("design:type", String)
], UpdateWithdrawTransactionStatusDto.prototype, "action", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateWithdrawTransactionStatusDto.prototype, "reason", void 0);
class CreateWithdrawTransactionDto {
}
exports.CreateWithdrawTransactionDto = CreateWithdrawTransactionDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateWithdrawTransactionDto.prototype, "assetId", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateWithdrawTransactionDto.prototype, "amount", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateWithdrawTransactionDto.prototype, "toWalletId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateWithdrawTransactionDto.prototype, "toAddress", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateWithdrawTransactionDto.prototype, "toIban", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateWithdrawTransactionDto.prototype, "parentType", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateWithdrawTransactionDto.prototype, "parentId", void 0);
var WithdrawOwnerType;
(function (WithdrawOwnerType) {
    WithdrawOwnerType["CUSTOMER"] = "CUSTOMER";
    WithdrawOwnerType["LP"] = "LP";
})(WithdrawOwnerType || (exports.WithdrawOwnerType = WithdrawOwnerType = {}));
var WithdrawType;
(function (WithdrawType) {
    WithdrawType["CRYPTO"] = "crypto";
    WithdrawType["FIAT"] = "fiat";
})(WithdrawType || (exports.WithdrawType = WithdrawType = {}));
var ComplianceStatus;
(function (ComplianceStatus) {
    ComplianceStatus["PENDING"] = "PENDING";
    ComplianceStatus["CLEAR"] = "CLEAR";
    ComplianceStatus["HOLD"] = "HOLD";
    ComplianceStatus["REJECT"] = "REJECT";
})(ComplianceStatus || (exports.ComplianceStatus = ComplianceStatus = {}));
var KytStatus;
(function (KytStatus) {
    KytStatus["PENDING"] = "PENDING";
    KytStatus["PASS"] = "PASS";
    KytStatus["REVIEW"] = "REVIEW";
    KytStatus["FAIL"] = "FAIL";
})(KytStatus || (exports.KytStatus = KytStatus = {}));
var TravelRuleStatus;
(function (TravelRuleStatus) {
    TravelRuleStatus["NOT_REQUIRED"] = "NOT_REQUIRED";
    TravelRuleStatus["PENDING"] = "PENDING";
    TravelRuleStatus["SENT"] = "SENT";
    TravelRuleStatus["RECEIVED"] = "RECEIVED";
    TravelRuleStatus["ACCEPTED"] = "ACCEPTED";
    TravelRuleStatus["REJECTED"] = "REJECTED";
    TravelRuleStatus["EXPIRED"] = "EXPIRED";
})(TravelRuleStatus || (exports.TravelRuleStatus = TravelRuleStatus = {}));
class WithdrawTransactionQueryDto {
}
exports.WithdrawTransactionQueryDto = WithdrawTransactionQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], WithdrawTransactionQueryDto.prototype, "skip", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], WithdrawTransactionQueryDto.prototype, "take", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WithdrawTransactionQueryDto.prototype, "withdrawNo", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WithdrawTransactionQueryDto.prototype, "ownerId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(WithdrawOwnerType),
    __metadata("design:type", String)
], WithdrawTransactionQueryDto.prototype, "ownerType", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WithdrawTransactionQueryDto.prototype, "assetId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(WithdrawTransactionStatus),
    __metadata("design:type", String)
], WithdrawTransactionQueryDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WithdrawTransactionQueryDto.prototype, "startDate", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WithdrawTransactionQueryDto.prototype, "endDate", void 0);
//# sourceMappingURL=withdraw-transaction.dto.js.map