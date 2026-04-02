import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { FeeOccurrencesModule } from '../fee-occurrences/fee-occurrences.module';
import { InternalTransactionsModule } from '../internal-transactions/internal-transactions.module';
import { InternalFundsService } from './internal-funds.service';
import { InternalFundsController } from './internal-funds.controller';

@Module({
  imports: [PrismaModule, InternalTransactionsModule, FeeOccurrencesModule],
  controllers: [InternalFundsController],
  providers: [InternalFundsService],
  exports: [InternalFundsService],
})
export class InternalFundsModule {}
