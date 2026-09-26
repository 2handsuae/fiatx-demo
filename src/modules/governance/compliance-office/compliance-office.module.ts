// 战役甲波四 · 合规办公室骨架（Task 3）模块接线：T2 义务主体服务 + T3 到期开单 sweep。
// 导入 RegulatoryFilingsModule 拿 RegulatoryFilingService（sweep 命中序最后一步
// openForObligation 开单）——照 incidents.module.ts 同款先例（governance 子域横向拿
// RegulatoryFilingService 都走这条线，不重复声明该服务）。
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { RegulatoryFilingsModule } from '../regulatory-filings/regulatory-filings.module';
import { ComplianceObligationsService } from './compliance-obligations.service';
import { ComplianceObligationSweepService } from './compliance-obligation-sweep.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, RegulatoryFilingsModule],
  providers: [ComplianceObligationsService, ComplianceObligationSweepService],
  exports: [ComplianceObligationsService],
})
export class ComplianceOfficeModule {}
