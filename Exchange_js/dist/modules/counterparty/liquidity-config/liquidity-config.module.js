"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiquidityConfigModule = void 0;
const common_1 = require("@nestjs/common");
const liquidity_config_service_1 = require("./liquidity-config.service");
const liquidity_config_controller_1 = require("./liquidity-config.controller");
const prisma_module_1 = require("../../../core/prisma/prisma.module");
let LiquidityConfigModule = class LiquidityConfigModule {
};
exports.LiquidityConfigModule = LiquidityConfigModule;
exports.LiquidityConfigModule = LiquidityConfigModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        controllers: [liquidity_config_controller_1.LiquidityConfigController],
        providers: [liquidity_config_service_1.LiquidityConfigService],
        exports: [liquidity_config_service_1.LiquidityConfigService],
    })
], LiquidityConfigModule);
//# sourceMappingURL=liquidity-config.module.js.map