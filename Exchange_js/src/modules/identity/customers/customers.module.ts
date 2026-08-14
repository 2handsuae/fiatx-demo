import { Module, forwardRef } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomerRestrictionsService } from './customer-restrictions.service';
import { CustomerPendingActionService } from './customer-pending-action.service';
import { CustomersController } from './customers.controller';
import { CustomerPendingActionController } from './customer-pending-action.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { NotificationsModule } from '../../../core/notifications/notifications.module';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
  // OnboardingModule：仅为 SumsubClient（客户级补料会话铸 token）。
  // Onboarding 不反向依赖 Customers，无环（2026-08-14 核）。
  imports: [PrismaModule, NotificationsModule, forwardRef(() => OnboardingModule)],
  providers: [CustomersService, CustomerRestrictionsService, CustomerPendingActionService],
  controllers: [CustomersController, CustomerPendingActionController],
  exports: [CustomerRestrictionsService, CustomerPendingActionService],
})
export class CustomersModule {}
