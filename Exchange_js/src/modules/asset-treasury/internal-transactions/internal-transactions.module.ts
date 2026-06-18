import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { InternalTransactionsService } from './internal-transactions.service';

@Module({
  imports: [
    PrismaModule,
  ],
  providers: [InternalTransactionsService],
  exports: [InternalTransactionsService],
})
export class InternalTransactionsModule {}
