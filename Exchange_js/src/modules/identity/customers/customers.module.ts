import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomerRestrictionsService } from './customer-restrictions.service';
import { CustomersController } from './customers.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { NotificationsModule } from '../../../core/notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [CustomersService, CustomerRestrictionsService],
  controllers: [CustomersController],
  exports: [CustomerRestrictionsService],
})
export class CustomersModule {}
