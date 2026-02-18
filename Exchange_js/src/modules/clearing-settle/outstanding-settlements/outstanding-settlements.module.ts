import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { InternalFundsModule } from '../../asset-treasury/internal-funds/internal-funds.module';
import { InternalTransactionsModule } from '../../asset-treasury/internal-transactions/internal-transactions.module';
import { OutstandingSettlementsController } from './outstanding-settlements.controller';
import { OutstandingSettlementsService } from './outstanding-settlements.service';

@Module({
  imports: [PrismaModule, InternalTransactionsModule, InternalFundsModule],
  controllers: [OutstandingSettlementsController],
  providers: [OutstandingSettlementsService],
  exports: [OutstandingSettlementsService],
})
export class OutstandingSettlementsModule {}
