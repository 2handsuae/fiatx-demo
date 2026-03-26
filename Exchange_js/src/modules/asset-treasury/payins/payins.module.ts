import { Module } from '@nestjs/common';
import { PayinsService } from './payins.service';
import { PayinsController } from './payins.controller';
import { PayinsAdminController } from './payins.admin.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';

@Module({
  imports: [PrismaModule, OnboardingModule],
  controllers: [PayinsController, PayinsAdminController],
  providers: [PayinsService],
  exports: [PayinsService],
})
export class PayinsModule {}
