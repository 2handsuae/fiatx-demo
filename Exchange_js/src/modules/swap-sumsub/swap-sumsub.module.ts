import { Module, forwardRef } from '@nestjs/common';
import { SwapWebhookRouter } from './swap-webhook.router';
import { SwapKytVerdictHandler } from './swap-kyt-verdict.handler';
import { SwapApplicantActionHandler } from './applicant-action.handler';
import { SwapSlaService } from './swap-sla.service';
import { SwapTransactionsModule } from '../trading/swap-transactions/swap-transactions.module';
import { DepositSumsubModule } from '../deposit-sumsub/deposit-sumsub.module';
import { SumsubIngestionModule } from '../sumsub-ingestion/sumsub-ingestion.module';
import { CustomersModule } from '../identity/customers/customers.module';
import { SwapDemoScenarioService } from './demo-scenario.service';
import { AdminSwapDemoController } from './admin-swap-demo.controller';

// Task 9: mirrors DepositSumsubModule/WithdrawSumsubModule's identically-named
// switch (see those files' comment on process.env timing vs. ConfigModule.forRoot()).
const SUMSUB_MOCK_MODE = process.env.SUMSUB_MOCK_MODE === 'true';

/**
 * 兑换域的 Sumsub webhook 落地模块 —— mirror of DepositSumsubModule /
 * WithdrawSumsubModule(deliberate fork, Task 5/9)。SUMSUB_TXN_CLIENT(mock/http
 * 双模式开关)复用 DepositSumsubModule 已导出的同一个 provider,不在这里重复
 * 声明 —— 三域共用同一套 Sumsub API 凭据/开关。
 *
 * Task 9 补上兑换域自己的 demo-scenario/admin 面板(SwapDemoScenarioService),
 * 因此像 deposit/withdraw 两个模块一样 forwardRef 回 SumsubIngestionModule(取
 * SumsubIngestionService)。完整的环是:
 * SumsubIngestionModule → SwapSumsubModule(取 SwapWebhookRouter,Task 5)→
 * SwapTransactionsModule → DepositSumsubModule(取 SUMSUB_TXN_CLIENT,Task 4)→
 * SumsubIngestionModule(取 SumsubIngestionService,Task 9 新增边)——四段边全部
 * forwardRef,与既有 WithdrawSumsubModule↔DepositSumsubModule↔
 * SumsubIngestionModule 三角环同一套模式。
 *
 * SwapSlaService(Task 8,合规超时看门狗)登记在这里而不是
 * SwapTransactionsModule ——它是兑换域"接 Sumsub"这条线专属的组件（消费
 * SwapTransactionsService.markStatus + SwapWorkflowService.submitSumsubTxnOut,
 * 两者都已从 SwapTransactionsModule 导出），与 DepositSlaService/
 * WithdrawSlaService 分别挂在 deposit-sumsub.module.ts/
 * withdraw-sumsub.module.ts（而不是各自的 xxx-transactions.module.ts）同一个
 * 归属原则：SLA watchdog 属于"接 Sumsub"域，不属于交易域本体。
 */
@Module({
  imports: [
    forwardRef(() => SwapTransactionsModule),
    forwardRef(() => DepositSumsubModule),
    forwardRef(() => SumsubIngestionModule),
    // Task 13: SwapApplicantActionHandler injects CustomerRestrictionsService +
    // CustomerPendingActionService. Plain import (no forwardRef) — mirrors
    // SwapTransactionsModule's identical import of CustomersModule (Task 7):
    // CustomersModule only depends on PrismaModule (@Global) and
    // NotificationsModule (a leaf module), so there's no path back here to cycle on.
    CustomersModule,
  ],
  providers: [
    SwapWebhookRouter,
    SwapKytVerdictHandler,
    SwapApplicantActionHandler,
    SwapSlaService,
    SwapDemoScenarioService,
  ],
  // Security gate (a): mirrors DepositSumsubModule/WithdrawSumsubModule — this
  // controller only exists in the Nest route table when SUMSUB_MOCK_MODE=true,
  // in production it is never registered (not merely guard-blocked).
  controllers: SUMSUB_MOCK_MODE ? [AdminSwapDemoController] : [],
  exports: [SwapWebhookRouter],
})
export class SwapSumsubModule {}
