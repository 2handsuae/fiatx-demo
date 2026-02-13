import { Module } from '@nestjs/common';
import { LiquidityProvidersService } from './liquidity-providers.service';
import { LiquidityProvidersController } from './liquidity-providers.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [LiquidityProvidersController],
  providers: [LiquidityProvidersService],
  exports: [LiquidityProvidersService],
})
export class LiquidityProvidersModule {}
