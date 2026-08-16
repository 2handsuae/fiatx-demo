import { Module, forwardRef } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomerRestrictionsService } from './customer-restrictions.service';
import { CustomerAccessService } from './customer-access.service';
import { CustomerPendingActionService } from './customer-pending-action.service';
import { CustomersController } from './customers.controller';
import { CustomerPendingActionController } from './customer-pending-action.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { NotificationsModule } from '../../../core/notifications/notifications.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { FundsOrdersModule } from '../../funds-orders/funds-orders.module';
import { CustomerRestrictionWorkflowService } from './customer-restriction-workflow.service';
import { CustomerRestrictionReleaseMlroApprovalService } from './customer-restriction-release-mlro-approval.service';
import { CustomerRestrictionReleaseOpsApprovalService } from './customer-restriction-release-ops-approval.service';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { CustomerRestrictionsAdminController } from './customer-restrictions.admin.controller';
import { CustomerRestrictionsClientController } from './customer-restrictions.client.controller';

@Module({
  // OnboardingModule：仅为 SumsubClient（客户级补料会话铸 token）。
  // Onboarding 不反向依赖 Customers，无环（2026-08-14 核）。
  // TigerBeetleModule / FundsOrdersModule：仅为 CustomerAccessService.assertOffboardable
  // 的余额与在途单前置。两者的 imports 只有 PrismaModule / AuditLogsModule，
  // 都不反向依赖 Customers，无环（2026-08-15 核）。
  imports: [
    // Task 10：initiateRelease 经 ApprovalsService 开审批案
    ApprovalsModule,
    PrismaModule,
    NotificationsModule,
    forwardRef(() => OnboardingModule),
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
    CustomerPendingActionService,
  ],
  controllers: [
    CustomersController,
    CustomerPendingActionController,
    CustomerRestrictionsAdminController,
    CustomerRestrictionsClientController,
  ],
  exports: [
    CustomerRestrictionWorkflowService,CustomerRestrictionsService, CustomerAccessService, CustomerPendingActionService],
})
export class CustomersModule {}
