import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { CustomersModule } from '../customers/customers.module';
import { SumsubApplicantClientModule } from '../../sumsub-applicant-client/sumsub-applicant-client.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { TierUpgradeWorkflowService } from './tier-upgrade-workflow.service';
import { TierUpgradeClientController } from './tier-upgrade.client.controller';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    // 单向依赖：tier-upgrade → customers（新代码不加 forwardRef）。
    CustomersModule,
    SumsubApplicantClientModule,
    ApprovalsModule,
  ],
  providers: [TierUpgradeWorkflowService],
  controllers: [TierUpgradeClientController],
  exports: [TierUpgradeWorkflowService],
})
export class TierUpgradeModule {}
