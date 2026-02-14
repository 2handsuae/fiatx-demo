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
exports.CoaQueryDto = exports.UpdateCoaDto = exports.CreateCoaDto = exports.CoaStatus = exports.CoaType = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
var CoaType;
(function (CoaType) {
    CoaType["ASSET"] = "ASSET";
    CoaType["LIABILITY"] = "LIABILITY";
    CoaType["EQUITY"] = "EQUITY";
    CoaType["REVENUE"] = "REVENUE";
    CoaType["EXPENSE"] = "EXPENSE";
})(CoaType || (exports.CoaType = CoaType = {}));
var CoaStatus;
(function (CoaStatus) {
    CoaStatus["ACTIVE"] = "ACTIVE";
    CoaStatus["DISABLED"] = "DISABLED";
})(CoaStatus || (exports.CoaStatus = CoaStatus = {}));
class CreateCoaDto {
}
exports.CreateCoaDto = CreateCoaDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateCoaDto.prototype, "code", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: CoaType }),
    (0, class_validator_1.IsEnum)(CoaType),
    __metadata("design:type", String)
], CreateCoaDto.prototype, "type", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateCoaDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: CoaStatus }),
    (0, class_validator_1.IsEnum)(CoaStatus),
    __metadata("design:type", String)
], CreateCoaDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, default: [] }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Array)
], CreateCoaDto.prototype, "requiredTags", void 0);
class UpdateCoaDto {
}
exports.UpdateCoaDto = UpdateCoaDto;
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdateCoaDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, enum: CoaStatus }),
    (0, class_validator_1.IsEnum)(CoaStatus),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdateCoaDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Array)
], UpdateCoaDto.prototype, "requiredTags", void 0);
class CoaQueryDto {
}
exports.CoaQueryDto = CoaQueryDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumberString)(),
    __metadata("design:type", String)
], CoaQueryDto.prototype, "skip", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumberString)(),
    __metadata("design:type", String)
], CoaQueryDto.prototype, "take", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CoaQueryDto.prototype, "code", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CoaQueryDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CoaQueryDto.prototype, "sortBy", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CoaQueryDto.prototype, "sortOrder", void 0);
//# sourceMappingURL=coa.dto.js.map