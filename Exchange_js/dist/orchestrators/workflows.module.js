"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowsModule = void 0;
const common_1 = require("@nestjs/common");
const deposit_workflow_service_1 = require("./deposit-workflow.service");
const swap_workflow_service_1 = require("./swap-workflow.service");
const withdraw_workflow_orchestrator_1 = require("./withdraw-workflow.orchestrator");
const payins_module_1 = require("../modules/asset-treasury/payins/payins.module");
const deposit_transactions_module_1 = require("../modules/trading/deposit-transactions/deposit-transactions.module");
const swap_transactions_module_1 = require("../modules/trading/swap-transactions/swap-transactions.module");
const journals_module_1 = require("../modules/accounting/journals/journals.module");
const withdraw_transactions_module_1 = require("../modules/trading/withdraw-transactions/withdraw-transactions.module");
const payouts_module_1 = require("../modules/asset-treasury/payouts/payouts.module");
const clearing_module_1 = require("../modules/clearing-settle/clearing/clearing.module");
const prisma_module_1 = require("../core/prisma/prisma.module");
let WorkflowsModule = class WorkflowsModule {
};
exports.WorkflowsModule = WorkflowsModule;
exports.WorkflowsModule = WorkflowsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            payins_module_1.PayinsModule,
            deposit_transactions_module_1.DepositTransactionsModule,
            swap_transactions_module_1.SwapTransactionsModule,
            journals_module_1.JournalsModule,
            withdraw_transactions_module_1.WithdrawTransactionsModule,
            payouts_module_1.PayoutsModule,
            clearing_module_1.ClearingModule,
            prisma_module_1.PrismaModule,
        ],
        providers: [
            deposit_workflow_service_1.DepositWorkflowService,
            swap_workflow_service_1.SwapWorkflowService,
            withdraw_workflow_orchestrator_1.WithdrawWorkflowOrchestrator,
        ],
        exports: [
            deposit_workflow_service_1.DepositWorkflowService,
            swap_workflow_service_1.SwapWorkflowService,
            withdraw_workflow_orchestrator_1.WithdrawWorkflowOrchestrator,
        ],
    })
], WorkflowsModule);
//# sourceMappingURL=workflows.module.js.map