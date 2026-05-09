import { forwardRef, Global, Module } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { AccessControlController } from './access-control.controller';
import { AdminPermissionGuard } from './admin-permission.guard';
import { RoleDefinitionCreateApprovalService } from './role-definition-create-approval.service';
import { RoleDefinitionCreateWorkflowService } from './role-definition-create-workflow.service';
import { RoleDefinitionModifyApprovalService } from './role-definition-modify-approval.service';
import { RoleDefinitionModifyWorkflowService } from './role-definition-modify-workflow.service';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';

@Global()
@Module({
  imports: [forwardRef(() => ApprovalsModule)],
  providers: [AccessControlService, AdminPermissionGuard, RoleDefinitionCreateApprovalService, RoleDefinitionCreateWorkflowService, RoleDefinitionModifyApprovalService, RoleDefinitionModifyWorkflowService],
  controllers: [AccessControlController],
  exports: [AccessControlService, AdminPermissionGuard],
})
export class AccessControlModule {}
