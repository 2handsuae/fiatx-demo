import { Module, forwardRef } from '@nestjs/common';
import { PayinsService } from './payins.service';
import { PayinsController } from './payins.controller';
import { PayinsAdminController } from './payins.admin.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';

@Module({
  imports: [PrismaModule, forwardRef(() => OnboardingModule)],
  controllers: [PayinsController, PayinsAdminController],
  providers: [PayinsService],
  exports: [PayinsService],
})
export class PayinsModule {}
