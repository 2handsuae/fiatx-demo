import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { FundsLayerModule } from '../../funds-layer/funds-layer.module';
import { PrudentialService } from './prudential.service';
import { PrudentialController } from './prudential.controller';

/**
 * 战役乙波三 T1 · 审慎地基：只读 NLA 状态端点。imports 照 company-funding.module 惯例
 * （Prisma/Audit/TigerBeetle/钱包解析）——AuditLogsModule 本任务未被 PrudentialService
 * 消费（纯读零写，写点在 T2 门 / T3 巡检），提前挂上是为后续任务往本 module 加审计写入的
 * 服务时不必再改 imports。
 */
@Module({
  imports: [PrismaModule, AuditLogsModule, TigerBeetleModule, FundsLayerModule],
  controllers: [PrudentialController],
  providers: [PrudentialService],
  exports: [PrudentialService],
})
export class PrudentialModule {}
