import { Module, forwardRef } from '@nestjs/common';
import { SwapWebhookRouter } from './swap-webhook.router';
import { SwapKytVerdictHandler } from './swap-kyt-verdict.handler';
import { SwapTransactionsModule } from '../trading/swap-transactions/swap-transactions.module';
import { DepositSumsubModule } from '../deposit-sumsub/deposit-sumsub.module';

/**
 * 兑换域的 Sumsub webhook 落地模块 —— mirror of DepositSumsubModule /
 * WithdrawSumsubModule(deliberate fork, Task 5)。SUMSUB_TXN_CLIENT(mock/http
 * 双模式开关)复用 DepositSumsubModule 已导出的同一个 provider,不在这里重复
 * 声明 —— 三域共用同一套 Sumsub API 凭据/开关。
 *
 * 本任务没有兑换域的 demo-scenario/admin 面板(不像 deposit/withdraw 各自的
 * DemoScenarioService),所以不需要像那两个模块一样再 forwardRef 回
 * SumsubIngestionModule。真正的环是:
 * SumsubIngestionModule → SwapSumsubModule(取 SwapWebhookRouter,Task 5)→
 * SwapTransactionsModule → DepositSumsubModule(取 SUMSUB_TXN_CLIENT,Task 4)→
 * SumsubIngestionModule(取 SumsubIngestionService)——四段边全部 forwardRef,
 * 与既有 WithdrawSumsubModule↔DepositSumsubModule↔SumsubIngestionModule 三角环
 * 同一套模式。
 */
@Module({
  imports: [
    forwardRef(() => SwapTransactionsModule),
    forwardRef(() => DepositSumsubModule),
  ],
  providers: [SwapWebhookRouter, SwapKytVerdictHandler],
  exports: [SwapWebhookRouter],
})
export class SwapSumsubModule {}
