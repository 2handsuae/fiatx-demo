import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { UsersModule } from './modules/identity/users/users.module';
import { AuthModule } from './modules/identity/auth/auth.module';
import { AccessControlModule } from './modules/identity/access-control/access-control.module';
import { CustomersModule } from './modules/identity/customers/customers.module';
import { CustomerSwapRatesModule } from './modules/identity/customer-swap-rates/customer-swap-rates.module';
import { NotificationsModule } from './core/notifications/notifications.module';
import { LiquidityProvidersModule } from './modules/counterparty/liquidity-providers/liquidity-providers.module';
import { AssetsModule } from './modules/asset-treasury/assets/assets.module';
import { LiquidityConfigModule } from './modules/counterparty/liquidity-config/liquidity-config.module';
import { WalletsModule } from './modules/asset-treasury/wallets/wallets.module';
import { PayinsModule } from './modules/asset-treasury/payins/payins.module';
import { DepositTransactionsModule } from './modules/trading/deposit-transactions/deposit-transactions.module';
import { CoaModule } from './modules/accounting/coa/coa.module';
import { JournalsModule } from './modules/accounting/journals/journals.module';
import { JournalLinesModule } from './modules/accounting/journal-lines/journal-lines.module';
import { AcctEventsModule } from './modules/accounting/acct-events/acct-events.module';
import { JournalHeaderTemplatesModule } from './modules/accounting/journal-header-templates/journal-header-templates.module';
import { JournalLineTemplatesModule } from './modules/accounting/journal-line-templates/journal-line-templates.module';
import { WorkflowsModule } from './orchestrators/workflows.module';
import { TreasuryModule } from './modules/asset-treasury/treasury/treasury.module';
import { MonitoringModule } from './core/monitoring/monitoring.module';
import { SwapTransactionsModule } from './modules/trading/swap-transactions/swap-transactions.module';
import { WithdrawTransactionsModule } from './modules/trading/withdraw-transactions/withdraw-transactions.module';
import { PayoutsModule } from './modules/asset-treasury/payouts/payouts.module';
import { InternalTransactionsModule } from './modules/asset-treasury/internal-transactions/internal-transactions.module';
import { InternalFundsModule } from './modules/asset-treasury/internal-funds/internal-funds.module';
import { InternalTransactionWorkflowModule } from './modules/asset-treasury/internal-transaction-workflow/internal-transaction-workflow.module';
import { ClearingModule } from './modules/clearing-settle/clearing/clearing.module';
import { OutstandingsModule } from './modules/clearing-settle/outstandings/outstandings.module';
import { OutstandingSettlementsModule } from './modules/clearing-settle/outstanding-settlements/outstanding-settlements.module';
import { RiskEngineModule } from './modules/risk-engine/risk-engine.module';
import { OnboardingModule } from './modules/identity/onboarding/onboarding.module';
import { TransactionComplianceModule } from './modules/risk-engine/transaction-compliance/transaction-compliance.module';
import { AuditLogsModule } from './modules/risk-engine/audit-logs/audit-logs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EventEmitterModule.forRoot({
      global: true,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production' &&
          process.env.NODE_ENV !== 'test'
            ? { target: 'pino-pretty' }
            : undefined,
        autoLogging: false,
        customProps: (req: any) => ({
          correlationId: req.id,
        }),
      },
    }),
    UsersModule,
    AuthModule,
    AccessControlModule,
    CustomerSwapRatesModule,
    CustomersModule,
    NotificationsModule,
    LiquidityProvidersModule,
    AssetsModule,
    LiquidityConfigModule,
    WalletsModule,
    PayinsModule,
    DepositTransactionsModule,
    CoaModule,
    JournalsModule,
    JournalLinesModule,
    AcctEventsModule,
    JournalHeaderTemplatesModule,
    JournalLineTemplatesModule,
    WorkflowsModule,
    TreasuryModule,
    MonitoringModule,
    SwapTransactionsModule,
    WithdrawTransactionsModule,
    PayoutsModule,
    InternalTransactionsModule,
    InternalFundsModule,
    InternalTransactionWorkflowModule,
    ClearingModule,
    OutstandingsModule,
    OutstandingSettlementsModule,
    RiskEngineModule,
    TransactionComplianceModule,
    AuditLogsModule,
    OnboardingModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
