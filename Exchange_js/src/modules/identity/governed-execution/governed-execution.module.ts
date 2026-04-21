import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { BusinessConfigModule } from '../../governance/business-config/business-config.module';
import { GovernedExecutionListener } from './governed-execution.listener';

@Module({
  imports: [UsersModule, AccessControlModule, BusinessConfigModule],
  providers: [GovernedExecutionListener],
})
export class GovernedExecutionModule {}
