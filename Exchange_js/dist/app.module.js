"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const nestjs_pino_1 = require("nestjs-pino");
const config_1 = require("@nestjs/config");
const event_emitter_1 = require("@nestjs/event-emitter");
const users_module_1 = require("./modules/identity/users/users.module");
const auth_module_1 = require("./modules/identity/auth/auth.module");
const customers_module_1 = require("./modules/identity/customers/customers.module");
const notifications_module_1 = require("./core/notifications/notifications.module");
const liquidity_providers_module_1 = require("./modules/counterparty/liquidity-providers/liquidity-providers.module");
const assets_module_1 = require("./modules/asset-treasury/assets/assets.module");
const liquidity_config_module_1 = require("./modules/counterparty/liquidity-config/liquidity-config.module");
const wallets_module_1 = require("./modules/asset-treasury/wallets/wallets.module");
const payins_module_1 = require("./modules/asset-treasury/payins/payins.module");
const deposit_transactions_module_1 = require("./modules/trading/deposit-transactions/deposit-transactions.module");
const coa_module_1 = require("./modules/accounting/coa/coa.module");
const journals_module_1 = require("./modules/accounting/journals/journals.module");
const journal_lines_module_1 = require("./modules/accounting/journal-lines/journal-lines.module");
const acct_events_module_1 = require("./modules/accounting/acct-events/acct-events.module");
const journal_header_templates_module_1 = require("./modules/accounting/journal-header-templates/journal-header-templates.module");
const journal_line_templates_module_1 = require("./modules/accounting/journal-line-templates/journal-line-templates.module");
const workflows_module_1 = require("./orchestrators/workflows.module");
const treasury_module_1 = require("./modules/asset-treasury/treasury/treasury.module");
const monitoring_module_1 = require("./core/monitoring/monitoring.module");
const swap_transactions_module_1 = require("./modules/trading/swap-transactions/swap-transactions.module");
const withdraw_transactions_module_1 = require("./modules/trading/withdraw-transactions/withdraw-transactions.module");
const payouts_module_1 = require("./modules/asset-treasury/payouts/payouts.module");
const clearing_module_1 = require("./modules/clearing-settle/clearing/clearing.module");
const risk_engine_module_1 = require("./modules/risk-engine/risk-engine.module");
const onboarding_module_1 = require("./modules/identity/onboarding/onboarding.module");
const transaction_compliance_module_1 = require("./modules/risk-engine/transaction-compliance/transaction-compliance.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
            }),
            event_emitter_1.EventEmitterModule.forRoot({
                global: true,
            }),
            nestjs_pino_1.LoggerModule.forRoot({
                pinoHttp: {
                    transport: process.env.NODE_ENV !== 'production' &&
                        process.env.NODE_ENV !== 'test'
                        ? { target: 'pino-pretty' }
                        : undefined,
                    autoLogging: false,
                    customProps: (req) => ({
                        correlationId: req.id,
                    }),
                },
            }),
            users_module_1.UsersModule,
            auth_module_1.AuthModule,
            customers_module_1.CustomersModule,
            notifications_module_1.NotificationsModule,
            liquidity_providers_module_1.LiquidityProvidersModule,
            assets_module_1.AssetsModule,
            liquidity_config_module_1.LiquidityConfigModule,
            wallets_module_1.WalletsModule,
            payins_module_1.PayinsModule,
            deposit_transactions_module_1.DepositTransactionsModule,
            coa_module_1.CoaModule,
            journals_module_1.JournalsModule,
            journal_lines_module_1.JournalLinesModule,
            acct_events_module_1.AcctEventsModule,
            journal_header_templates_module_1.JournalHeaderTemplatesModule,
            journal_line_templates_module_1.JournalLineTemplatesModule,
            workflows_module_1.WorkflowsModule,
            treasury_module_1.TreasuryModule,
            monitoring_module_1.MonitoringModule,
            swap_transactions_module_1.SwapTransactionsModule,
            withdraw_transactions_module_1.WithdrawTransactionsModule,
            payouts_module_1.PayoutsModule,
            clearing_module_1.ClearingModule,
            risk_engine_module_1.RiskEngineModule,
            transaction_compliance_module_1.TransactionComplianceModule,
            onboarding_module_1.OnboardingModule,
        ],
        controllers: [],
        providers: [],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map