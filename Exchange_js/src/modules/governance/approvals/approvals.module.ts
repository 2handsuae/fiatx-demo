import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalPolicyService } from './approval-policy.service';
import { ApprovalPolicyChangeApprovalService } from './approval-policy-change-approval.service';
import { ApprovalPolicyChangeWorkflowService } from './approval-policy-change-workflow.service';
import { ApprovalPolicyController } from './approval-policy.controller';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

@Module({
  imports: [
    PrismaModule,
  ],
  controllers: [ApprovalsController, ApprovalPolicyController],
  providers: [
    ApprovalsService,
    ApprovalPolicyService,
    ApprovalPolicyChangeApprovalService,
    ApprovalPolicyChangeWorkflowService,
  ],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
