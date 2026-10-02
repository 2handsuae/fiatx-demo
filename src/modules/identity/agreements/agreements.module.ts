import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../../core/notifications/notifications.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { AgreementsAdminController } from './agreements.admin.controller';
import { AgreementsClientController } from './agreements.client.controller';
import { AgreementPublishApprovalService } from './agreement-publish-approval.service';
import { AgreementPublishWorkflowService } from './agreement-publish-workflow.service';
import { AgreementsReadService } from './agreements-read.service';

/**
 * 战役丙波三：客户协议模块（T2：读 / 同意台账 / 生效翻转服务；T3：发布审批链；T6：客户端三端点；T9：管理台四端点）。
 * 本模块会被 CustomersModule（能力闸）与 auth 模块（注册落同意）引用——零依赖环靠"依赖只向下"：
 * AgreementsModule → ApprovalsModule（只 import PrismaModule）、NotificationsModule（只 import
 * PrismaModule/AuditLogsModule/JwtModule），两者都不回指 CustomersModule / AgreementsModule。
 * 读服务（AgreementsReadService）本身不依赖 ApprovalsService，只有发布 workflow 依赖——
 * 读服务只靠 AuditLogsModule（@Global）与同样 @Global 的 PrismaModule。
 */
@Module({
  imports: [AuditLogsModule, ApprovalsModule, NotificationsModule],
  controllers: [AgreementsClientController, AgreementsAdminController],
  providers: [AgreementsReadService, AgreementPublishApprovalService, AgreementPublishWorkflowService],
  exports: [AgreementsReadService],
})
export class AgreementsModule {}
