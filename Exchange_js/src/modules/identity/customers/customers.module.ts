import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { NotificationsModule } from '../../../core/notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [CustomersService],
  controllers: [CustomersController],
})
export class CustomersModule {}
