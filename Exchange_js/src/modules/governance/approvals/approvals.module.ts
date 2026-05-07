import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ChangeTicketsModule } from '../change-tickets/change-tickets.module';
import { DeleteRequestsModule } from '../delete-requests/delete-requests.module';
import { ApprovalPolicyService } from './approval-policy.service';
import { ApprovalPolicyChangeApprovalService } from './approval-policy-change-approval.service';
import { ApprovalPolicyChangeWorkflowService } from './approval-policy-change-workflow.service';
import { ApprovalPolicyController } from './approval-policy.controller';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => ChangeTicketsModule),
    forwardRef(() => DeleteRequestsModule),
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
