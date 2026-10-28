// 甲波六 T2（2026-10-29）：文件存储横切件模块。导出 DocumentsService，供 LP / 服务商 / 筛查记录三类
// owner 的模块导入后调 store()。PrismaModule / AuditLogsModule 虽均为 @Global，仍照既有模块写法显式导入。
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../../modules/audit-logging/audit-logs.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
