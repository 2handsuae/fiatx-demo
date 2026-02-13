import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingService } from './onboarding.service';
import { OnboardingCustomerController } from './onboarding-customer.controller';
import { OnboardingAdminController } from './onboarding-admin.controller';

@Module({
  imports: [PrismaModule],
  providers: [OnboardingService],
  controllers: [OnboardingCustomerController, OnboardingAdminController],
  exports: [OnboardingService],
})
export class OnboardingModule {}

