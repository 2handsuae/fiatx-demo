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
exports.ClearingTemplatesController = void 0;
const common_1 = require("@nestjs/common");
const clearing_templates_service_1 = require("./clearing-templates.service");
const clearing_dto_1 = require("./dto/clearing.dto");
let ClearingTemplatesController = class ClearingTemplatesController {
    constructor(clearingTemplatesService) {
        this.clearingTemplatesService = clearingTemplatesService;
    }
    create(createClearingTemplateDto) {
        return this.clearingTemplatesService.create(createClearingTemplateDto);
    }
    findAll(query) {
        return this.clearingTemplatesService.findAll(query);
    }
    findOne(id) {
        return this.clearingTemplatesService.findOne(id);
    }
    update(id, updateClearingTemplateDto) {
        return this.clearingTemplatesService.update(id, updateClearingTemplateDto);
    }
    remove(id) {
        return this.clearingTemplatesService.remove(id);
    }
};
exports.ClearingTemplatesController = ClearingTemplatesController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [clearing_dto_1.CreateClearingTemplateDto]),
    __metadata("design:returntype", void 0)
], ClearingTemplatesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [clearing_dto_1.QueryClearingTemplateDto]),
    __metadata("design:returntype", void 0)
], ClearingTemplatesController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ClearingTemplatesController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, clearing_dto_1.UpdateClearingTemplateDto]),
    __metadata("design:returntype", void 0)
], ClearingTemplatesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ClearingTemplatesController.prototype, "remove", null);
exports.ClearingTemplatesController = ClearingTemplatesController = __decorate([
    (0, common_1.Controller)('clearing-templates'),
    __metadata("design:paramtypes", [clearing_templates_service_1.ClearingTemplatesService])
], ClearingTemplatesController);
//# sourceMappingURL=clearing-templates.controller.js.map