import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ChangeTicketsController } from './change-tickets.controller';
import { ChangeTicketsService } from './change-tickets.service';
import { UsersModule } from '../../identity/users/users.module';
import { AccessControlModule } from '../../identity/access-control/access-control.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => ApprovalsModule),
    forwardRef(() => UsersModule),
    forwardRef(() => AccessControlModule),
  ],
  controllers: [ChangeTicketsController],
  providers: [ChangeTicketsService],
  exports: [ChangeTicketsService],
})
export class ChangeTicketsModule {}
