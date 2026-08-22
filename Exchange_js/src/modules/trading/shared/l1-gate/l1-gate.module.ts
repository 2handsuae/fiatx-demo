import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../core/prisma/prisma.module';
import { CustomersModule } from '../../../identity/customers/customers.module';
import { L1GateService } from './l1-gate.service';

/**
 * 三域交易 module 各自 import 本 module 拿 L1GateService。
 * CustomersModule 已导出 CustomerAccessService（提现域 Task 5 起就在用）。
 */
@Module({
  imports: [PrismaModule, CustomersModule],
  providers: [L1GateService],
  exports: [L1GateService],
})
export class L1GateModule {}
