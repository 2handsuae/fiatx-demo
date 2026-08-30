import { Module } from '@nestjs/common';
import { DepositWebhookRouter } from './deposit-webhook.router';
import { DepositKytVerdictHandler } from './deposit-kyt-verdict.handler';
import { DepositSlaService } from './deposit-sla.service';
import { DepositTransactionsModule } from '../trading/deposit-transactions/deposit-transactions.module';
import { SumsubTxnClientModule } from '../sumsub-shared/sumsub-txn-client.module';

// 站1b-α2（2026-08-26）解环备忘：
//  - SUMSUB_TXN_CLIENT 抽入 SumsubTxnClientModule（叶子）；本模块**原位再导出**，
//    外域（提现/兑换两侧共五处）经旧路径取 token 不受影响，各自站里改直连。
//  - 演示件摘入 DepositDemoModule（AppModule 挂载）——本模块不再引 ingestion。
//  - 对 DepositTransactionsModule 的引用降为平引用：DTM 已改引令牌叶子模块，
//    反向边消失，充值域 forwardRef 清零（业主 2026-08-26 随模块清零裁定）。
@Module({
  imports: [DepositTransactionsModule, SumsubTxnClientModule],
  providers: [DepositWebhookRouter, DepositKytVerdictHandler, DepositSlaService],
  exports: [DepositWebhookRouter, SumsubTxnClientModule],
})
export class DepositSumsubModule {}
