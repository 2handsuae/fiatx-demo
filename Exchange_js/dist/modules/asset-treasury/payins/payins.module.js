"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayinsModule = void 0;
const common_1 = require("@nestjs/common");
const payins_service_1 = require("./payins.service");
const payins_controller_1 = require("./payins.controller");
const prisma_module_1 = require("../../../core/prisma/prisma.module");
let PayinsModule = class PayinsModule {
};
exports.PayinsModule = PayinsModule;
exports.PayinsModule = PayinsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        controllers: [payins_controller_1.PayinsController],
        providers: [payins_service_1.PayinsService],
        exports: [payins_service_1.PayinsService],
    })
], PayinsModule);
//# sourceMappingURL=payins.module.js.map