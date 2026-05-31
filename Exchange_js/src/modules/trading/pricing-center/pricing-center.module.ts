import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { WithdrawalFeeLevelModule } from '../withdrawal-fee-level/withdrawal-fee-level.module';
import { PricingCenterAdminController } from './pricing-center.admin.controller';
import { PricingCenterCustomerController } from './pricing-center.customer.controller';
import { PricingCenterService } from './pricing-center.service';
import { PricingEngineService } from './pricing-engine.service';
import { BinanceRateProvider } from './providers/binance-rate.provider';

@Module({
  imports: [PrismaModule, OnboardingModule, forwardRef(() => WithdrawalFeeLevelModule)],
  controllers: [PricingCenterAdminController, PricingCenterCustomerController],
  providers: [
    PricingCenterService,
    PricingEngineService,
    BinanceRateProvider,
  ],
  exports: [PricingCenterService, PricingEngineService, BinanceRateProvider],
})
export class PricingCenterModule {}
