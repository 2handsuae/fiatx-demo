// 战役丙波四 T5：DSR（资料请求）主体模块。挂 app.module（同 MaterialRequestsModule 惯例）。
// T7 已在本模块加 client controller。终审修 F1：办结编排（REVERIFY 连带开材料单 + 办结后通知）住
// DsrResolutionWorkflowService——NotificationsModule / MaterialRequestsModule（导出 MaterialRequestIssuerService）
// 的 import 是给它用的，DsrRequestsService 自己只依赖 Prisma + 审计。
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { NotificationsModule } from '../../../core/notifications/notifications.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { MaterialRequestsModule } from '../material-requests/material-requests.module';
import { DsrRequestsService } from './dsr-requests.service';
import { DsrResolutionWorkflowService } from './dsr-resolution-workflow.service';
import { DsrRequestsAdminController } from './dsr-requests.admin.controller';
import { DsrRequestsClientController } from './dsr-requests.client.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule, NotificationsModule, MaterialRequestsModule],
  controllers: [DsrRequestsAdminController, DsrRequestsClientController],
  providers: [DsrRequestsService, DsrResolutionWorkflowService],
  exports: [DsrRequestsService],
})
export class DsrRequestsModule {}
