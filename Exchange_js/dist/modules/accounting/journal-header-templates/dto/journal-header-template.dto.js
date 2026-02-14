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
exports.JournalHeaderTemplateQueryDto = exports.UpdateJournalHeaderTemplateDto = exports.CreateJournalHeaderTemplateDto = exports.TemplateStatus = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
var TemplateStatus;
(function (TemplateStatus) {
    TemplateStatus["ACTIVE"] = "ACTIVE";
    TemplateStatus["INACTIVE"] = "INACTIVE";
})(TemplateStatus || (exports.TemplateStatus = TemplateStatus = {}));
class CreateJournalHeaderTemplateDto {
}
exports.CreateJournalHeaderTemplateDto = CreateJournalHeaderTemplateDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateJournalHeaderTemplateDto.prototype, "templateCode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateJournalHeaderTemplateDto.prototype, "eventCode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CreateJournalHeaderTemplateDto.prototype, "version", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: TemplateStatus }),
    (0, class_validator_1.IsEnum)(TemplateStatus),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateJournalHeaderTemplateDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateJournalHeaderTemplateDto.prototype, "baseAssetId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateJournalHeaderTemplateDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateJournalHeaderTemplateDto.prototype, "effectiveFrom", void 0);
class UpdateJournalHeaderTemplateDto {
}
exports.UpdateJournalHeaderTemplateDto = UpdateJournalHeaderTemplateDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], UpdateJournalHeaderTemplateDto.prototype, "version", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: TemplateStatus }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(TemplateStatus),
    __metadata("design:type", String)
], UpdateJournalHeaderTemplateDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateJournalHeaderTemplateDto.prototype, "baseAssetId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateJournalHeaderTemplateDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], UpdateJournalHeaderTemplateDto.prototype, "effectiveFrom", void 0);
class JournalHeaderTemplateQueryDto {
}
exports.JournalHeaderTemplateQueryDto = JournalHeaderTemplateQueryDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumberString)(),
    __metadata("design:type", String)
], JournalHeaderTemplateQueryDto.prototype, "skip", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumberString)(),
    __metadata("design:type", String)
], JournalHeaderTemplateQueryDto.prototype, "take", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], JournalHeaderTemplateQueryDto.prototype, "templateCode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], JournalHeaderTemplateQueryDto.prototype, "eventCode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: TemplateStatus }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(TemplateStatus),
    __metadata("design:type", String)
], JournalHeaderTemplateQueryDto.prototype, "status", void 0);
//# sourceMappingURL=journal-header-template.dto.js.map