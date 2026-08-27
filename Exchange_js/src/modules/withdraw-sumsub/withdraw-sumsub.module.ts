import { Module, forwardRef } from '@nestjs/common';
import { WithdrawWebhookRouter } from './withdraw-webhook.router';
import { WithdrawKytVerdictHandler } from './withdraw-kyt-verdict.handler';
import { WithdrawSlaService } from './withdraw-sla.service';
import { WithdrawTransactionsModule } from '../trading/withdraw-transactions/withdraw-transactions.module';
import { SumsubTxnClientModule } from '../deposit-sumsub/sumsub-txn-client.module';

/**
 * 提现域的 Sumsub webhook 落地模块——mirror of DepositSumsubModule(deliberate fork)。
 *
 * 站2-α2（2026-08-26）解环备忘（镜像站1b-α2）：
 *  - SUMSUB_TXN_CLIENT 改引零依赖令牌叶子模块，对 DepositSumsubModule 的
 *    forwardRef 边拆除——两域仍共用同一套 Sumsub 凭据/开关（叶子里同一个 provider）。
 *  - 演示件（场景服务 + ⚡按钮 controller）摘入 WithdrawDemoModule（AppModule 挂载）
 *    ——本模块不再引 ingestion，提现侧的 本模块↔ingestion 环就地解开。
 *  - 对 WithdrawTransactionsModule 保留 forwardRef：文件级装载链
 *    customers→material-requests→swap-sumsub→sumsub-ingestion→本模块→WTM 转圈
 *    回来（与充值侧 DTM 同款实测缘由），站3/6 拆链前不可解包。
 */
@Module({
  imports: [
    forwardRef(() => WithdrawTransactionsModule),
    SumsubTxnClientModule,
  ],
  providers: [
    WithdrawWebhookRouter,
    WithdrawKytVerdictHandler,
    WithdrawSlaService,
  ],
  exports: [WithdrawWebhookRouter],
})
export class WithdrawSumsubModule {}
