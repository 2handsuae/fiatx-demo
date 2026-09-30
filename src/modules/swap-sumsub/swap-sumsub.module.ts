import { Module } from '@nestjs/common';
import { SwapWebhookRouter } from './swap-webhook.router';
import { SwapKytVerdictHandler } from './swap-kyt-verdict.handler';
import { SwapApplicantActionHandler } from './applicant-action.handler';
import { SwapSlaService } from './swap-sla.service';
import { SwapTransactionsModule } from '../trading/swap-transactions/swap-transactions.module';
import { SumsubTxnClientModule } from '../sumsub-shared/sumsub-txn-client.module';
import { CustomersModule } from '../identity/customers/customers.module';
import { MaterialRequestsModule } from '../identity/material-requests/material-requests.module';
import { NotificationsModule } from '../../core/notifications/notifications.module';

/**
 * 兑换域的 Sumsub webhook 落地模块——mirror of Deposit/WithdrawSumsubModule。
 *
 * 站3-α2（2026-08-27）解环备忘（镜像站1b/站2）：
 *  - SUMSUB_TXN_CLIENT 改引零依赖令牌叶子模块，对 DepositSumsubModule 的
 *    forwardRef 边拆除——三域仍共用同一套 Sumsub 凭据/开关（叶子里同一个 provider）。
 *  - 演示件（场景服务 + ⚡按钮 controller）摘入 SwapDemoModule（AppModule 挂载）
 *    ——本模块不再引 ingestion，兑换侧的 模块↔ingestion 环就地解开。
 *  - SwapApplicantActionHandler 改听 MATERIAL_REQUEST_REVIEWED 域事件（原为
 *    材料复核直调），MaterialRequestsModule→本模块 的反向边随之消失；本模块对
 *    MaterialRequestsModule 的引用只剩 handler 读材料行这一个真实依赖。
 *  - SwapSlaService 留驻本模块（SLA watchdog 属"接 Sumsub"域）。
 */
@Module({
  imports: [
    SwapTransactionsModule,
    SumsubTxnClientModule,
    CustomersModule,
    MaterialRequestsModule,
    // 战役丙波一 T7 修2（复审逮）：SwapSlaService.sweep 的 SLA_BREACH 拒单也要
    // 通知客户，同 T7 fix round 1 的引法。
    NotificationsModule,
  ],
  providers: [
    SwapWebhookRouter,
    SwapKytVerdictHandler,
    SwapApplicantActionHandler,
    SwapSlaService,
  ],
  exports: [SwapWebhookRouter],
})
export class SwapSumsubModule {}
