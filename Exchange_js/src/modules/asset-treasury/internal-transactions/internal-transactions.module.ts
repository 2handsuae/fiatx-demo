import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { JournalsModule } from '../../accounting/journals/journals.module';
import { ClearingModule } from '../../clearing-settle/clearing/clearing.module';
import { InternalTransactionsService } from './internal-transactions.service';
import { InternalTransactionsController } from './internal-transactions.controller';

@Module({
  imports: [PrismaModule, JournalsModule, ClearingModule],
  controllers: [InternalTransactionsController],
  providers: [InternalTransactionsService],
  exports: [InternalTransactionsService],
})
export class InternalTransactionsModule {}
