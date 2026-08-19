import { forwardRef, Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomerRestrictionsService } from './customer-restrictions.service';
import { CustomerAccessService } from './customer-access.service';
import { CustomersController } from './customers.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { NotificationsModule } from '../../../core/notifications/notifications.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { FundsOrdersModule } from '../../funds-orders/funds-orders.module';
import { CustomerRestrictionWorkflowService } from './customer-restriction-workflow.service';
import { CustomerRestrictionReleaseMlroApprovalService } from './customer-restriction-release-mlro-approval.service';
import { CustomerRestrictionReleaseOpsApprovalService } from './customer-restriction-release-ops-approval.service';
import { MaterialRequestsModule } from '../material-requests/material-requests.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { CustomerRestrictionsAdminController } from './customer-restrictions.admin.controller';
import { CustomerRestrictionsClientController } from './customer-restrictions.client.controller';

@Module({
  // TigerBeetleModule / FundsOrdersModule：仅为 CustomerAccessService.assertOffboardable
  // 的余额与在途单前置。两者的 imports 只有 PrismaModule / AuditLogsModule，
  // 都不反向依赖 Customers，无环（2026-08-15 核）。
  imports: [
    // Task 10：initiateRelease 经 ApprovalsService 开审批案
    ApprovalsModule,
    // 客户面 /client/me/restrictions 要回填「这张便签是否已被某条活着的材料请求
    // 认领」（同一件事不出两条横幅）。MaterialRequestsModule 反过来也 forwardRef
    // 引了本模块，是环，两边都必须 forwardRef。
    forwardRef(() => MaterialRequestsModule),
    PrismaModule,
    NotificationsModule,
    TigerBeetleModule,
    FundsOrdersModule,
  ],
  providers: [
    CustomerRestrictionWorkflowService,
    CustomerRestrictionReleaseMlroApprovalService,
    CustomerRestrictionReleaseOpsApprovalService,
    CustomersService,
    CustomerRestrictionsService,
    CustomerAccessService,
  ],
  controllers: [
    CustomersController,
    CustomerRestrictionsAdminController,
    CustomerRestrictionsClientController,
  ],
  exports: [
    CustomerRestrictionWorkflowService,
    CustomersService,
    CustomerRestrictionsService,
    CustomerAccessService,
  ],
})
export class CustomersModule {}
