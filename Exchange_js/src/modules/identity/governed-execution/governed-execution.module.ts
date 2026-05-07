import { Module } from '@nestjs/common';
import { BusinessConfigModule } from '../../governance/business-config/business-config.module';
import { GovernedExecutionListener } from './governed-execution.listener';

@Module({
  imports: [BusinessConfigModule],
  providers: [GovernedExecutionListener],
})
export class GovernedExecutionModule {}
