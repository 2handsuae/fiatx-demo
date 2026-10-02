import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { AgreementsReadService } from './agreements-read.service';

/**
 * 战役丙波三：客户协议模块（T2：读 / 同意台账 / 生效翻转服务）。
 * 本模块会被 CustomersModule（能力闸）与 auth 模块（注册落同意）引用，所以 imports 里
 * 不放 CustomersModule / ApprovalsModule——读服务只靠 AuditLogsModule（@Global）与同样 @Global 的
 * PrismaModule，保持零依赖环。
 */
@Module({
  imports: [AuditLogsModule],
  providers: [AgreementsReadService],
  exports: [AgreementsReadService],
})
export class AgreementsModule {}
