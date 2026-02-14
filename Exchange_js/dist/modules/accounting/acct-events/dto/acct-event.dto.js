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
exports.AcctEventQueryDto = exports.UpdateAcctEventDto = exports.CreateAcctEventDto = exports.ClearingMode = exports.PostingMode = exports.TriggerType = exports.AssetType = exports.OwnerScope = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
var OwnerScope;
(function (OwnerScope) {
    OwnerScope["CUSTOMER"] = "CUSTOMER";
    OwnerScope["LP"] = "LP";
    OwnerScope["ALL"] = "ALL";
})(OwnerScope || (exports.OwnerScope = OwnerScope = {}));
var AssetType;
(function (AssetType) {
    AssetType["FIAT"] = "FIAT";
    AssetType["CRYPTO"] = "CRYPTO";
    AssetType["ALL"] = "ALL";
})(AssetType || (exports.AssetType = AssetType = {}));
var TriggerType;
(function (TriggerType) {
    TriggerType["STATUS_TRANSITION"] = "STATUS_TRANSITION";
    TriggerType["EXTERNAL_CALLBACK"] = "EXTERNAL_CALLBACK";
    TriggerType["COMMAND"] = "COMMAND";
    TriggerType["SYSTEM_RULE"] = "SYSTEM_RULE";
    TriggerType["SCHEDULED"] = "SCHEDULED";
})(TriggerType || (exports.TriggerType = TriggerType = {}));
var PostingMode;
(function (PostingMode) {
    PostingMode["TEMPLATE"] = "TEMPLATE";
    PostingMode["AUTO_REVERSAL"] = "AUTO_REVERSAL";
    PostingMode["NONE"] = "NONE";
})(PostingMode || (exports.PostingMode = PostingMode = {}));
var ClearingMode;
(function (ClearingMode) {
    ClearingMode["TEMPLATE"] = "TEMPLATE";
    ClearingMode["NONE"] = "NONE";
})(ClearingMode || (exports.ClearingMode = ClearingMode = {}));
class CreateAcctEventDto {
}
exports.CreateAcctEventDto = CreateAcctEventDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.Matches)(/^EVT_/, { message: 'eventCode must start with EVT_' }),
    __metadata("design:type", String)
], CreateAcctEventDto.prototype, "eventCode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateAcctEventDto.prototype, "entityType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: OwnerScope }),
    (0, class_validator_1.IsEnum)(OwnerScope),
    __metadata("design:type", String)
], CreateAcctEventDto.prototype, "ownerScope", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: AssetType }),
    (0, class_validator_1.IsEnum)(AssetType),
    __metadata("design:type", String)
], CreateAcctEventDto.prototype, "assetType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: TriggerType }),
    (0, class_validator_1.IsEnum)(TriggerType),
    __metadata("design:type", String)
], CreateAcctEventDto.prototype, "triggerType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: PostingMode }),
    (0, class_validator_1.IsEnum)(PostingMode),
    __metadata("design:type", String)
], CreateAcctEventDto.prototype, "postingMode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ClearingMode }),
    (0, class_validator_1.IsEnum)(ClearingMode),
    __metadata("design:type", String)
], CreateAcctEventDto.prototype, "clearingMode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.ValidateIf)((o) => o.postingMode === PostingMode.AUTO_REVERSAL),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({
        message: 'postingReversalOfEventCode is required when postingMode is AUTO_REVERSAL',
    }),
    __metadata("design:type", String)
], CreateAcctEventDto.prototype, "postingReversalOfEventCode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateAcctEventDto.prototype, "clearingReversalOfEventCode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateAcctEventDto.prototype, "description", void 0);
class UpdateAcctEventDto {
}
exports.UpdateAcctEventDto = UpdateAcctEventDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateAcctEventDto.prototype, "entityType", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: OwnerScope }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(OwnerScope),
    __metadata("design:type", String)
], UpdateAcctEventDto.prototype, "ownerScope", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: AssetType }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(AssetType),
    __metadata("design:type", String)
], UpdateAcctEventDto.prototype, "assetType", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: TriggerType }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(TriggerType),
    __metadata("design:type", String)
], UpdateAcctEventDto.prototype, "triggerType", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: PostingMode }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(PostingMode),
    __metadata("design:type", String)
], UpdateAcctEventDto.prototype, "postingMode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: ClearingMode }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(ClearingMode),
    __metadata("design:type", String)
], UpdateAcctEventDto.prototype, "clearingMode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateAcctEventDto.prototype, "postingReversalOfEventCode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateAcctEventDto.prototype, "clearingReversalOfEventCode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateAcctEventDto.prototype, "isActive", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateAcctEventDto.prototype, "description", void 0);
class AcctEventQueryDto {
}
exports.AcctEventQueryDto = AcctEventQueryDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumberString)(),
    __metadata("design:type", String)
], AcctEventQueryDto.prototype, "skip", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumberString)(),
    __metadata("design:type", String)
], AcctEventQueryDto.prototype, "take", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AcctEventQueryDto.prototype, "eventCode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AcctEventQueryDto.prototype, "entityType", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: OwnerScope }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(OwnerScope),
    __metadata("design:type", String)
], AcctEventQueryDto.prototype, "ownerScope", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: AssetType }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(AssetType),
    __metadata("design:type", String)
], AcctEventQueryDto.prototype, "assetType", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: TriggerType }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(TriggerType),
    __metadata("design:type", String)
], AcctEventQueryDto.prototype, "triggerType", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AcctEventQueryDto.prototype, "isActive", void 0);
//# sourceMappingURL=acct-event.dto.js.map