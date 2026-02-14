"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JournalsModule = void 0;
const common_1 = require("@nestjs/common");
const journals_service_1 = require("./journals.service");
const journals_controller_1 = require("./journals.controller");
const prisma_module_1 = require("../../../core/prisma/prisma.module");
let JournalsModule = class JournalsModule {
};
exports.JournalsModule = JournalsModule;
exports.JournalsModule = JournalsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        controllers: [journals_controller_1.JournalsController],
        providers: [journals_service_1.JournalsService],
        exports: [journals_service_1.JournalsService],
    })
], JournalsModule);
//# sourceMappingURL=journals.module.js.map