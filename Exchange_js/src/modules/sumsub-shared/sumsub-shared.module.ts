import { Module } from '@nestjs/common';
import { SumsubTxnClientModule } from './sumsub-txn-client.module';

/**
 * 三域（充值/提现/兑换）共用的 Sumsub 底座：报文类型、报文生成器、
 * webhook 类型常量、交易客户端。
 *
 * 2026-08-29 从 deposit-sumsub 迁出——此前 withdraw/swap 两个平级域
 * 反向 import 充值域，充值域事实上成了三域的老大。
 */
@Module({
  imports: [SumsubTxnClientModule],
  exports: [SumsubTxnClientModule],
})
export class SumsubSharedModule {}
