import { Module } from '@nestjs/common';
import { TradingReadinessController } from './trading-readiness.controller';
import { WithdrawalAddressesModule } from '../../asset-treasury/withdrawal-addresses/withdrawal-addresses.module';
import { WalletsModule } from '../../asset-treasury/wallets/wallets.module';
import { AssetsModule } from '../../asset-treasury/assets/assets.module';

@Module({
  imports: [WithdrawalAddressesModule, WalletsModule, AssetsModule],
  controllers: [TradingReadinessController],
})
export class TradingReadinessModule {}
