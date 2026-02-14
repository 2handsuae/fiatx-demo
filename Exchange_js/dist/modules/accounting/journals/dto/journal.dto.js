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
exports.JournalQueryDto = exports.JournalPostingStatus = exports.JournalSourceType = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
var JournalSourceType;
(function (JournalSourceType) {
    JournalSourceType["DEPOSIT"] = "DEPOSIT";
    JournalSourceType["WITHDRAWAL"] = "WITHDRAWAL";
    JournalSourceType["SWAP"] = "SWAP";
    JournalSourceType["OTC_ORDER"] = "OTC_ORDER";
})(JournalSourceType || (exports.JournalSourceType = JournalSourceType = {}));
var JournalPostingStatus;
(function (JournalPostingStatus) {
    JournalPostingStatus["POSTED"] = "POSTED";
    JournalPostingStatus["VOID"] = "VOID";
})(JournalPostingStatus || (exports.JournalPostingStatus = JournalPostingStatus = {}));
class JournalQueryDto {
}
exports.JournalQueryDto = JournalQueryDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumberString)(),
    __metadata("design:type", String)
], JournalQueryDto.prototype, "skip", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumberString)(),
    __metadata("design:type", String)
], JournalQueryDto.prototype, "take", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], JournalQueryDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: JournalSourceType }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(JournalSourceType),
    __metadata("design:type", String)
], JournalQueryDto.prototype, "sourceType", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], JournalQueryDto.prototype, "eventCode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: JournalPostingStatus }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(JournalPostingStatus),
    __metadata("design:type", String)
], JournalQueryDto.prototype, "postingStatus", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], JournalQueryDto.prototype, "baseAssetId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], JournalQueryDto.prototype, "createdAtStart", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], JournalQueryDto.prototype, "createdAtEnd", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], JournalQueryDto.prototype, "postedAtStart", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], JournalQueryDto.prototype, "postedAtEnd", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], JournalQueryDto.prototype, "sortBy", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], JournalQueryDto.prototype, "sortOrder", void 0);
//# sourceMappingURL=journal.dto.js.map