import { Module } from '@nestjs/common';
import { DepositDemoScenarioService } from './demo-scenario.service';
import { AdminDepositDemoController } from './admin-deposit-demo.controller';
import { DepositTransactionsModule } from '../trading/deposit-transactions/deposit-transactions.module';
import { SumsubIngestionModule } from '../sumsub-ingestion/sumsub-ingestion.module';
import { AuditLogsModule } from '../audit-logging/audit-logs.module';
import { SumsubTxnClientModule } from './sumsub-txn-client.module';

// 站1b-α2（2026-08-26）：演示件（场景服务 + ⚡按钮 controller）从 DepositSumsubModule
// 摘出。它是 DSM 里唯一消费 SumsubIngestionService 的住户——搬走后 DSM 不再引
// ingestion，充值侧的 DSM↔ingestion 环就地解开。挂载点在 AppModule（与 DSM 平级），
// 不能由 DSM 引入（否则 DSM→本模块→ingestion 又把环画回去）。
const SUMSUB_MOCK_MODE = process.env.SUMSUB_MOCK_MODE === 'true';

@Module({
  imports: [DepositTransactionsModule, SumsubIngestionModule, AuditLogsModule, SumsubTxnClientModule],
  providers: [DepositDemoScenarioService],
  // Security gate (a)：⚡演示 controller 仅在 SUMSUB_MOCK_MODE=true 时进路由表——
  // 生产态压根不注册（非仅守卫拦截）。语义与搬家前逐字一致。
  controllers: SUMSUB_MOCK_MODE ? [AdminDepositDemoController] : [],
})
export class DepositDemoModule {}
