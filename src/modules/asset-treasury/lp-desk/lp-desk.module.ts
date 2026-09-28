import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { LpProfileService } from './lp-profile.service';
import { LpProfileWorkflowService } from './lp-profile-workflow.service';
import { LpProfileApprovalService, LpProfileChangeApprovalService } from './lp-profile-approval.service';
import { LpProfileController } from './lp-profile.controller';

/**
 * 战役乙波一 · LP 档案（LiquidityProvider）：建行 + 结算坐标变更 + 启停，建档 / 改坐标
 * 均走 ApprovalsService 正门（CFO 单步）。
 */
@Module({
  imports: [PrismaModule, AuditLogsModule, ApprovalsModule],
  controllers: [LpProfileController],
  providers: [LpProfileService, LpProfileWorkflowService, LpProfileApprovalService, LpProfileChangeApprovalService],
  exports: [LpProfileService],
})
export class LpDeskModule {}
