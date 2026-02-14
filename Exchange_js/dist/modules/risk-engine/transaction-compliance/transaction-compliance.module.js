"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionComplianceModule = void 0;
const common_1 = require("@nestjs/common");
const transaction_compliance_service_1 = require("./transaction-compliance.service");
const transaction_compliance_admin_controller_1 = require("./transaction-compliance-admin.controller");
let TransactionComplianceModule = class TransactionComplianceModule {
};
exports.TransactionComplianceModule = TransactionComplianceModule;
exports.TransactionComplianceModule = TransactionComplianceModule = __decorate([
    (0, common_1.Module)({
        providers: [transaction_compliance_service_1.TransactionComplianceService],
        controllers: [transaction_compliance_admin_controller_1.TransactionComplianceAdminController],
        exports: [transaction_compliance_service_1.TransactionComplianceService],
    })
], TransactionComplianceModule);
//# sourceMappingURL=transaction-compliance.module.js.map