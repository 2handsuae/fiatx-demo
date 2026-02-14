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
exports.JournalLineTemplateQueryDto = exports.UpdateJournalLineTemplateDto = exports.CreateJournalLineTemplateDto = exports.AssetSource = exports.AmountSource = exports.DrCr = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
var DrCr;
(function (DrCr) {
    DrCr["DR"] = "DR";
    DrCr["CR"] = "CR";
})(DrCr || (exports.DrCr = DrCr = {}));
var AmountSource;
(function (AmountSource) {
    AmountSource["AMOUNT"] = "AMOUNT";
    AmountSource["FEE_AMOUNT"] = "FEE_AMOUNT";
    AmountSource["FROM_AMOUNT"] = "FROM_AMOUNT";
    AmountSource["TO_AMOUNT"] = "TO_AMOUNT";
})(AmountSource || (exports.AmountSource = AmountSource = {}));
var AssetSource;
(function (AssetSource) {
    AssetSource["ASSET_ID"] = "ASSET_ID";
    AssetSource["FEE_ASSET_ID"] = "FEE_ASSET_ID";
    AssetSource["FROM_ASSET_ID"] = "FROM_ASSET_ID";
    AssetSource["TO_ASSET_ID"] = "TO_ASSET_ID";
})(AssetSource || (exports.AssetSource = AssetSource = {}));
class CreateJournalLineTemplateDto {
}
exports.CreateJournalLineTemplateDto = CreateJournalLineTemplateDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateJournalLineTemplateDto.prototype, "templateId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", Number)
], CreateJournalLineTemplateDto.prototype, "lineNo", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateJournalLineTemplateDto.prototype, "accountCode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: DrCr }),
    (0, class_validator_1.IsEnum)(DrCr),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateJournalLineTemplateDto.prototype, "drCr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: AmountSource }),
    (0, class_validator_1.IsEnum)(AmountSource),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateJournalLineTemplateDto.prototype, "amountSource", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: AssetSource }),
    (0, class_validator_1.IsEnum)(AssetSource),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateJournalLineTemplateDto.prototype, "assetSource", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateJournalLineTemplateDto.prototype, "ownerTypeSource", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateJournalLineTemplateDto.prototype, "ownerIdSource", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateJournalLineTemplateDto.prototype, "fxRateSource", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateJournalLineTemplateDto.prototype, "referenceSource", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsJSON)(),
    __metadata("design:type", String)
], CreateJournalLineTemplateDto.prototype, "dimensionsRule", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateJournalLineTemplateDto.prototype, "conditionExpr", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateJournalLineTemplateDto.prototype, "description", void 0);
class UpdateJournalLineTemplateDto {
}
exports.UpdateJournalLineTemplateDto = UpdateJournalLineTemplateDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateJournalLineTemplateDto.prototype, "accountCode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: DrCr }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(DrCr),
    __metadata("design:type", String)
], UpdateJournalLineTemplateDto.prototype, "drCr", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: AmountSource }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(AmountSource),
    __metadata("design:type", String)
], UpdateJournalLineTemplateDto.prototype, "amountSource", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: AssetSource }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(AssetSource),
    __metadata("design:type", String)
], UpdateJournalLineTemplateDto.prototype, "assetSource", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateJournalLineTemplateDto.prototype, "ownerTypeSource", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateJournalLineTemplateDto.prototype, "ownerIdSource", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateJournalLineTemplateDto.prototype, "fxRateSource", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateJournalLineTemplateDto.prototype, "referenceSource", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdateJournalLineTemplateDto.prototype, "dimensionsRule", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateJournalLineTemplateDto.prototype, "conditionExpr", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateJournalLineTemplateDto.prototype, "description", void 0);
class JournalLineTemplateQueryDto {
}
exports.JournalLineTemplateQueryDto = JournalLineTemplateQueryDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], JournalLineTemplateQueryDto.prototype, "templateId", void 0);
//# sourceMappingURL=journal-line-template.dto.js.map