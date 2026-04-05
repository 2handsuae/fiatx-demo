import { Module, forwardRef } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AdminInvitationsService } from './admin-invitations.service';
import { AccessControlModule } from '../access-control/access-control.module';
import { ChangeTicketsModule } from '../../governance/change-tickets/change-tickets.module';

@Module({
  imports: [PrismaModule, AccessControlModule, forwardRef(() => ChangeTicketsModule)],
  providers: [UsersService, AdminInvitationsService],
  controllers: [UsersController],
  exports: [UsersService, AdminInvitationsService],
})
export class UsersModule {}
