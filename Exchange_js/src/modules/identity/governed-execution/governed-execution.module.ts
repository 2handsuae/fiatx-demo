import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { GovernedExecutionListener } from './governed-execution.listener';

@Module({
  imports: [UsersModule, AccessControlModule],
  providers: [GovernedExecutionListener],
})
export class GovernedExecutionModule {}
