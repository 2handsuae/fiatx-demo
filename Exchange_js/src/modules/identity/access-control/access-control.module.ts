import { forwardRef, Global, Module } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { AccessControlController } from './access-control.controller';
import { AdminPermissionGuard } from './admin-permission.guard';
import { RoleDefinitionCreateWorkflowService } from './role-definition-create-workflow.service';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';

@Global()
@Module({
  imports: [forwardRef(() => ApprovalsModule)],
  providers: [AccessControlService, AdminPermissionGuard, RoleDefinitionCreateWorkflowService],
  controllers: [AccessControlController],
  exports: [AccessControlService, AdminPermissionGuard],
})
export class AccessControlModule {}
