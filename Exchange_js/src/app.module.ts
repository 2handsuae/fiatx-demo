import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { UsersModule } from './modules/identity/users/users.module';
import { AuthModule } from './modules/identity/auth/auth.module';
import { AccessControlModule } from './modules/identity/access-control/access-control.module';
import { GovernedExecutionModule } from './modules/identity/governed-execution/governed-execution.module';
import { CustomersModule } from './modules/identity/customers/customers.module';
import { NotificationsModule } from './core/notifications/notifications.module';
import { LiquidityProvidersModule } from './modules/counterparty/liquidity-providers/liquidity-providers.module';
import { AssetsModule } from './modules/asset-treasury/assets/assets.module';
import { LiquidityConfigModule } from './modules/counterparty/liquidity-config/liquidity-config.module';
import { WalletsModule } from './modules/asset-treasury/wallets/wallets.module';
import { WithdrawalAddressesModule } from './modules/asset-treasury/withdrawal-addresses/withdrawal-addresses.module';
import { PayinsModule } from './modules/asset-treasury/payins/payins.module';
import { DepositTransactionsModule } from './modules/trading/deposit-transactions/deposit-transactions.module';
import { TigerBeetleModule } from './modules/accounting/tigerbeetle/tigerbeetle.module';
import { WorkflowsModule } from './orchestrators/workflows.module';
import { TreasuryModule } from './modules/asset-treasury/treasury/treasury.module';
import { MonitoringModule } from './core/monitoring/monitoring.module';
import { SwapTransactionsModule } from './modules/trading/swap-transactions/swap-transactions.module';
import { WithdrawTransactionsModule } from './modules/trading/withdraw-transactions/withdraw-transactions.module';
import { PricingCenterModule } from './modules/trading/pricing-center/pricing-center.module';
import { PayoutsModule } from './modules/asset-treasury/payouts/payouts.module';
import { InternalTransactionsModule } from './modules/asset-treasury/internal-transactions/internal-transactions.module';
import { InternalFundsModule } from './modules/asset-treasury/internal-funds/internal-funds.module';
import { InternalTransactionWorkflowModule } from './modules/asset-treasury/internal-transaction-workflow/internal-transaction-workflow.module';
import { FeeOccurrencesModule } from './modules/asset-treasury/fee-occurrences/fee-occurrences.module';
import { ReimbursementObligationsModule } from './modules/asset-treasury/reimbursement-obligations/reimbursement-obligations.module';
import { OutstandingsModule } from './modules/clearing-settle/outstandings/outstandings.module';
import { OutstandingSettlementsModule } from './modules/clearing-settle/outstanding-settlements/outstanding-settlements.module';
import { PoolSettlementBatchesModule } from './modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.module';
import { SafeguardingReconciliationModule } from './modules/clearing-settle/safeguarding-reconciliation/safeguarding-reconciliation.module';
import { RiskEngineModule } from './modules/risk-engine/risk-engine.module';
import { OnboardingModule } from './modules/identity/onboarding/onboarding.module';
import { TransactionComplianceModule } from './modules/risk-engine/transaction-compliance/transaction-compliance.module';
import { AuditLogsModule } from './modules/audit-logging/audit-logs.module';
import { GovernanceModule } from './modules/governance/governance.module';
import { SumsubIngestionModule } from './modules/sumsub-ingestion/sumsub-ingestion.module';
import { ClientRiskAssessmentModule } from './modules/identity/client-risk-assessment/client-risk-assessment.module';
import { MaterialRefreshModule } from './modules/identity/material-refresh/material-refresh.module';
import { ProfileBannersModule } from './modules/identity/profile-banners/profile-banners.module';

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
    GovernedExecutionModule,
    CustomersModule,
    NotificationsModule,
    LiquidityProvidersModule,
    AssetsModule,
    LiquidityConfigModule,
    WalletsModule,
    WithdrawalAddressesModule,
    PayinsModule,
    DepositTransactionsModule,
    TigerBeetleModule,
    WorkflowsModule,
    TreasuryModule,
    MonitoringModule,
    SwapTransactionsModule,
    WithdrawTransactionsModule,
    PricingCenterModule,
    PayoutsModule,
    InternalTransactionsModule,
    InternalFundsModule,
    InternalTransactionWorkflowModule,
    FeeOccurrencesModule,
    ReimbursementObligationsModule,
    OutstandingsModule,
    OutstandingSettlementsModule,
    PoolSettlementBatchesModule,
    SafeguardingReconciliationModule,
    RiskEngineModule,
    TransactionComplianceModule,
    AuditLogsModule,
    GovernanceModule,
    OnboardingModule,
    SumsubIngestionModule,
    ClientRiskAssessmentModule,
    MaterialRefreshModule,
    ProfileBannersModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
