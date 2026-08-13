import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomerRestrictionsService } from './customer-restrictions.service';
import { CustomerPendingActionService } from './customer-pending-action.service';
import { CustomersController } from './customers.controller';
import { CustomerPendingActionController } from './customer-pending-action.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { NotificationsModule } from '../../../core/notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [CustomersService, CustomerRestrictionsService, CustomerPendingActionService],
  controllers: [CustomersController, CustomerPendingActionController],
  exports: [CustomerRestrictionsService, CustomerPendingActionService],
})
export class CustomersModule {}
