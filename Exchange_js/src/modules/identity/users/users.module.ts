import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { UsersService } from './users.service';
import { UsersDomainService } from './users.domain.service';
import { AdminInvitationsService } from './admin-invitations.service';
import { AdminInviteApprovalService } from './admin-invite-approval.service';
import { AdminInviteWorkflowService } from './admin-invite-workflow.service';
import { AdminSuspensionApprovalService } from './admin-suspension-approval.service';
import { AdminSuspensionWorkflowService } from './admin-suspension-workflow.service';
import { UsersController } from './users.controller';

@Module({
  imports: [PrismaModule, AccessControlModule, forwardRef(() => ApprovalsModule)],
  providers: [
    UsersService,
    UsersDomainService,
    AdminInvitationsService,
    AdminInviteApprovalService,
    AdminInviteWorkflowService,
    AdminSuspensionApprovalService,
    AdminSuspensionWorkflowService,
  ],
  controllers: [UsersController],
  exports: [UsersService, UsersDomainService, AdminInvitationsService],
})
export class UsersModule {}
