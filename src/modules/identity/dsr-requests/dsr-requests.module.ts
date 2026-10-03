// 战役丙波四 T5：DSR（资料请求）主体模块。挂 app.module（同 MaterialRequestsModule 惯例）。
// imports NotificationsModule——resolve 落库后调 NotificationsService.notifyDsrResolved。
// T7 已在本模块加 client controller；T8 imports 材料请求模块（REVERIFY 连带开单，调其导出的 MaterialRequestIssuerService）。
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { NotificationsModule } from '../../../core/notifications/notifications.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { MaterialRequestsModule } from '../material-requests/material-requests.module';
import { DsrRequestsService } from './dsr-requests.service';
import { DsrRequestsAdminController } from './dsr-requests.admin.controller';
import { DsrRequestsClientController } from './dsr-requests.client.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule, NotificationsModule, MaterialRequestsModule],
  controllers: [DsrRequestsAdminController, DsrRequestsClientController],
  providers: [DsrRequestsService],
  exports: [DsrRequestsService],
})
export class DsrRequestsModule {}
