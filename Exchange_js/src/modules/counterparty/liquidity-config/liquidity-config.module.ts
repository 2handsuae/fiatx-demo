import { Module } from '@nestjs/common';
import { LiquidityConfigService } from './liquidity-config.service';
import { LiquidityConfigController } from './liquidity-config.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [LiquidityConfigController],
  providers: [LiquidityConfigService],
  exports: [LiquidityConfigService],
})
export class LiquidityConfigModule {}
