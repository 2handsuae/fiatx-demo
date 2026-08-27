import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../core/prisma/prisma.module';
import { CustomersModule } from '../../../identity/customers/customers.module';
import { L1GateService } from './l1-gate.service';

/**
 * 三域交易 module 各自 import 本 module 拿 L1GateService。
 * CustomersModule 已导出 CustomerAccessService（提现域 Task 5 起就在用）。
 */
@Module({
  // B2 时代 CustomersModule 边裹过 forwardRef：当年的 require 链在 customers.module
  // 执行完之前就会走到本文件，@Module() 装饰时拿到 undefined（tsc/jest 照不到，
  // 只有真启动才炸）。站4 清扫（sumsub 枢纽解包拉直装载链）后实测已不复现，
  // 拆封并开机实证。若未来启动报 "module at index ... is undefined"，先查装载链
  // 是否又被谁绕回来了。
  imports: [PrismaModule, CustomersModule],
  providers: [L1GateService],
  exports: [L1GateService],
})
export class L1GateModule {}
