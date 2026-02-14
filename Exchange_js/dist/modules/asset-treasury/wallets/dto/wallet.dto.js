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
exports.UpdateWalletStatusDto = exports.CreateWalletDto = exports.WalletStatus = exports.WalletDirection = exports.WalletType = exports.OwnerType = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
var OwnerType;
(function (OwnerType) {
    OwnerType["PLATFORM"] = "PLATFORM";
    OwnerType["CUSTOMER"] = "CUSTOMER";
    OwnerType["LIQUIDITY_PROVIDER"] = "LIQUIDITY_PROVIDER";
})(OwnerType || (exports.OwnerType = OwnerType = {}));
var WalletType;
(function (WalletType) {
    WalletType["FIAT_BANK"] = "FIAT_BANK";
    WalletType["CRYPTO_ADDRESS"] = "CRYPTO_ADDRESS";
})(WalletType || (exports.WalletType = WalletType = {}));
var WalletDirection;
(function (WalletDirection) {
    WalletDirection["INBOUND"] = "INBOUND";
    WalletDirection["OUTBOUND"] = "OUTBOUND";
    WalletDirection["BIDIRECTIONAL"] = "BIDIRECTIONAL";
})(WalletDirection || (exports.WalletDirection = WalletDirection = {}));
var WalletStatus;
(function (WalletStatus) {
    WalletStatus["ACTIVE"] = "ACTIVE";
    WalletStatus["FROZEN"] = "FROZEN";
    WalletStatus["DISABLED"] = "DISABLED";
})(WalletStatus || (exports.WalletStatus = WalletStatus = {}));
class CreateWalletDto {
}
exports.CreateWalletDto = CreateWalletDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: OwnerType }),
    (0, class_validator_1.IsEnum)(OwnerType),
    __metadata("design:type", String)
], CreateWalletDto.prototype, "ownerType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        required: false,
        description: 'Required if ownerType is not PLATFORM',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateWalletDto.prototype, "ownerId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: WalletType }),
    (0, class_validator_1.IsEnum)(WalletType),
    __metadata("design:type", String)
], CreateWalletDto.prototype, "type", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: WalletDirection }),
    (0, class_validator_1.IsEnum)(WalletDirection),
    __metadata("design:type", String)
], CreateWalletDto.prototype, "direction", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Asset ID' }),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateWalletDto.prototype, "assetId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateWalletDto.prototype, "address", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateWalletDto.prototype, "memo", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateWalletDto.prototype, "beneficiaryName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateWalletDto.prototype, "counterpartyVasp", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateWalletDto.prototype, "bankName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateWalletDto.prototype, "bankAccount", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateWalletDto.prototype, "bankCode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateWalletDto.prototype, "accountName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateWalletDto.prototype, "iban", void 0);
class UpdateWalletStatusDto {
}
exports.UpdateWalletStatusDto = UpdateWalletStatusDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: WalletStatus }),
    (0, class_validator_1.IsEnum)(WalletStatus),
    __metadata("design:type", String)
], UpdateWalletStatusDto.prototype, "status", void 0);
//# sourceMappingURL=wallet.dto.js.map