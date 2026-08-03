import { Module, forwardRef } from '@nestjs/common';
import { WithdrawWebhookRouter } from './withdraw-webhook.router';
import { WithdrawKytVerdictHandler } from './withdraw-kyt-verdict.handler';
import { WithdrawTransactionsModule } from '../trading/withdraw-transactions/withdraw-transactions.module';
import { DepositSumsubModule } from '../deposit-sumsub/deposit-sumsub.module';

/**
 * 提现域的 Sumsub webhook 落地模块——mirror of DepositSumsubModule(deliberate
 * fork, Task 4)。SUMSUB_TXN_CLIENT(mock/http 双模式开关)复用 DepositSumsubModule
 * 已导出的同一个 provider,不在这里重复声明——两域共用同一套 Sumsub API 凭据/开关。
 *
 * forwardRef 双向:本模块 → DepositSumsubModule(取 SUMSUB_TXN_CLIENT)、
 * SumsubIngestionModule → 本模块(取 WithdrawWebhookRouter)、本模块 →
 * SumsubIngestionModule 未声明(不需要,单向依赖即可,由 ingestion 侧 forwardRef)。
 * 与 DepositSumsubModule↔DepositTransactionsModule↔SumsubIngestionModule 的既有
 * 三角 forwardRef 环同一套模式。
 */
@Module({
  imports: [
    forwardRef(() => WithdrawTransactionsModule),
    forwardRef(() => DepositSumsubModule),
  ],
  providers: [WithdrawWebhookRouter, WithdrawKytVerdictHandler],
  exports: [WithdrawWebhookRouter],
})
export class WithdrawSumsubModule {}
