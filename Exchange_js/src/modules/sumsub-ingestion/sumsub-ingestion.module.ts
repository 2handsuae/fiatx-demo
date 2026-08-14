import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { OnboardingModule } from '../identity/onboarding/onboarding.module';
import { ClientRiskAssessmentModule } from '../identity/client-risk-assessment/client-risk-assessment.module';
import { MaterialRefreshModule } from '../identity/material-refresh/material-refresh.module';
import { TierUpgradeCaseModule } from '../identity/tier-upgrade-case/tier-upgrade-case.module';
import { DepositTransactionsModule } from '../trading/deposit-transactions/deposit-transactions.module';
import { WithdrawTransactionsModule } from '../trading/withdraw-transactions/withdraw-transactions.module';
import { DepositSumsubModule } from '../deposit-sumsub/deposit-sumsub.module';
import { WithdrawSumsubModule } from '../withdraw-sumsub/withdraw-sumsub.module';
import { SwapSumsubModule } from '../swap-sumsub/swap-sumsub.module';
import { SumsubIngestionService } from './sumsub-ingestion.service';
import { SumsubIngestionController } from './sumsub-ingestion.controller';
import { SumsubIngestionAdminController } from './sumsub-ingestion-admin.controller';
import { AdminSumsubSimulationController } from './admin-sumsub-simulation.controller';
import { SumsubRetryService } from './sumsub-ingestion-retry.service';
@Module({
  imports: [
    PrismaModule,
    forwardRef(() => OnboardingModule),
    forwardRef(() => ClientRiskAssessmentModule),
    forwardRef(() => MaterialRefreshModule),
    forwardRef(() => TierUpgradeCaseModule),
    forwardRef(() => DepositTransactionsModule),
    forwardRef(() => WithdrawTransactionsModule),
    // Task 6: DepositSumsubModule now also imports this module (forwardRef(() =>
    // SumsubIngestionModule)) so its demo-scenario service can call
    // SumsubIngestionService.ingest() — wrap in forwardRef on this side too, matching
    // the existing DepositTransactionsModule<->DepositSumsubModule cycle pattern.
    forwardRef(() => DepositSumsubModule),
    // Task 4: withdraw-sumsub's WithdrawWebhookRouter — deposit-first, withdraw-second
    // cascade for KYT verdict webhooks (see dispatch() below). forwardRef because
    // WithdrawSumsubModule → DepositSumsubModule → SumsubIngestionModule closes a cycle.
    forwardRef(() => WithdrawSumsubModule),
    // Task 5: swap-sumsub's SwapWebhookRouter — third and last cascade stage
    // (deposit → withdraw → swap). forwardRef because SwapSumsubModule →
    // SwapTransactionsModule → DepositSumsubModule → SumsubIngestionModule
    // closes a cycle, same pattern as the WithdrawSumsubModule edge above.
    forwardRef(() => SwapSumsubModule),
  ],
  providers: [SumsubIngestionService, SumsubRetryService],
  controllers: [SumsubIngestionController, SumsubIngestionAdminController, AdminSumsubSimulationController],
  exports: [SumsubIngestionService],
})
export class SumsubIngestionModule {}
