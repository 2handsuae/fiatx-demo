import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { CustomersModule } from '../customers/customers.module';
import { SumsubApplicantClientModule } from '../../sumsub-applicant-client/sumsub-applicant-client.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { OnboardingWorkflowService } from './onboarding-workflow.service';
import { OnboardingClientController } from './onboarding.client.controller';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    // 单向依赖：onboarding → customers（新代码不加 forwardRef）。
    CustomersModule,
    SumsubApplicantClientModule,
    ApprovalsModule,
  ],
  providers: [OnboardingWorkflowService],
  controllers: [OnboardingClientController],
  exports: [OnboardingWorkflowService],
})
export class OnboardingModule {}
