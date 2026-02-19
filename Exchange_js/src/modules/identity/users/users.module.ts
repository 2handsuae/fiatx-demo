import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AdminInvitationsService } from './admin-invitations.service';

@Module({
  imports: [PrismaModule],
  providers: [UsersService, AdminInvitationsService],
  controllers: [UsersController],
  exports: [UsersService, AdminInvitationsService],
})
export class UsersModule {}
