"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapTransactionsModule = void 0;
const common_1 = require("@nestjs/common");
const swap_transactions_service_1 = require("./swap-transactions.service");
const swap_workflow_orchestrator_1 = require("./swap-workflow.orchestrator");
const swap_transactions_controller_1 = require("./swap-transactions.controller");
const swap_transactions_customer_controller_1 = require("./swap-transactions-customer.controller");
const prisma_module_1 = require("../../../core/prisma/prisma.module");
const onboarding_module_1 = require("../../identity/onboarding/onboarding.module");
const journals_module_1 = require("../../accounting/journals/journals.module");
let SwapTransactionsModule = class SwapTransactionsModule {
};
exports.SwapTransactionsModule = SwapTransactionsModule;
exports.SwapTransactionsModule = SwapTransactionsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, onboarding_module_1.OnboardingModule, journals_module_1.JournalsModule],
        controllers: [swap_transactions_controller_1.SwapTransactionsController, swap_transactions_customer_controller_1.SwapTransactionsCustomerController],
        providers: [swap_transactions_service_1.SwapTransactionsService, swap_workflow_orchestrator_1.SwapWorkflowOrchestrator],
        exports: [swap_transactions_service_1.SwapTransactionsService, swap_workflow_orchestrator_1.SwapWorkflowOrchestrator],
    })
], SwapTransactionsModule);
//# sourceMappingURL=swap-transactions.module.js.map