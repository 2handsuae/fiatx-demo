import { Global, Module, forwardRef } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { AccessControlController } from './access-control.controller';
import { AdminPermissionGuard } from './admin-permission.guard';
import { ChangeTicketsModule } from '../../governance/change-tickets/change-tickets.module';

@Global()
@Module({
  imports: [forwardRef(() => ChangeTicketsModule)],
  providers: [AccessControlService, AdminPermissionGuard],
  controllers: [AccessControlController],
  exports: [AccessControlService, AdminPermissionGuard],
})
export class AccessControlModule {}
