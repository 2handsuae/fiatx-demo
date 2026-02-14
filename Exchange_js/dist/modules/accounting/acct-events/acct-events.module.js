"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcctEventsModule = void 0;
const common_1 = require("@nestjs/common");
const acct_events_service_1 = require("./acct-events.service");
const acct_events_controller_1 = require("./acct-events.controller");
const prisma_module_1 = require("../../../core/prisma/prisma.module");
const acct_config_service_1 = require("./acct-config.service");
let AcctEventsModule = class AcctEventsModule {
};
exports.AcctEventsModule = AcctEventsModule;
exports.AcctEventsModule = AcctEventsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        controllers: [acct_events_controller_1.AcctEventsController],
        providers: [acct_events_service_1.AcctEventsService, acct_config_service_1.AcctConfigService],
        exports: [acct_events_service_1.AcctEventsService, acct_config_service_1.AcctConfigService],
    })
], AcctEventsModule);
//# sourceMappingURL=acct-events.module.js.map