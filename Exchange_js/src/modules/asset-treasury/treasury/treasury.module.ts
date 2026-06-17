import { Module } from '@nestjs/common';
import { CustomerPortfolioController } from './customer-portfolio.controller';
import { CustomerPortfolioService } from './customer-portfolio.service';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';

@Module({
  imports: [PrismaModule, TigerBeetleModule],
  controllers: [CustomerPortfolioController],
  providers: [CustomerPortfolioService],
  exports: [],
})
export class TreasuryModule {}
