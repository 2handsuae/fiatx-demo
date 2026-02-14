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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JournalHeaderTemplatesController = void 0;
const common_1 = require("@nestjs/common");
const journal_header_templates_service_1 = require("./journal-header-templates.service");
const journal_header_template_dto_1 = require("./dto/journal-header-template.dto");
const swagger_1 = require("@nestjs/swagger");
let JournalHeaderTemplatesController = class JournalHeaderTemplatesController {
    constructor(service) {
        this.service = service;
    }
    create(createDto) {
        return this.service.create(createDto);
    }
    findAll(query) {
        return this.service.findAll(query);
    }
    findOne(id) {
        return this.service.findOne(id);
    }
    update(id, updateDto) {
        return this.service.update(id, updateDto);
    }
    remove(id) {
        return this.service.remove(id);
    }
};
exports.JournalHeaderTemplatesController = JournalHeaderTemplatesController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new journal header template' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [journal_header_template_dto_1.CreateJournalHeaderTemplateDto]),
    __metadata("design:returntype", void 0)
], JournalHeaderTemplatesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'List all templates' }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [journal_header_template_dto_1.JournalHeaderTemplateQueryDto]),
    __metadata("design:returntype", void 0)
], JournalHeaderTemplatesController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get a template by id' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], JournalHeaderTemplatesController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Update a template' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, journal_header_template_dto_1.UpdateJournalHeaderTemplateDto]),
    __metadata("design:returntype", void 0)
], JournalHeaderTemplatesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Deactivate a template' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], JournalHeaderTemplatesController.prototype, "remove", null);
exports.JournalHeaderTemplatesController = JournalHeaderTemplatesController = __decorate([
    (0, swagger_1.ApiTags)('Journal Header Templates'),
    (0, common_1.Controller)('journal-header-templates'),
    __metadata("design:paramtypes", [journal_header_templates_service_1.JournalHeaderTemplatesService])
], JournalHeaderTemplatesController);
//# sourceMappingURL=journal-header-templates.controller.js.map