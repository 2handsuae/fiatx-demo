import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../../core/prisma/prisma.module';
import { CustomersModule } from '../../../identity/customers/customers.module';
import { L1GateService } from './l1-gate.service';

/**
 * 三域交易 module 各自 import 本 module 拿 L1GateService。
 * CustomersModule 已导出 CustomerAccessService（提现域 Task 5 起就在用）。
 */
@Module({
  // B2：forwardRef —— 本 module 被接进提现/兑换后，真实 require 链
  // （AppModule → CustomersModule → MaterialRequestsModule → OnboardingModule →
  //  … → SumsubIngestionModule → WithdrawTransactionsModule → 这里）会在
  // customers.module.ts 执行完、导出 CustomersModule 类之前就走到本文件，
  // 于是 @Module() 装饰时读到的 `CustomersModule` 是 undefined，Nest 扫描器
  // 直接报 "The module at index [1] ... is undefined"。tsc 与 jest 都照不到
  // （只有真启动才炸）—— B1 建它时没有任何 consumer，所以这条一直是潜伏的。
  imports: [PrismaModule, forwardRef(() => CustomersModule)],
  providers: [L1GateService],
  exports: [L1GateService],
})
export class L1GateModule {}
