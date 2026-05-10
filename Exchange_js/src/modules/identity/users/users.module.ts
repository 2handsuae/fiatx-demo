import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { UsersService } from './users.service';
import { UsersDomainService } from './users.domain.service';
import { AdminInvitationsService } from './admin-invitations.service';
import { AdminInviteApprovalService } from './admin-invite-approval.service';
import { AdminInviteWorkflowService } from './admin-invite-workflow.service';
import { AdminRoleBindingChangeApprovalService } from './admin-role-binding-change-approval.service';
import { AdminRoleBindingChangeWorkflowService } from './admin-role-binding-change-workflow.service';
import { AdminRoleChangeRequestController } from './admin-role-change-request.controller';
import { AdminSuspensionApprovalService } from './admin-suspension-approval.service';
import { AdminSuspensionWorkflowService } from './admin-suspension-workflow.service';
import { AdminReactivationApprovalService } from './admin-reactivation-approval.service';
import { AdminReactivationWorkflowService } from './admin-reactivation-workflow.service';
import { AdminPasswordResetApprovalService } from './admin-password-reset-approval.service';
import { AdminPasswordResetWorkflowService } from './admin-password-reset-workflow.service';
import { AdminMfaResetApprovalService } from './admin-mfa-reset-approval.service';
import { AdminMfaResetWorkflowService } from './admin-mfa-reset-workflow.service';
import { AdminCredentialMgmtController } from './admin-credential-mgmt.controller';
import { UsersController } from './users.controller';

@Module({
  imports: [
    PrismaModule,
    AccessControlModule,
    forwardRef(() => ApprovalsModule),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secretKey',
      signOptions: { expiresIn: '24h' },
    }),
  ],
  providers: [
    UsersService,
    UsersDomainService,
    AdminInvitationsService,
    AdminInviteApprovalService,
    AdminInviteWorkflowService,
    AdminRoleBindingChangeApprovalService,
    AdminRoleBindingChangeWorkflowService,
    AdminSuspensionApprovalService,
    AdminSuspensionWorkflowService,
    AdminReactivationApprovalService,
    AdminReactivationWorkflowService,
    AdminPasswordResetApprovalService,
    AdminPasswordResetWorkflowService,
    AdminMfaResetApprovalService,
    AdminMfaResetWorkflowService,
  ],
  controllers: [UsersController, AdminRoleChangeRequestController, AdminCredentialMgmtController],
  exports: [UsersService, UsersDomainService, AdminInvitationsService, AdminPasswordResetWorkflowService],
})
export class UsersModule {}
