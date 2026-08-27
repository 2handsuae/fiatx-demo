import { Module } from '@nestjs/common';
import { WithdrawDemoScenarioService } from './demo-scenario.service';
import { AdminWithdrawDemoController } from './admin-withdraw-demo.controller';
import { WithdrawTransactionsModule } from '../trading/withdraw-transactions/withdraw-transactions.module';
import { SumsubIngestionModule } from '../sumsub-ingestion/sumsub-ingestion.module';
import { AuditLogsModule } from '../audit-logging/audit-logs.module';
import { SumsubTxnClientModule } from '../deposit-sumsub/sumsub-txn-client.module';

// 站2-α2（2026-08-26）：演示件（场景服务 + ⚡按钮 controller）从 WithdrawSumsubModule
// 摘出（镜像站1b 的 DepositDemoModule）。它是该模块里唯一消费 SumsubIngestionService
// 的住户——搬走后提现侧的 模块↔ingestion 环就地解开。挂载点在 AppModule（与
// WithdrawSumsubModule 平级），不能由后者引入（否则环又画回去）。
const SUMSUB_MOCK_MODE = process.env.SUMSUB_MOCK_MODE === 'true';

@Module({
  imports: [WithdrawTransactionsModule, SumsubIngestionModule, AuditLogsModule, SumsubTxnClientModule],
  providers: [WithdrawDemoScenarioService],
  // Security gate (a)：⚡演示 controller 仅在 SUMSUB_MOCK_MODE=true 时进路由表——
  // 生产态压根不注册（非仅守卫拦截）。语义与搬家前逐字一致。
  controllers: SUMSUB_MOCK_MODE ? [AdminWithdrawDemoController] : [],
})
export class WithdrawDemoModule {}
