import { Module } from '@nestjs/common';
import { SUMSUB_TXN_CLIENT } from './sumsub-txn-client.interface';
import { HttpSumsubTxnClient } from './sumsub-txn-client.http';
import { MockSumsubTxnClient } from './sumsub-txn-client.mock';

// 站1b-α2（2026-08-26）：SUMSUB_TXN_CLIENT 从 DepositSumsubModule 抽出成零依赖
// 叶子模块。此前五个模块（充值/提现/兑换交易域 + 提现/兑换 sumsub 域）forwardRef
// 整个 DSM 只为取这一个 provider——令牌落叶子后，充值域两条真环就地解开；
// 其余域仍经 DSM 的模块再导出取到同一实例（各自站里再改为直连本模块）。
// NOTE: process.env 在模块装饰器求值时机读取，main.ts 已前置 dotenv.config()。
const SUMSUB_MOCK_MODE = process.env.SUMSUB_MOCK_MODE === 'true';

@Module({
  providers: [
    {
      provide: SUMSUB_TXN_CLIENT,
      useClass: SUMSUB_MOCK_MODE ? MockSumsubTxnClient : HttpSumsubTxnClient,
    },
  ],
  exports: [SUMSUB_TXN_CLIENT],
})
export class SumsubTxnClientModule {}
