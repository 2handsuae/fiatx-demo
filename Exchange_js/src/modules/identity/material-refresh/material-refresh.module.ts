// material-refresh.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { MaterialRefreshService } from './material-refresh.service';
import { MaterialFreshnessCronService } from './material-freshness-cron.service';
import { MaterialRefreshCyclesController } from './material-refresh-cycles.controller';
import { AdminMaterialManagementController } from './admin-material-management.controller';
import { MaterialRefreshPolicyLoader } from './policy/material-refresh-policy';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
  imports: [forwardRef(() => OnboardingModule)],
  providers: [
    MaterialRefreshService,
    MaterialFreshnessCronService,
    MaterialRefreshPolicyLoader,
  ],
  controllers: [MaterialRefreshCyclesController, AdminMaterialManagementController],
  exports: [MaterialRefreshService],
})
export class MaterialRefreshModule {}
