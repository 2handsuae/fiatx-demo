"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClearingModule = void 0;
const common_1 = require("@nestjs/common");
const clearing_templates_service_1 = require("./clearing-templates.service");
const clearing_templates_controller_1 = require("./clearing-templates.controller");
const clearings_service_1 = require("./clearings.service");
const clearings_controller_1 = require("./clearings.controller");
const prisma_module_1 = require("../../../core/prisma/prisma.module");
let ClearingModule = class ClearingModule {
};
exports.ClearingModule = ClearingModule;
exports.ClearingModule = ClearingModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        controllers: [clearing_templates_controller_1.ClearingTemplatesController, clearings_controller_1.ClearingsController],
        providers: [clearing_templates_service_1.ClearingTemplatesService, clearings_service_1.ClearingsService],
        exports: [clearing_templates_service_1.ClearingTemplatesService, clearings_service_1.ClearingsService],
    })
], ClearingModule);
//# sourceMappingURL=clearing.module.js.map