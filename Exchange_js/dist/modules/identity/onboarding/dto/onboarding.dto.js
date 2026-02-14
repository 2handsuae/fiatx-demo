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
exports.UpdateInvestorClassificationDto = exports.ReinitiateEddDto = exports.FinalReviewCustomerDto = exports.ReviewEddCaseDto = exports.ReviewCddCaseDto = exports.MockCompleteSessionDto = exports.CreateCaseSessionDto = exports.BootstrapCasesDto = exports.UpsertEntityDto = exports.UboProfileDto = exports.CorporateProfileDto = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
class CorporateProfileDto {
}
exports.CorporateProfileDto = CorporateProfileDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CorporateProfileDto.prototype, "companyName", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CorporateProfileDto.prototype, "registrationNo", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CorporateProfileDto.prototype, "incorporationCountry", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CorporateProfileDto.prototype, "registeredAddress", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CorporateProfileDto.prototype, "licenseType", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CorporateProfileDto.prototype, "licenseNumber", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CorporateProfileDto.prototype, "authorizedSignatoryName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CorporateProfileDto.prototype, "authorizedSignatoryTitle", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], CorporateProfileDto.prototype, "documents", void 0);
class UboProfileDto {
}
exports.UboProfileDto = UboProfileDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], UboProfileDto.prototype, "fullName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(100),
    __metadata("design:type", Number)
], UboProfileDto.prototype, "ownershipPercent", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UboProfileDto.prototype, "nationality", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UboProfileDto.prototype, "idNumber", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UboProfileDto.prototype, "pepFlag", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], UboProfileDto.prototype, "documents", void 0);
class UpsertEntityDto {
}
exports.UpsertEntityDto = UpsertEntityDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['INDIVIDUAL', 'CORPORATE']),
    __metadata("design:type", String)
], UpsertEntityDto.prototype, "customerType", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => CorporateProfileDto),
    __metadata("design:type", CorporateProfileDto)
], UpsertEntityDto.prototype, "corporateProfile", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => UboProfileDto),
    __metadata("design:type", Array)
], UpsertEntityDto.prototype, "ubos", void 0);
class BootstrapCasesDto {
}
exports.BootstrapCasesDto = BootstrapCasesDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BootstrapCasesDto.prototype, "journeyId", void 0);
class CreateCaseSessionDto {
}
exports.CreateCaseSessionDto = CreateCaseSessionDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['CDD', 'EDD']),
    __metadata("design:type", String)
], CreateCaseSessionDto.prototype, "caseType", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateCaseSessionDto.prototype, "provider", void 0);
class MockCompleteSessionDto {
}
exports.MockCompleteSessionDto = MockCompleteSessionDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['PASS', 'FAIL']),
    __metadata("design:type", String)
], MockCompleteSessionDto.prototype, "result", void 0);
class ReviewCddCaseDto {
}
exports.ReviewCddCaseDto = ReviewCddCaseDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['APPROVE', 'REJECT', 'UPGRADE_EDD']),
    __metadata("design:type", String)
], ReviewCddCaseDto.prototype, "decision", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReviewCddCaseDto.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ReviewCddCaseDto.prototype, "requiresEdd", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(100),
    __metadata("design:type", Number)
], ReviewCddCaseDto.prototype, "riskScore", void 0);
class ReviewEddCaseDto {
}
exports.ReviewEddCaseDto = ReviewEddCaseDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['APPROVE', 'REJECT']),
    __metadata("design:type", String)
], ReviewEddCaseDto.prototype, "decision", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReviewEddCaseDto.prototype, "reason", void 0);
class FinalReviewCustomerDto {
}
exports.FinalReviewCustomerDto = FinalReviewCustomerDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['APPROVE', 'REJECT']),
    __metadata("design:type", String)
], FinalReviewCustomerDto.prototype, "decision", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FinalReviewCustomerDto.prototype, "reason", void 0);
class ReinitiateEddDto {
}
exports.ReinitiateEddDto = ReinitiateEddDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReinitiateEddDto.prototype, "journeyId", void 0);
class UpdateInvestorClassificationDto {
}
exports.UpdateInvestorClassificationDto = UpdateInvestorClassificationDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['RETAIL', 'QUALIFIED', 'INSTITUTIONAL']),
    __metadata("design:type", String)
], UpdateInvestorClassificationDto.prototype, "classification", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2),
    __metadata("design:type", String)
], UpdateInvestorClassificationDto.prototype, "reason", void 0);
//# sourceMappingURL=onboarding.dto.js.map