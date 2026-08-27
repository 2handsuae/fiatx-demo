import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { UsersModule } from './modules/identity/users/users.module';
import { AuthModule } from './modules/identity/auth/auth.module';
import { AccessControlModule } from './modules/identity/access-control/access-control.module';
import { CustomersModule } from './modules/identity/customers/customers.module';
import { NotificationsModule } from './core/notifications/notifications.module';
import { LiquidityProvidersModule } from './modules/counterparty/liquidity-providers/liquidity-providers.module';
import { AssetsModule } from './modules/asset-treasury/assets/assets.module';
import { LiquidityConfigModule } from './modules/counterparty/liquidity-config/liquidity-config.module';
import { WalletsModule } from './modules/asset-treasury/wallets/wallets.module';
import { WithdrawalAddressesModule } from './modules/asset-treasury/withdrawal-addresses/withdrawal-addresses.module';
import { DepositTransactionsModule } from './modules/trading/deposit-transactions/deposit-transactions.module';
import { DepositDemoModule } from './modules/deposit-sumsub/deposit-demo.module';
import { WithdrawDemoModule } from './modules/withdraw-sumsub/withdraw-demo.module';
import { SwapDemoModule } from './modules/swap-sumsub/swap-demo.module';
import { TigerBeetleModule } from './modules/accounting/tigerbeetle/tigerbeetle.module';
import { WorkflowsModule } from './orchestrators/workflows.module';
import { TreasuryModule } from './modules/asset-treasury/treasury/treasury.module';
import { MonitoringModule } from './core/monitoring/monitoring.module';
import { SwapTransactionsModule } from './modules/trading/swap-transactions/swap-transactions.module';
import { WithdrawTransactionsModule } from './modules/trading/withdraw-transactions/withdraw-transactions.module';
import { PricingCenterModule } from './modules/trading/pricing-center/pricing-center.module';
import { WithdrawalFeeLevelModule } from './modules/trading/withdrawal-fee-level/withdrawal-fee-level.module';
import { SwapFeeLevelModule } from './modules/trading/swap-fee-level/swap-fee-level.module';
import { ReconciliationModule } from './modules/clearing-settle/reconciliation/reconciliation.module';
import { AuditLogsModule } from './modules/audit-logging/audit-logs.module';
import { GovernanceModule } from './modules/governance/governance.module';
import { SumsubIngestionModule } from './modules/sumsub-ingestion/sumsub-ingestion.module';
import { MaterialRefreshModule } from './modules/identity/material-refresh/material-refresh.module';
import { MaterialRequestsModule } from './modules/identity/material-requests/material-requests.module';
import { ProfileBannersModule } from './modules/identity/profile-banners/profile-banners.module';
import { FundsLayerModule } from './modules/funds-layer/funds-layer.module';
import { FundsOrdersModule } from './modules/funds-orders/funds-orders.module';
import { TradingReadinessModule } from './modules/trading/shared/trading-readiness.module';
import { CustomerTagModule } from './modules/identity/customer-tags/customer-tag.module';
import { TransactionLimitsModule as TransactionLimitRulesModule } from './modules/asset-treasury/transaction-limits/transaction-limits.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EventEmitterModule.forRoot({
      global: true,
    }),
    ScheduleModule.forRoot(),
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
    CustomersModule,
    NotificationsModule,
    LiquidityProvidersModule,
    AssetsModule,
    LiquidityConfigModule,
    WalletsModule,
    WithdrawalAddressesModule,
    DepositTransactionsModule,
    DepositDemoModule,
    WithdrawDemoModule,
    SwapDemoModule,
    TigerBeetleModule,
    WorkflowsModule,
    TreasuryModule,
    MonitoringModule,
    SwapTransactionsModule,
    WithdrawTransactionsModule,
    PricingCenterModule,
    WithdrawalFeeLevelModule,
    SwapFeeLevelModule,
    ReconciliationModule,
    AuditLogsModule,
    GovernanceModule,
    SumsubIngestionModule,
    MaterialRefreshModule,
    MaterialRequestsModule,
    ProfileBannersModule,
    FundsLayerModule,
    FundsOrdersModule,
    TradingReadinessModule,
    CustomerTagModule,
    TransactionLimitRulesModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
