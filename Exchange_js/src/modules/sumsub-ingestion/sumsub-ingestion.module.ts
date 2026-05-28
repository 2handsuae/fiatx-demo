import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { OnboardingModule } from '../identity/onboarding/onboarding.module';
import { ClientRiskAssessmentModule } from '../identity/client-risk-assessment/client-risk-assessment.module';
import { MaterialRefreshModule } from '../identity/material-refresh/material-refresh.module';
import { TierUpgradeCaseModule } from '../identity/tier-upgrade-case/tier-upgrade-case.module';
import { DepositTransactionsModule } from '../trading/deposit-transactions/deposit-transactions.module';
import { WithdrawTransactionsModule } from '../trading/withdraw-transactions/withdraw-transactions.module';
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
  ],
  providers: [SumsubIngestionService, SumsubRetryService],
  controllers: [SumsubIngestionController, SumsubIngestionAdminController, AdminSumsubSimulationController],
  exports: [SumsubIngestionService],
})
export class SumsubIngestionModule {}
