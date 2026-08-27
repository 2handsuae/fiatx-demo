import { Module } from '@nestjs/common';
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
import { CustomersModule } from '../identity/customers/customers.module';
import { MaterialRequestsModule } from '../identity/material-requests/material-requests.module';
// 站4 解包：本模块曾满身 forwardRef——那是三颗 sumsub 卫星还回指本模块的年代
// （demo-scenario 走 ingest()）。站3-α2 把演示件摘进独立 demo 模块（AppModule 直挂、
// 无人回指）后，环已不存在；2026-08-27 全数拆封并开机实证。若未来有人重新让
// 卫星或身份域模块 import 本模块，先想想演示件是不是又放错了地方。
@Module({
  imports: [
    // 限制账（Task 7）：CustomerRestrictionsService / CustomerRestrictionWorkflowService 由 CustomersModule exports。
    CustomersModule,
    PrismaModule,
    OnboardingModule,
    ClientRiskAssessmentModule,
    MaterialRefreshModule,
    TierUpgradeCaseModule,
    DepositTransactionsModule,
    WithdrawTransactionsModule,
    DepositSumsubModule,
    // 三段级联裁决路由（deposit → withdraw → swap，见 service.dispatch()）。
    WithdrawSumsubModule,
    SwapSumsubModule,
    // 材料请求账（Task 4）：applicantActionReviewed 按 externalActionId 一次查表，落在 MaterialRequestReviewService。
    MaterialRequestsModule,
  ],
  providers: [SumsubIngestionService, SumsubRetryService],
  controllers: [SumsubIngestionController, SumsubIngestionAdminController, AdminSumsubSimulationController],
  exports: [SumsubIngestionService],
})
export class SumsubIngestionModule {}
