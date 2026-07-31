import { Module, forwardRef } from '@nestjs/common';
import { DepositWebhookRouter } from './deposit-webhook.router';
import { DepositKytVerdictHandler } from './deposit-kyt-verdict.handler';
import { DepositSlaService } from './deposit-sla.service';
import { SUMSUB_TXN_CLIENT } from './sumsub-txn-client.interface';
import { HttpSumsubTxnClient } from './sumsub-txn-client.http';
import { MockSumsubTxnClient } from './sumsub-txn-client.mock';
import { DepositTransactionsModule } from '../trading/deposit-transactions/deposit-transactions.module';
import { SumsubIngestionModule } from '../sumsub-ingestion/sumsub-ingestion.module';
import { DepositDemoScenarioService } from './demo-scenario.service';
import { AdminDepositDemoController } from './admin-deposit-demo.controller';

// Task 6(计划1 甲方案):与 identity/onboarding/providers/sumsub/sumsub.client.ts:84 等处
// 同名开关对齐。NOTE:process.env 在此处(模块装饰器求值时机,先于 AppModule 自身
// ConfigModule.forRoot() 对 .env 的加载 —— 已在 main.ts 里前置 dotenv.config() 修正,
// 详见该文件注释)读取才拿得到 .env 里的值。
const SUMSUB_MOCK_MODE = process.env.SUMSUB_MOCK_MODE === 'true';

@Module({
  imports: [
    forwardRef(() => DepositTransactionsModule),
    forwardRef(() => SumsubIngestionModule),
  ],
  providers: [
    DepositWebhookRouter,
    DepositKytVerdictHandler,
    DepositSlaService,
    {
      provide: SUMSUB_TXN_CLIENT,
      useClass: SUMSUB_MOCK_MODE ? MockSumsubTxnClient : HttpSumsubTxnClient,
    },
    DepositDemoScenarioService,
  ],
  // Security gate (a): the demo scenario controller only exists in the Nest route
  // table when SUMSUB_MOCK_MODE=true — in production it is never registered (not
  // merely guard-blocked). Sumsub sandbox can't reproduce sanctions/PEP/slow-case
  // outcomes, so demos drive them via fixtures instead (see fixtures/verdict-buttons.ts).
  controllers: SUMSUB_MOCK_MODE ? [AdminDepositDemoController] : [],
  exports: [DepositWebhookRouter, SUMSUB_TXN_CLIENT],
})
export class DepositSumsubModule {}
