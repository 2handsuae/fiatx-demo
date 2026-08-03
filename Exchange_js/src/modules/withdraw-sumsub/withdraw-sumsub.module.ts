import { Module, forwardRef } from '@nestjs/common';
import { WithdrawWebhookRouter } from './withdraw-webhook.router';
import { WithdrawKytVerdictHandler } from './withdraw-kyt-verdict.handler';
import { WithdrawSlaService } from './withdraw-sla.service';
import { WithdrawTransactionsModule } from '../trading/withdraw-transactions/withdraw-transactions.module';
import { DepositSumsubModule } from '../deposit-sumsub/deposit-sumsub.module';
import { SumsubIngestionModule } from '../sumsub-ingestion/sumsub-ingestion.module';
import { WithdrawDemoScenarioService } from './demo-scenario.service';
import { AdminWithdrawDemoController } from './admin-withdraw-demo.controller';

// Task 10: mirrors DepositSumsubModule's identically-named switch (see that
// file's comment on process.env timing vs. ConfigModule.forRoot()).
const SUMSUB_MOCK_MODE = process.env.SUMSUB_MOCK_MODE === 'true';

/**
 * 提现域的 Sumsub webhook 落地模块——mirror of DepositSumsubModule(deliberate
 * fork, Task 4)。SUMSUB_TXN_CLIENT(mock/http 双模式开关)复用 DepositSumsubModule
 * 已导出的同一个 provider,不在这里重复声明——两域共用同一套 Sumsub API 凭据/开关。
 *
 * forwardRef 双向:本模块 → DepositSumsubModule(取 SUMSUB_TXN_CLIENT)、本模块 →
 * SumsubIngestionModule(取 SumsubIngestionService,供 Task 10 的
 * WithdrawDemoScenarioService 使用)、SumsubIngestionModule → 本模块(取
 * WithdrawWebhookRouter)。与 DepositSumsubModule↔DepositTransactionsModule↔
 * SumsubIngestionModule 的既有三角 forwardRef 环同一套模式。
 */
@Module({
  imports: [
    forwardRef(() => WithdrawTransactionsModule),
    forwardRef(() => DepositSumsubModule),
    forwardRef(() => SumsubIngestionModule),
  ],
  providers: [
    WithdrawWebhookRouter,
    WithdrawKytVerdictHandler,
    WithdrawSlaService,
    WithdrawDemoScenarioService,
  ],
  // Security gate (a): mirrors DepositSumsubModule — this controller only exists
  // in the Nest route table when SUMSUB_MOCK_MODE=true, in production it is
  // never registered (not merely guard-blocked).
  controllers: SUMSUB_MOCK_MODE ? [AdminWithdrawDemoController] : [],
  exports: [WithdrawWebhookRouter],
})
export class WithdrawSumsubModule {}
