import { Module } from '@nestjs/common';
import { PricingEngineService } from './pricing-engine.service';
import { BinanceRateProvider } from './providers/binance-rate.provider';

@Module({
  providers: [PricingEngineService, BinanceRateProvider],
  exports: [PricingEngineService, BinanceRateProvider],
})
export class PricingCenterModule {}
