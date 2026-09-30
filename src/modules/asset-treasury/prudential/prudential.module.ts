import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { FundsLayerModule } from '../../funds-layer/funds-layer.module';
import { PrudentialService } from './prudential.service';
import { PrudentialController } from './prudential.controller';

/**
 * 战役乙波三 T1 · 审慎地基：只读 NLA 状态端点。imports 照 company-funding.module 惯例
 * （Prisma/Audit/TigerBeetle/钱包解析）——T1 首版 AuditLogsModule 提前挂上但零调用；
 * T2 · 算术门 assertPostOutflowCompliant 开始消费 AuditLogsService（拦截留痕写点）。
 */
@Module({
  imports: [PrismaModule, AuditLogsModule, TigerBeetleModule, FundsLayerModule],
  controllers: [PrudentialController],
  providers: [PrudentialService],
  exports: [PrudentialService],
})
export class PrudentialModule {}
