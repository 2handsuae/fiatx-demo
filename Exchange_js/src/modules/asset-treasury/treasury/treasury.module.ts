import { Module } from '@nestjs/common';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './treasury.service';
import { CustomerPortfolioController } from './customer-portfolio.controller';
import { CustomerPortfolioService } from './customer-portfolio.service';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';

@Module({
  imports: [PrismaModule, TigerBeetleModule],
  controllers: [TreasuryController, CustomerPortfolioController],
  providers: [TreasuryService, CustomerPortfolioService],
  exports: [TreasuryService],
})
export class TreasuryModule {}
