"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WithdrawTransactionsModule = void 0;
const common_1 = require("@nestjs/common");
const withdraw_transactions_service_1 = require("./withdraw-transactions.service");
const withdraw_transactions_controller_1 = require("./withdraw-transactions.controller");
const prisma_module_1 = require("../../../core/prisma/prisma.module");
const onboarding_module_1 = require("../../identity/onboarding/onboarding.module");
const journals_module_1 = require("../../accounting/journals/journals.module");
const transaction_compliance_module_1 = require("../../risk-engine/transaction-compliance/transaction-compliance.module");
let WithdrawTransactionsModule = class WithdrawTransactionsModule {
};
exports.WithdrawTransactionsModule = WithdrawTransactionsModule;
exports.WithdrawTransactionsModule = WithdrawTransactionsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            prisma_module_1.PrismaModule,
            onboarding_module_1.OnboardingModule,
            journals_module_1.JournalsModule,
            transaction_compliance_module_1.TransactionComplianceModule,
        ],
        controllers: [withdraw_transactions_controller_1.WithdrawTransactionsController],
        providers: [withdraw_transactions_service_1.WithdrawTransactionsService],
        exports: [withdraw_transactions_service_1.WithdrawTransactionsService],
    })
], WithdrawTransactionsModule);
//# sourceMappingURL=withdraw-transactions.module.js.map